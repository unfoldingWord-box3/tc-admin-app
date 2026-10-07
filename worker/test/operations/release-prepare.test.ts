// `release.prepare` (#34): over the recorded Pendau archive and trees as the
// previous release (E17, E52) and a synthetic default branch with one changed
// and one added book, the snapshot is prepared with exactly the writes the plan
// announced, on the temporary branch only (R3, W5); carried books are never
// uploaded (R1); a left-out book is deleted and listed (R2); the version follows
// R9; a moved source is refused (R5); a failed commit keeps the branch (R7, X1).
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { Preparation, SelectionState } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import { openArchive } from '../../src/door43/archive';
import type { KVNamespace } from '../../src/env';
import { md5 } from '../../src/model/md5';
import { MAX_COMMIT_BYTES, batch, commitBytes, commitsForAll, planSnapshot } from '../../src/model/snapshot';
import type { SnapshotInput, Upload } from '../../src/model/snapshot';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { releasePlan } from '../../src/operations/release-plan';
import { confirmedSelection, confirmedUnknowns, confirmedVersion, releasePrepare } from '../../src/operations/release-prepare';
import { recorded } from '../support/recorded';
import { storedZip } from '../support/zip';

type Repo = { catalog: { prod: { branch_or_tag_name: string; commit_sha: string } | null; latest: { branch_or_tag_name: string; commit_sha: string } | null }; permissions: object };
type Tree = { sha: string; tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean };
const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
const TAG_SHA = '2d9dbd1ee09b5a1c28edd8668462f6a64029619b';
const BRANCH_SHA = 'b000000000000000000000000000000000000000';
const user = recorded<unknown>('2026-10-05/user/user.json');
const repoView = recorded<Repo>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const tagTree = recorded<Tree>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau__git-trees__master.json.gz');
const tagEntry = recorded<{ ingredients: object[] }>('2026-10-07/catalog/entry__bahtraku__Perjanjian-Baru-Pendau__v1.2.json.gz');
const tagZip = new Uint8Array(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip', import.meta.url)));
const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The default branch: the release's files with Matthew changed and Genesis added, in the archive, the tree, and the catalog entry. */
async function branchFixtures() {
  const archive = openArchive(tagZip);
  const entries: [string, string][] = [['perjanjian-baru-pendau/', '']];
  const metadata = JSON.parse(decoder.decode(await archive.bytes('metadata.json'))) as { ingredients: Record<string, unknown>; type: { flavorType: { currentScope: Record<string, string[]> } } };
  metadata.ingredients['ingredients/GEN.usfm'] = { checksum: { md5: 'stale' }, mimeType: 'text/x-usfm', size: 1, scope: { GEN: [] } };
  metadata.type.flavorType.currentScope.GEN = [];
  const changedMat = '\\id MAT Matius, edisi kedua\n\\c 1\n\\v 1 Inilah silsilah Yesus Kristus.\n';
  const newGen = '\\id GEN Kejadian\n\\c 1\n\\v 1 Pada mulanya Allah menciptakan langit dan bumi.\n';
  const shas = new Map<string, string>(tagTree.tree.map(entry => [entry.path, entry.sha]));
  const blobs: { path: string; sha: string; size: number }[] = [];
  for (const entry of archive.entries) {
    let text = decoder.decode(await archive.bytes(entry.path));
    if (entry.path === 'ingredients/MAT.usfm') text = changedMat;
    if (entry.path === 'metadata.json') text = `${JSON.stringify(metadata, null, 2)}\n`;
    entries.push([`perjanjian-baru-pendau/${entry.path}`, text]);
    const changed = entry.path === 'ingredients/MAT.usfm' || entry.path === 'metadata.json';
    blobs.push({ path: entry.path, sha: changed ? `c${md5(encoder.encode(text)).slice(1)}00000000` : shas.get(entry.path)!, size: encoder.encode(text).length });
  }
  entries.push(['perjanjian-baru-pendau/ingredients/GEN.usfm', newGen]);
  blobs.push({ path: 'ingredients/GEN.usfm', sha: 'd000000000000000000000000000000000000000', size: encoder.encode(newGen).length });
  const tree: Tree = { sha: BRANCH_SHA, tree: blobs.map(blob => ({ ...blob, type: 'blob' })), truncated: false };
  const entry = { ...tagEntry, commit_sha: BRANCH_SHA, ingredients: [...tagEntry.ingredients, { identifier: 'gen', path: './ingredients/GEN.usfm', title: 'Genesis', exists: true, is_dir: false }] };
  return { zip: storedZip(entries), tree, entry, changedMat, newGen };
}

class MemoryKV implements KVNamespace {
  readonly entries = new Map<string, string>();
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.entries.set(key, value);
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
}

interface Door43Options {
  prod?: boolean;
  writable?: boolean;
  /** The default-branch commit the repository reports, when it moved since the plan. */
  movedTo?: string;
  commitAnswer?: () => Response;
  branchAnswer?: () => Response;
}

/** A Door43 of the fixtures above: reads answered from them, writes answered as QA did (E27) and recorded. */
function door43(fixtures: Awaited<ReturnType<typeof branchFixtures>>, options: Door43Options = {}) {
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const repo: Repo = {
    ...repoView,
    catalog: { prod: options.prod === false ? null : repoView.catalog.prod, latest: { branch_or_tag_name: 'master', commit_sha: options.movedTo ?? BRANCH_SHA } },
    permissions: options.writable === false ? { pull: true } : { push: true, admin: false, pull: true },
  };
  let commits = 0;
  const fetch: Fetch = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      writes.push({ method, path: pathname, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      if (pathname.endsWith('/branches')) return options.branchAnswer ? options.branchAnswer() : Response.json({ name: (writes.at(-1)!.body as { new_branch_name: string }).new_branch_name, commit: { id: 'a000000000000000000000000000000000000000' } }, { status: 201 });
      if (pathname.endsWith('/contents')) {
        if (options.commitAnswer) return options.commitAnswer();
        commits += 1;
        const sha = `e${String(commits).padStart(39, '0')}`;
        return Response.json({ commit: { sha, html_url: `https://qa.door43.org/c/${sha}`, author: { date: '2026-10-07T15:00:00Z' } }, files: [] }, { status: 201 });
      }
      return new Response('', { status: 404 });
    }
    if (pathname === '/api/v1/user') return Response.json(user);
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname)) return Response.json(repo);
    const entry = /\/catalog\/entry\/[^/]+\/[^/]+\/([^/]+)$/.exec(pathname);
    if (entry) return Response.json(decodeURIComponent(entry[1]!) === 'master' ? fixtures.entry : { ...tagEntry, commit_sha: TAG_SHA });
    const tree = /\/git\/trees\/([^/]+)$/.exec(pathname);
    if (tree) return Response.json(tree[1] === BRANCH_SHA ? fixtures.tree : tree[1] === TAG_SHA ? tagTree : null, { status: tree[1] === BRANCH_SHA || tree[1] === TAG_SHA ? 200 : 404 });
    const archive = /\/sb\/([^/]+)\.zip$/.exec(pathname);
    if (archive) return new Response(archive[1] === BRANCH_SHA ? fixtures.zip : archive[1] === TAG_SHA ? tagZip : '', { status: archive[1] === BRANCH_SHA || archive[1] === TAG_SHA ? 200 : 404 });
    void searchParams;
    return new Response('', { status: 404 });
  };
  return { fetch, writes };
}

