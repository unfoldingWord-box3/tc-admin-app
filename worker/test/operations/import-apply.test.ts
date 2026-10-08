// `import.apply` (#80) over a plan `import.plan` made against the recorded
// Pendau project (E19, E34, E52, E63) from the recorded id_tb1 archive at its
// release `1974` (E1, E17): exactly one Door43 write, one contents call on the
// project's default branch with the imported files and the plan's metadata.json
// (W5, A3), nothing ever written to the source (W2), the receipt by plan id
// (§1 rule 6); a lost permission (A2), a moved branch, a changed overwrite (R5),
// a source Door43 no longer serves (`source_unavailable`), and a source file
// that is no longer what the plan showed (`source_changed`), each before any
// write; and an unknown outcome never sent again (X1).
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { ParsedInput } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { md5 } from '../../src/model/md5';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { importApply } from '../../src/operations/import-apply';
import type { ImportApplyPayload } from '../../src/operations/import-apply';
import { importPlan } from '../../src/operations/import-plan';
import type { StoredPlan } from '../../src/operations/plans';
import { recorded } from '../support/recorded';
import { storedZip } from '../support/zip';

const fixture = (path: string) => new URL(`../../../fixtures/door43/qa.door43.org/${path}`, import.meta.url);
const raw = <T>(path: string): T => JSON.parse(readFileSync(fixture(path), 'utf8')) as T;
const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
const REPO = '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau';
const TB1 = { owner: 'bahtraku', repo: 'id_tb1' };
const SOURCE = '/api/v1/repos/bahtraku/id_tb1';
/** Pendau's default-branch commit as recorded (E52). */
const SHA = '2d9dbd1ee09b5a1c28edd8668462f6a64029619b';
const MOVED = 'f'.repeat(40);
const COMMIT = 'c'.repeat(40);

const user = recorded<unknown>('2026-10-05/user/user.json');
const repository = recorded<Record<string, unknown>>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const tree = recorded<{ sha: string; tree: { path: string; type: string; sha: string; size?: number }[] }>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau__git-trees__master.json.gz');
const tb1Repository = recorded<Record<string, unknown>>('2026-10-07/repos/bahtraku__id_tb1.json.gz');
const tb1Release = raw<{ tag_name: string }[]>('2026-09-21/releases/bahtraku__id_tb1.json').find(release => release.tag_name === '1974')!;
const probeRelease = recorded<Record<string, unknown> & { published_at: string; door43_metadata: Record<string, unknown> }>('2026-09-22/probe-write/14-lookup-by-tag.json');
const release = { ...probeRelease, tag_name: 'v1.2', target_commitish: SHA, door43_metadata: { ...probeRelease.door43_metadata, commit_sha: SHA } };
const branch = raw<{ commit: Record<string, unknown> }>('2026-10-07/setup-retry/08-GET-branch.json');
const committed = raw<{ commit: Record<string, unknown> }>('2026-10-07/setup-retry/03-POST-contents.json');
const pendauZip = new Uint8Array(readFileSync(fixture('2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip')));
const tb1Zip = new Uint8Array(readFileSync(fixture('2026-09-21/sb-archives/bahtraku__id_tb1__master.zip')));
const decode64 = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));

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
  async list(options: { prefix: string }) {
    return { keys: [...this.entries.keys()].filter(name => name.startsWith(options.prefix)).map(name => ({ name })), list_complete: true };
  }
}