let kv: MemoryKV;
const NOW = new Date('2026-10-07T15:00:00.000Z');
const context = (fetch: Fetch): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', 'door43-token', kv);
  return { ...base, door43: { ...base.door43!, fetch }, now: () => NOW };
};
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
/** Every released book carried forward and the new one left out, the plan's default, with exceptions. */
const carried = (except: Record<string, SelectionState> = {}) => Object.fromEntries([...tagEntry.ingredients.map(i => [(i as { identifier: string }).identifier, 'carry_forward' as const]), ['gen', 'leave_out' as const], ...Object.entries(except)]);
const fileOf = (body: Record<string, unknown>, path: string) => (body.files as { path: string; operation: string; content?: string; sha?: string }[]).find(file => file.path === path);
const decodeContent = (file: { content?: string }) => decoder.decode(Uint8Array.from(atob(file.content!), c => c.charCodeAt(0)));

let fixtures: Awaited<ReturnType<typeof branchFixtures>>;
beforeEach(async () => {
  kv = new MemoryKV();
  fixtures ??= await branchFixtures();
});

/** A plan, then the prepare, against one Door43. */
async function prepare(options: Door43Options, selection: Record<string, SelectionState>, extra: { version?: string | null; unknown_included?: string[]; moveAfterPlan?: string } = {}) {
  // The plan is made while the account may push and the branch stands where the plan binds it; the options shape the prepare.
  const { movedTo: _moved, writable: _writable, ...planOptions } = options;
  void _moved;
  void _writable;
  const planned = door43(fixtures, planOptions);
  const plan = await releasePlan(PENDAU, context(planned.fetch));
  const live = door43(fixtures, { ...options, ...(extra.moveAfterPlan ? { movedTo: extra.moveAfterPlan } : {}) });
  const input = OPERATIONS['release.prepare'].input.parse({ ...PENDAU, plan_id: plan.id, selection, unknown_included: extra.unknown_included ?? [], version: extra.version ?? null });
  return { plan, writes: live.writes, run: () => releasePrepare(input, context(live.fetch)) };
}

describe('a later release of Pendau (baseline v1.2)', () => {
  test('R1, R3, W5: including the changed and the new book writes the branch from the release and one commit on it with exactly those two books and the metadata; carried books and unchanged root files are not uploaded', async () => {
    const { plan, writes, run } = await prepare({}, carried({ mat: 'include', gen: 'include' }));
    const receipt = OPERATIONS['release.prepare'].output.parse(await run());
    expect(writes.map(write => `${write.method} ${write.path}`)).toEqual(['POST /api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/branches', 'POST /api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/contents']);
    expect(writes[0]!.body).toEqual({ new_branch_name: 'temp-tca-release/v1.3.0', old_ref_name: TAG_SHA });
    const commit = writes[1]!.body;
    expect(commit.branch).toBe('temp-tca-release/v1.3.0');
    // Genesis is not on the release's commit, so it is created; Matthew is, so it is replaced (E27).
    expect((commit.files as { path: string; operation: string }[]).map(file => `${file.operation} ${file.path}`)).toEqual(['create ingredients/GEN.usfm', 'upload ingredients/MAT.usfm', 'upload metadata.json']);
    expect(decodeContent(fileOf(commit, 'ingredients/MAT.usfm')!)).toBe(fixtures.changedMat);
    expect(decodeContent(fileOf(commit, 'ingredients/GEN.usfm')!)).toBe(fixtures.newGen);
    // The plan announced the branch and one commit on it; the receipt wrote no more (W5), on the branch of the confirmed version (R3).
    expect(plan.would_write.map(write => write.kind)).toEqual(['branch', 'commit']);
    expect(receipt.wrote.map(write => `${write.kind} ${write.target}`)).toEqual(['branch bahtraku/Perjanjian-Baru-Pendau@temp-tca-release/v1.3.0', 'commit bahtraku/Perjanjian-Baru-Pendau@temp-tca-release/v1.3.0']);
    expect(receipt.wrote[1]).toMatchObject({ sha: 'e000000000000000000000000000000000000001' });
    const preparation = receipt.result;
    expect(preparation).toMatchObject({ id: 'v1.3.0', state: 'health_checking', bound_to: { default_branch_sha: BRANCH_SHA, release_tag: 'v1.2', release_tag_sha: TAG_SHA } });
    expect(preparation.selection).toEqual({ new: ['gen'], revised: ['mat'], unknown_included: [] });
    expect(preparation.snapshot).toMatchObject({ branch: 'temp-tca-release/v1.3.0', commit_sha: 'e000000000000000000000000000000000000001' });
    expect(preparation.snapshot!.files.find(file => file.path === 'ingredients/MRK.usfm')).toEqual({ path: 'ingredients/MRK.usfm', source: 'tag', unit: 'mrk' });
    expect(preparation.snapshot!.files.find(file => file.path === 'ingredients/MAT.usfm')).toEqual({ path: 'ingredients/MAT.usfm', source: 'default_branch', unit: 'mat' });
    expect(preparation.snapshot!.files.filter(file => file.source === 'tag')).toHaveLength(26);
    expect(preparation.health).toMatchObject({ state: 'checking', ref: 'temp-tca-release/v1.3.0' });
    expect(preparation.version).toEqual({ baseline_tag: 'v1.2', proposed: 'v1.3.0', confirmed: 'v1.3.0' });
    expect(preparation.notes.draft).toContain('### Added\n- Genesis (GEN)');
    expect(preparation.notes.draft).toContain('### Revised\n- Matthew (MAT)');
    expect(preparation.history.map(event => event.to)).toEqual(['selecting', 'snapshot_prepared', 'health_checking']);
    expect(JSON.parse(kv.entries.get('preparation:bahtraku/Perjanjian-Baru-Pendau/v1.3.0')!) as Preparation).toEqual(preparation);
  });

  test('R10, Q7, Q8: the committed metadata carries the size and md5 of every file in the snapshot, the new book in its scope, and the default branch\'s top-level fields', async () => {
    const { writes, run } = await prepare({}, carried({ mat: 'include', gen: 'include' }));
    await run();
    const metadata = JSON.parse(decodeContent(fileOf(writes[1]!.body, 'metadata.json')!)) as { ingredients: Record<string, { size: number; checksum: { md5: string } }>; type: { flavorType: { currentScope: Record<string, string[]> } } };
    expect(metadata.ingredients['ingredients/MAT.usfm']).toMatchObject({ size: encoder.encode(fixtures.changedMat).length, checksum: { md5: md5(encoder.encode(fixtures.changedMat)) } });
    expect(metadata.ingredients['ingredients/GEN.usfm']).toMatchObject({ size: encoder.encode(fixtures.newGen).length, checksum: { md5: md5(encoder.encode(fixtures.newGen)) } });
    // A carried book's entry is recomputed from the release's bytes, not copied stale (E5).
    const mrk = await openArchive(tagZip).bytes('ingredients/MRK.usfm');
    expect(metadata.ingredients['ingredients/MRK.usfm']).toMatchObject({ size: mrk.length, checksum: { md5: md5(mrk) } });
    expect(Object.keys(metadata.type.flavorType.currentScope)).toHaveLength(28);
    expect(Object.keys(metadata.type.flavorType.currentScope)[0]).toBe('GEN');
    expect(Object.keys(metadata.ingredients)).toHaveLength(31);
  });

  test('R2, R9: a released book left out is deleted from the branch with its blob SHA, dropped from the metadata, named in the notes, and the version takes a major increment', async () => {
    const { writes, run } = await prepare({}, carried({ jhn: 'leave_out' }));
    const receipt = await run();
    expect(writes[0]!.body).toMatchObject({ new_branch_name: 'temp-tca-release/v2.0.0' });
    const jhn = fileOf(writes[1]!.body, 'ingredients/JHN.usfm')!;
    expect(jhn).toEqual({ operation: 'delete', path: 'ingredients/JHN.usfm', sha: tagTree.tree.find(entry => entry.path === 'ingredients/JHN.usfm')!.sha });
    expect((writes[1]!.body.files as { path: string }[]).map(file => file.path)).toEqual(['ingredients/JHN.usfm', 'metadata.json']);
    const metadata = JSON.parse(decodeContent(fileOf(writes[1]!.body, 'metadata.json')!)) as { ingredients: Record<string, unknown>; type: { flavorType: { currentScope: Record<string, string[]> } } };
    expect(metadata.ingredients).not.toHaveProperty('ingredients/JHN.usfm');
    expect(metadata.type.flavorType.currentScope).not.toHaveProperty('JHN');
    expect(receipt.result.notes.draft).toContain('### Removed\n- John (JHN)');
    expect(receipt.result.version).toEqual({ baseline_tag: 'v1.2', proposed: 'v2.0.0', confirmed: 'v2.0.0' });
    expect(receipt.result.snapshot!.files.some(file => file.path === 'ingredients/JHN.usfm')).toBe(false);
  });

  test('R9: the manager\'s version is taken when it is after the baseline and a major when a book is removed; otherwise invalid_version, and nothing is written', async () => {
    const edited = await prepare({}, carried({ gen: 'include' }), { version: 'v1.5.0' });
    expect((await edited.run()).result.version).toEqual({ baseline_tag: 'v1.2', proposed: 'v1.3.0', confirmed: 'v1.5.0' });
    const notAfter = await prepare({}, carried({ gen: 'include' }), { version: 'v1.2.0' });
    const error = (await failure(notAfter.run()))!;
    expect(error.code).toBe('invalid_version');
    expect(error.message).toBe('Version must be valid and greater than v1.2.');
    expect(notAfter.writes).toEqual([]);
    const removal = await prepare({}, carried({ jhn: 'leave_out' }), { version: 'v1.3.0' });
    const major = (await failure(removal.run()))!;
    expect(major.message).toBe('Removing a book needs a new major version, at least 2.');
    expect(removal.writes).toEqual([]);
    expect(confirmedVersion(null, null, 'v1.0.0', false)).toBe('v1.0.0');
    expect(confirmedVersion('v3', 'v1.2', 'v1.2.1', true)).toBe('v3.0.0');
    expect(() => confirmedVersion('nonsense', 'v1.2', 'v1.2.1', false)).toThrow(CatalogError);
  });
});