interface Sent {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

/** What Door43 holds and answers, changed by a test between the plan and the apply. */
interface Door43State {
  writable: boolean;
  head: string;
  trees: Map<string, typeof tree>;
  /** The source's archive at `1974`: id_tb1's recording, other bytes, or a status Door43 answers instead. */
  sourceArchive: Uint8Array | number;
  commit: 'created' | number | 'network';
}

let kv: MemoryKV;
let sent: Sent[];
let state: Door43State;

const door43: Fetch = async (url, init) => {
  const { pathname, search } = new URL(url);
  const method = init?.method ?? 'GET';
  sent.push({ method, path: pathname + search, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
  if (pathname === '/api/v1/user') return Response.json(user);
  if (pathname === REPO && method === 'GET') return Response.json({ ...repository, permissions: state.writable ? { push: true, admin: false, pull: true } : { pull: true } });
  if (pathname === `${REPO}/branches/master`) return Response.json({ ...branch, name: 'master', commit: { ...branch.commit, id: state.head, url: `https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/commit/${state.head}` } });
  const treeAt = /^\/api\/v1\/repos\/bahtraku\/Perjanjian-Baru-Pendau\/git\/trees\/([0-9a-f]{40})$/.exec(pathname);
  if (treeAt) {
    const found = state.trees.get(treeAt[1]!);
    return found ? Response.json(found) : new Response('', { status: 404 });
  }
  if (pathname === `${REPO}/sb/${SHA}.zip`) return new Response(pendauZip);
  if (pathname === `${REPO}/releases/tags/v1.2`) return Response.json(release);
  if (pathname === `${REPO}/contents` && method === 'POST') {
    if (state.commit === 'network') throw new TypeError('fetch failed');
    if (state.commit !== 'created') return Response.json({ message: 'sha does not match [given: 0, expected: 1]' }, { status: state.commit });
    return Response.json({ ...committed, commit: { ...committed.commit, sha: COMMIT, html_url: `https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/commit/${COMMIT}` } }, { status: 201 });
  }
  if (pathname === SOURCE) return Response.json(tb1Repository);
  if (pathname === `${SOURCE}/releases/tags/1974`) return Response.json(tb1Release);
  if (pathname === `${SOURCE}/sb/1974.zip`) return typeof state.sourceArchive === 'number' ? new Response('', { status: state.sourceArchive }) : new Response(state.sourceArchive);
  return new Response('', { status: 404 });
};

let clock: Date;
const context = (token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-80', token, kv);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch: door43 } : null, now: () => clock };
};
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const plan = async (units: ParsedInput<'import.plan'>['units'] = ['GEN', 'MAT']) => {
  const made = await importPlan({ ...PENDAU, source: { ...TB1, revision: '1974' }, units }, context());
  sent = [];
  return made;
};
const apply = (plan_id: string, token: string | null = 'door43-token') => importApply({ ...PENDAU, plan_id }, context(token));
const writes = () => sent.filter(request => request.method !== 'GET').map(request => `${request.method} ${request.path}`);
const sourceRequests = () => sent.filter(request => request.path.startsWith(SOURCE));
const contentsCall = () => sent.find(request => request.method === 'POST')!.body as { message: string; branch: string; files: { operation: string; path: string; content: string; sha?: string }[] } & Record<string, unknown>;
const storedPlan = (id: string) => JSON.parse(kv.entries.get(`plan:${id}`)!) as StoredPlan<ImportApplyPayload>;
const blob = (path: string) => tree.tree.find(entry => entry.path === path)!.sha;

beforeEach(() => {
  kv = new MemoryKV();
  sent = [];
  state = { writable: true, head: SHA, trees: new Map([[SHA, tree]]), sourceArchive: tb1Zip, commit: 'created' };
  clock = new Date('2026-10-08T12:00:00.000Z');
});

describe('a successful apply', () => {
  test('W5, W2, A3: exactly one Door43 write, one contents call on the project\'s default branch with every imported file and the plan\'s metadata.json; the source is only ever read; the receipt\'s wrote is the plan\'s would_write', async () => {
    const made = await plan();
    const receipt = OPERATIONS['import.apply'].output.parse(await apply(made.id));

    expect(writes()).toEqual([`POST ${REPO}/contents`]);
    expect(sourceRequests().map(request => `${request.method} ${request.path}`)).toEqual([`GET ${SOURCE}/sb/1974.zip`]);
    const call = contentsCall();
    expect(call.branch).toBe('master');
    expect(call.message).toBe('Import GEN, MAT from bahtraku/id_tb1@1974\n\nThe imported files and metadata.json, with the source relationship, written by tC Admin 0.1.0.');
    expect(call.files.map(file => [file.operation, file.path, file.sha ?? null])).toEqual([
      ['create', 'ingredients/GEN.usfm', null],
      ['update', 'ingredients/MAT.usfm', blob('ingredients/MAT.usfm')],
      ['update', 'metadata.json', blob('metadata.json')],
    ]);
    expect(call.author).toBeUndefined();
    expect(call.committer).toBeUndefined();
    // The committed bytes are the source archive's, the ones the plan measured.
    const [gen, mat] = made.preview.files;
    expect(md5(decode64(call.files[0]!.content))).toBe(gen!.md5);
    expect(md5(decode64(call.files[1]!.content))).toBe(mat!.md5);
    const post = sent.find(request => request.method === 'POST')!;
    expect(post.headers.get('authorization')).toBe('Bearer door43-token');

    expect(receipt.operation).toBe('import.apply');
    expect(receipt.plan_id).toBe(made.id);
    expect(receipt.wrote).toEqual([{ kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@master', sha: COMMIT, url: `https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/commit/${COMMIT}` }]);
    expect(receipt.result.default_branch_head?.sha).toBe(COMMIT);
    expect(receipt.result.health.state).toBe('never_checked');
    expect(receipt.result.coverage.basis).toBe('archive');
  });

  test('R10, E24: the committed metadata.json is the plan\'s byte for byte, listing each imported file with its bytes\' size and md5 and the one source relationship', async () => {
    const made = await plan();
    await apply(made.id);
    const content = new TextDecoder().decode(decode64(contentsCall().files[2]!.content));
    expect(content).toBe(storedPlan(made.id).payload.metadata.content);
    const document = JSON.parse(content) as { ingredients: Record<string, { size: number; checksum: { md5: string } }>; relationships: unknown[] };
    for (const file of made.preview.files) expect([document.ingredients[file.path!]!.size, document.ingredients[file.path!]!.checksum.md5]).toEqual([file.size, file.md5]);
    expect(document.relationships).toEqual([{ id: 'dcs::bahtraku/id_tb1', relationType: 'source', flavor: 'textTranslation', revision: '1974' }]);
  });

  test('§1 rule 6, X1: the same plan id answers the same receipt and writes nothing more, and reads neither the source nor the project', async () => {
    const made = await plan();
    const first = await apply(made.id);
    sent = [];
    const again = await apply(made.id);
    expect(again).toEqual(first);
    expect(sent.map(request => request.path)).toEqual(['/api/v1/user']);
  });
});

describe('refused before any write', () => {
  test('A2: a push permission lost since the plan is permission_denied, and nothing is written', async () => {
    const made = await plan();
    state.writable = false;
    const error = await failure(apply(made.id));
    expect(error?.code).toBe('permission_denied');
    expect(writes()).toEqual([]);
  });

  test('R5: a default branch that moved since the plan is source_changed, and nothing is written', async () => {
    const made = await plan();
    state.head = MOVED;
    const error = await failure(apply(made.id));
    expect(error).toMatchObject({ code: 'source_changed', details: { bound: SHA, head: MOVED, reason: 'the default branch moved since the plan' } });
    expect(writes()).toEqual([]);
  });

  test('R5: a file the plan overwrites that is no longer the blob it replaces is source_changed, and nothing is written', async () => {
    const made = await plan();
    state.trees = new Map([[SHA, { ...tree, tree: tree.tree.map(entry => (entry.path === 'ingredients/MAT.usfm' ? { ...entry, sha: 'e'.repeat(40) } : entry)) }]]);
    const error = await failure(apply(made.id));
    expect(error).toMatchObject({ code: 'source_changed', details: { path: 'ingredients/MAT.usfm', reason: 'the file is not the one the plan replaces' } });
    expect(writes()).toEqual([]);
  });

  test('source_unavailable: an archive Door43 no longer serves at apply, before the project is read, and nothing is written', async () => {
    const made = await plan();
    state.sourceArchive = 404;
    const error = await failure(apply(made.id));
    expect(error).toMatchObject({ code: 'source_unavailable', details: { source: { ...TB1, revision: '1974', ref: '1974' }, door43_status: 404 } });
    expect(sent.map(request => request.path)).toEqual(['/api/v1/user', `${SOURCE}/sb/1974.zip`]);
    expect(writes()).toEqual([]);
  });

  test('source_changed (source): a source file that is no longer what the plan showed, or that is gone, is refused with the import wording, and nothing is written', async () => {
    const made = await plan(['GEN']);
    state.sourceArchive = storedZip([['id_tb1/ingredients/GEN.usfm', '\\id GEN\n\\c 1\n\\v 1 Diubah\n']]);
    const changed = await failure(apply(made.id));
    expect(changed).toMatchObject({ code: 'source_changed', variant: 'source', details: { path: 'ingredients/GEN.usfm', reason: 'the source file is not the one the plan showed' } });
    expect(changed?.message).toBe('The source repository has changed since the plan. Plan the import again.');
    state.sourceArchive = storedZip([['id_tb1/README.md', '# gone\n']]);
    const gone = await failure(apply(made.id));
    expect(gone).toMatchObject({ code: 'source_changed', variant: 'source', details: { path: 'ingredients/GEN.usfm', reason: 'the source no longer holds the file the plan took' } });
    expect(writes()).toEqual([]);
  });

  test('plan_expired: a plan past its thirty minutes, one another account made, an id no plan has, or a plan of another operation; and a plan for another project is refused', async () => {
    const made = await plan();
    clock = new Date('2026-10-08T12:30:00.000Z');
    expect((await failure(apply(made.id)))?.code).toBe('plan_expired');
    clock = new Date('2026-10-08T12:00:00.000Z');
    const stored = storedPlan(made.id);
    kv.entries.set(`plan:${made.id}`, JSON.stringify({ ...stored, account: 'someone-else' }));
    expect((await failure(apply(made.id)))?.code).toBe('plan_expired');
    expect((await failure(apply('no-such-plan')))?.code).toBe('plan_expired');
    kv.entries.set(`plan:${made.id}`, JSON.stringify({ ...stored, plan: { ...stored.plan, operation: 'upload.plan' } }));
    expect((await failure(apply(made.id)))?.code).toBe('plan_expired');
    kv.entries.set(`plan:${made.id}`, JSON.stringify(stored));
    const other = await failure(importApply({ owner: 'bahtraku', repo: 'id_gst', plan_id: made.id }, context()));
    expect(other).toMatchObject({ code: 'validation_failed', details: { plan_owner: 'bahtraku', plan_repo: 'Perjanjian-Baru-Pendau' } });
    expect(writes()).toEqual([]);
  });

  test('without a session the apply is session_expired, and Door43 is not asked', async () => {
    const error = await failure(apply('any', null));
    expect(error?.code).toBe('session_expired');
    expect(sent).toEqual([]);
  });
});

describe('X1: a commit whose outcome is unknown is never sent again', () => {
  test('X1: a network failure is one contents call, answered as commit_failed with the outcome unknown and recorded; a second apply on an unmoved branch reads and writes nothing', async () => {
    const made = await plan();
    state.commit = 'network';
    const first = await failure(apply(made.id));
    expect(first).toMatchObject({ code: 'commit_failed', details: { outcome: 'unknown' } });
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
    expect(storedPlan(made.id).payload.commit).toMatchObject({ outcome: 'unknown', attempted_at: '2026-10-08T12:00:00.000Z' });
    sent = [];
    state.commit = 'created';
    const second = await failure(apply(made.id));
    expect(second).toMatchObject({ code: 'commit_failed', details: { outcome: 'unknown' } });
    expect(writes()).toEqual([]);
  });

  test('X1: once the branch holds every planned file blob for blob, a later apply adopts the head commit, writes nothing, and answers its receipt from then on', async () => {
    const made = await plan();
    state.commit = 'network';
    await failure(apply(made.id));
    const call = contentsCall();
    const { gitBlobSha } = await import('../../src/model/git-blob');
    const blobs = await Promise.all(call.files.map(async file => ({ path: file.path, type: 'blob', sha: await gitBlobSha(decode64(file.content)) })));
    state.head = COMMIT;
    state.trees.set(COMMIT, { sha: 't'.repeat(40), tree: [...tree.tree.filter(entry => !blobs.some(b => b.path === entry.path)), ...blobs] });
    sent = [];
    const adopted = await apply(made.id);
    expect(adopted.wrote).toEqual([{ kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@master', sha: COMMIT, url: `https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/commit/${COMMIT}` }]);
    expect(writes()).toEqual([]);
    sent = [];
    expect(await apply(made.id)).toEqual(adopted);
    expect(sent.map(request => request.path)).toEqual(['/api/v1/user']);
  });

  test('X1: a commit Door43 refused is commit_failed quoting its message, with the outcome failed; the plan may then be applied again, which commits once', async () => {
    const made = await plan();
    state.commit = 422;
    const refused = await failure(apply(made.id));
    expect(refused).toMatchObject({ code: 'commit_failed', details: { outcome: 'failed', door43_status: 422 } });
    expect(refused?.message).toBe('Commit failed: sha does not match [given: 0, expected: 1].');
    sent = [];
    state.commit = 'created';
    const receipt = await apply(made.id);
    expect(receipt.wrote[0]).toMatchObject({ sha: COMMIT });
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
  });
});