describe('a first release', () => {
  test('R4: the branch starts from the default-branch head, nothing included is uploaded since it is there, left-out books are deleted, and the metadata is written', async () => {
    const all = Object.fromEntries([...tagEntry.ingredients.map(i => [(i as { identifier: string }).identifier, 'include' as const]), ['gen', 'include' as const], ['jhn', 'leave_out' as const]]);
    const { writes, run } = await prepare({ prod: false }, all);
    const receipt = await run();
    expect(writes[0]!.body).toEqual({ new_branch_name: 'temp-tca-release/v1.0.0', old_ref_name: BRANCH_SHA });
    expect((writes[1]!.body.files as { path: string; operation: string }[]).map(file => `${file.operation} ${file.path}`)).toEqual(['delete ingredients/JHN.usfm', 'upload metadata.json']);
    expect(receipt.result).toMatchObject({ id: 'v1.0.0', version: { baseline_tag: null, proposed: 'v1.0.0', confirmed: 'v1.0.0' } });
    expect(receipt.result.snapshot!.files.every(file => file.source === 'default_branch')).toBe(true);
    expect(receipt.result.snapshot!.files.some(file => file.path === 'ingredients/JHN.usfm')).toBe(false);
  });
});

describe('what the prepare refuses, writing nothing', () => {
  test('R5: a default branch that moved since the plan is source_changed', async () => {
    const { writes, run } = await prepare({}, carried({ gen: 'include' }), { moveAfterPlan: 'f000000000000000000000000000000000000000' });
    expect((await failure(run()))!.code).toBe('source_changed');
    expect(writes).toEqual([]);
  });

  test('R4: a selection with nothing included or carried forward is invalid_selection; one that names a book the plan lacks, lacks a book, or cannot be met is validation_failed', async () => {
    const nothing = await prepare({}, Object.fromEntries(Object.keys(carried()).concat('gen').map(id => [id, 'leave_out' as const])));
    expect((await failure(nothing.run()))!.code).toBe('invalid_selection');
    expect(nothing.writes).toEqual([]);
    const stray = await prepare({}, carried({ gen: 'include', rut: 'include' }));
    expect((await failure(stray.run()))!.message).toBe('selection: rut is not a book of this plan.');
    const { gen: _gen, ...withoutGen } = carried();
    void _gen;
    const missing = await prepare({}, withoutGen);
    expect((await failure(missing.run()))!.message).toBe('selection: gen has no selection state.');
    const impossible = await prepare({}, carried({ gen: 'carry_forward' }));
    expect((await failure(impossible.run()))!.message).toBe('selection: gen is not in the previous release and cannot be carried forward.');
    const payload = { project_type: 'obs' as const, candidates: [{ id: '01', group: 'new' as const, selection: 'include' as const, default_branch: { id: '01', path: 'ingredients/content/01.md', title: '', sha: 'a', size: 1 }, baseline: null }] };
    expect(() => confirmedSelection(payload as never, { '01': 'include' })).toThrow(/send no selection/);
    expect(confirmedSelection(payload as never, {})).toEqual({ '01': 'include' });
  });

  test('R1, R10, S5: an included unknown file at the path of a book carried forward is validation_failed, so a carried book is never replaced behind its checksum', () => {
    // The default branch no longer lists Matthew but still has a changed ingredients/MAT.usfm, so that file is unknown there (classify.ts).
    const mat = { id: 'mat', group: 'removed' as const, default_branch: null, baseline: { id: 'mat', path: 'ingredients/MAT.usfm', title: 'Matthew', sha: 'a', size: 1 } };
    const unknown = ['ingredients/MAT.usfm', 'ingredients/notes.txt'];
    expect(() => confirmedUnknowns(['ingredients/MAT.usfm'], unknown, [{ ...mat, selection: 'carry_forward' }] as never)).toThrow('unknown_included: ingredients/MAT.usfm holds a book carried forward from the previous release and cannot also be included as an unknown file.');
    expect(() => confirmedUnknowns(['ingredients/MAT.usfm', 'ingredients/notes.txt'], unknown, [{ ...mat, selection: 'leave_out' }] as never)).not.toThrow();
    expect(() => confirmedUnknowns(['ingredients/notes.txt'], unknown, [{ ...mat, selection: 'carry_forward' }] as never)).not.toThrow();
    expect(() => confirmedUnknowns(['ingredients/other.txt'], unknown, [] as never)).toThrow('unknown_included: ingredients/other.txt is not an unknown file of the default branch.');
  });

  test('A2: no push is permission_denied; an expired or foreign plan is plan_expired', async () => {
    const denied = await prepare({ writable: false }, carried({ gen: 'include' }));
    expect((await failure(denied.run()))!.code).toBe('permission_denied');
    expect(denied.writes).toEqual([]);
    const { fetch } = door43(fixtures);
    const input = OPERATIONS['release.prepare'].input.parse({ ...PENDAU, plan_id: 'no-such-plan', selection: {}, unknown_included: [], version: null });
    expect((await failure(releasePrepare(input, context(fetch))))!.code).toBe('plan_expired');
  });

  test('R7, X1: a commit Door43 refuses is commit_failed, the branch is kept, nothing is retried, and the preparation records the failure as retryable; a second attempt finds the branch and is preparation_active', async () => {
    const { plan, writes, run } = await prepare({ commitAnswer: () => Response.json({ message: 'refused by the test' }, { status: 500 }) }, carried({ gen: 'include' }));
    const error = (await failure(run()))!;
    expect(error.code).toBe('commit_failed');
    expect(error.message).toBe('Commit failed: refused by the test.');
    expect(writes.map(write => `${write.method} ${write.path.split('/').pop()}`)).toEqual(['POST branches', 'POST contents']);
    const kept = JSON.parse(kv.entries.get('preparation:bahtraku/Perjanjian-Baru-Pendau/v1.3.0')!) as Preparation;
    expect(kept.state).toBe('retryable_failure');
    expect(kept.last_error).toMatchObject({ code: 'commit_failed', retryable: true, request_id: 'request-1' });
    expect(kept.snapshot).toMatchObject({ branch: 'temp-tca-release/v1.3.0', commit_sha: 'a000000000000000000000000000000000000000' });
    expect(kv.entries.has(`receipt:${plan.id}`)).toBe(false);
    const again = await prepare({ branchAnswer: () => Response.json({ message: 'branch already exists' }, { status: 409 }) }, carried({ gen: 'include' }));
    expect((await failure(again.run()))!.code).toBe('preparation_active');
  });

  test('R7: a branch Door43 created (201) with an answer that cannot be read is still recorded as a retryable preparation on the release\'s commit, and no commit is sent', async () => {
    const { writes, run } = await prepare({ branchAnswer: () => Response.json({}, { status: 201 }) }, carried({ gen: 'include' }));
    expect((await failure(run()))!.code).toBe('door43_unavailable');
    expect(writes.map(write => write.path.split('/').pop())).toEqual(['branches']);
    const kept = JSON.parse(kv.entries.get('preparation:bahtraku/Perjanjian-Baru-Pendau/v1.3.0')!) as Preparation;
    expect(kept).toMatchObject({ state: 'retryable_failure', last_error: { code: 'door43_unavailable' }, snapshot: { commit_sha: TAG_SHA } });
  });

  test('a repeated prepare of the same plan answers the stored receipt and writes nothing more', async () => {
    const { plan, writes, run } = await prepare({}, carried({ gen: 'include' }));
    const first = await run();
    const live = door43(fixtures);
    const second = await releasePrepare(OPERATIONS['release.prepare'].input.parse({ ...PENDAU, plan_id: plan.id, selection: carried({ gen: 'include' }), unknown_included: [], version: null }), context(live.fetch));
    expect(second).toEqual(first);
    expect(live.writes).toEqual([]);
    expect(writes).toHaveLength(2);
  });
});

describe('the snapshot model', () => {
  const MiB = 1024 * 1024;
  const unit = (path: string, sha: string) => ({ id: 'mat', path, title: 'Matthew', sha, size: 10 });
  const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
    project_type: 'bible',
    from_release: true,
    candidates: [{ id: 'mat', group: 'changed_released', selection: 'include', default_branch: unit('ingredients/41-MAT.usfm', 'b1'), baseline: unit('ingredients/MAT.usfm', 'a1') }],
    selection: { mat: 'include' },
    branch: { files: [], units: new Map(), administrative: ['README.md'], unknown: ['ingredients/notes.txt'], missing: [] },
    branch_blobs: new Map([['ingredients/41-MAT.usfm', 'b1'], ['README.md', 'r1'], ['ingredients/notes.txt', 'n1']]),
    start_blobs: new Map([['ingredients/MAT.usfm', 'a1'], ['README.md', 'r1'], ['ingredients/notes.txt', 'n0'], ['.gitea/workflows/check.yml', 'w0'], ['metadata.json', 'm0']]),
    sizes: new Map([['ingredients/41-MAT.usfm', 10], ['ingredients/notes.txt', 3]]),
    unknown_included: [],
    metadata_size: 5,
    ...over,
  });
  const ingredientsAfter = (plan: ReturnType<typeof planSnapshot>, start: ReadonlyMap<string, string>) => {
    const tree = new Set(start.keys());
    for (const write of plan.writes) if (write.operation === 'delete') tree.delete(write.path);
    else tree.add(write.path);
    return [...tree].filter(path => path.startsWith('ingredients/')).sort();
  };

  test('R2, S5: a renamed book leaves no copy at its old path and an unknown file not included is deleted, so under ingredients/ the tree after the writes is exactly snapshot.files', () => {
    const plan = planSnapshot(input());
    expect(plan.writes.filter(write => write.operation === 'delete').map(write => write.path)).toEqual(['ingredients/MAT.usfm', 'ingredients/notes.txt']);
    expect(ingredientsAfter(plan, input().start_blobs)).toEqual(plan.files.map(file => file.path).filter(path => path.startsWith('ingredients/')).sort());
    const kept = planSnapshot(input({ unknown_included: ['ingredients/notes.txt'] }));
    expect(kept.writes.filter(write => write.operation === 'delete').map(write => write.path)).toEqual(['ingredients/MAT.usfm']);
    expect(ingredientsAfter(kept, input().start_blobs)).toEqual(['ingredients/41-MAT.usfm', 'ingredients/notes.txt']);
  });

  test('Q22, W5: the plan\'s count and the batcher agree on a 20 MiB book and a 20 MiB administrative file; the metadata counts toward the ceiling; a size the tree lacks takes a commit of its own', () => {
    const up = (path: string, size: number): Upload => ({ operation: 'upload', path, size, source: 'default_branch', unit: null });
    expect(commitsForAll([20 * MiB, 20 * MiB, 1000])).toBe(2);
    expect(batch([up('ingredients/MAT.usfm', 20 * MiB), up('LICENSE.md', 20 * MiB), up('metadata.json', 1000)], [])).toHaveLength(2);
    expect(batch([up('ingredients/MAT.usfm', MAX_COMMIT_BYTES), up('metadata.json', 1000)], []).map(commitBytes)).toEqual([MAX_COMMIT_BYTES, 1000]);
    expect(commitsForAll([10, null, 10])).toBe(3);
  });
});
