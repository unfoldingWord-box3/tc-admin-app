// `upload.apply` (#75) against the recorded Pendau repository, tree, branch,
// and archive (E19, E34, E52, E63), each plan made by `upload.plan` over the
// same recordings: the files sent again must be the plan's (Q33); the checks
// run before any write, the permission read again (A2) and the binding
// re-checked (R5); then exactly one contents call with the planned files and
// metadata.json (W5), with the session's token only (A3); an unknown outcome
// is never sent again, and a later apply adopts the commit or reports (X1);
// the same plan id answers the same receipt (§1 rule 6). The commit's answer
// is the recorded one of 7 October 2026 (`setup-retry/03-POST-contents.json`).
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { ParsedInput } from '@tc-admin/shared/schema';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { gitBlobSha } from '../../src/model/git-blob';
import { md5 } from '../../src/model/md5';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import type { StoredPlan } from '../../src/operations/plans';
import { uploadApply } from '../../src/operations/upload-apply';
import type { UploadApplyPayload } from '../../src/operations/upload-apply';
import { uploadPlan } from '../../src/operations/upload-plan';
import { recorded } from '../support/recorded';

const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
const REPO = '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau';
/** The default-branch commit the recorded repository names (E52), at which the tree was read. */
const SHA = '2d9dbd1ee09b5a1c28edd8668462f6a64029619b';
/** Another commit, for a branch that moved. */
const MOVED = 'f'.repeat(40);
const raw = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../../fixtures/door43/qa.door43.org/${path}`, import.meta.url), 'utf8')) as T;
const user = recorded<unknown>('2026-10-05/user/user.json');
const repository = recorded<Record<string, unknown>>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const tree = recorded<{ sha: string; tree: { path: string; type: string; sha: string; size?: number }[] }>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau__git-trees__master.json.gz');
/** A release read by its tag, as recorded on QA (E27); Pendau's `v1.2` stands in its tag. */
const probeRelease = recorded<Record<string, unknown> & { published_at: string; door43_metadata: Record<string, unknown> }>('2026-09-22/probe-write/14-lookup-by-tag.json');
const release = { ...probeRelease, tag_name: 'v1.2', target_commitish: SHA, door43_metadata: { ...probeRelease.door43_metadata, commit_sha: SHA } };
/** The branch read's shape as recorded on 7 October 2026 (E63). */
const branch = raw<{ commit: Record<string, unknown> }>('2026-10-07/setup-retry/08-GET-branch.json');
/** The contents endpoint's answer to a commit, as recorded on QA on 7 October 2026 (E63). */
const committed = raw<{ commit: Record<string, unknown> }>('2026-10-07/setup-retry/03-POST-contents.json');
const COMMIT = 'c'.repeat(40);
const zip = new Uint8Array(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip', import.meta.url)));
const encode = (text: string) => new TextEncoder().encode(text);
const decode64 = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));

class MemoryKV implements KVNamespace {
  readonly entries = new Map<string, { value: string; ttl: number | undefined }>();
  async get(key: string) {
    return this.entries.get(key)?.value ?? null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.entries.set(key, { value, ttl: options?.expirationTtl });
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
  repo: Record<string, unknown>;
  head: string;
  /** The tree at each commit; Pendau's at `SHA`. */
  trees: Map<string, typeof tree>;
  /** The contents endpoint: the recorded commit, a status with a message, a network failure, or a body that breaks off. */
  commit: 'created' | number | 'network' | 'broken-body';
}

let kv: MemoryKV;
let sent: Sent[];
let state: Door43State;

const door43: Fetch = async (url, init) => {
  const { pathname, search } = new URL(url);
  const method = init?.method ?? 'GET';
  sent.push({ method, path: pathname + search, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
  if (pathname === '/api/v1/user') return Response.json(user);
  if (pathname === REPO && method === 'GET') return Response.json({ ...state.repo, permissions: state.writable ? { push: true, admin: false, pull: true } : { pull: true } });
  if (pathname === `${REPO}/branches/master`) return Response.json({ ...branch, name: 'master', commit: { ...branch.commit, id: state.head, url: `https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/commit/${state.head}` } });
  const treeAt = /^\/api\/v1\/repos\/bahtraku\/Perjanjian-Baru-Pendau\/git\/trees\/([0-9a-f]{40})$/.exec(pathname);
  if (treeAt) {
    const found = state.trees.get(treeAt[1]!);
    return found ? Response.json(found) : new Response('', { status: 404 });
  }
  if (pathname === `${REPO}/sb/${SHA}.zip`) return new Response(zip);
  if (pathname === `${REPO}/releases/tags/v1.2`) return Response.json(release);
  if (pathname === `${REPO}/contents` && method === 'POST') {
    if (state.commit === 'network') throw new TypeError('fetch failed');
    if (state.commit === 'broken-body') return new Response(new ReadableStream({ start: controller => controller.error(new TypeError('terminated')) }), { status: 201 });
    if (state.commit !== 'created') return Response.json({ message: 'sha does not match [given: 0, expected: 1]' }, { status: state.commit });
    return Response.json({ ...committed, commit: { ...committed.commit, sha: COMMIT, html_url: `https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/commit/${COMMIT}` } }, { status: 201 });
  }
  return new Response('', { status: 404 });
};

let clock: Date;
const context = (token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-75', token, kv);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch: door43 } : null, now: () => clock };
};
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
type Files = ParsedInput<'upload.plan'>['files'];
const upload = (name: string, content: Uint8Array | string, mode: number | null = null) => ({ name, mode, content: typeof content === 'string' ? encode(content) : content });
const plan = async (files: Files, confirmations?: ParsedInput<'upload.plan'>['confirmations']) => {
  const made = await uploadPlan({ ...PENDAU, files, ...(confirmations ? { confirmations } : {}) }, context());
  sent = [];
  return made;
};
const apply = (plan_id: string, files: Files, extra: Partial<ParsedInput<'upload.apply'>> = {}, token: string | null = 'door43-token') =>
  uploadApply({ ...PENDAU, plan_id, files, ...extra }, context(token));
const writes = () => sent.filter(request => request.method !== 'GET').map(request => `${request.method} ${request.path}`);
const contentsCall = () => sent.find(request => request.method === 'POST')!.body as { message: string; branch: string; files: { operation: string; path: string; content: string; sha?: string }[] } & Record<string, unknown>;
const storedPlan = (id: string) => JSON.parse(kv.entries.get(`plan:${id}`)!.value) as StoredPlan<UploadApplyPayload>;
const blob = (path: string) => tree.tree.find(entry => entry.path === path)!.sha;

let mat: string;
let jud: Uint8Array;
const GEN = '\\id GEN\n\\c 1\n\\v 1 Pada mulanya\n';
beforeAll(async () => {
  const archive = openArchive(zip);
  mat = new TextDecoder().decode(await archive.bytes('ingredients/MAT.usfm')).replace('\\v 1 ', '\\v 1 Revised ');
  jud = await archive.bytes('ingredients/JUD.usfm');
});

beforeEach(() => {
  kv = new MemoryKV();
  sent = [];
  state = { writable: true, repo: repository, head: SHA, trees: new Map([[SHA, tree]]), commit: 'created' };
  clock = new Date('2026-10-08T12:00:00.000Z');
});

describe('a successful apply', () => {
  test('W5, A3: exactly one Door43 write, one contents call on the default branch with every identified file and the plan\'s metadata.json, with the session\'s token only; the receipt\'s wrote is the plan\'s would_write', async () => {
    const files = [upload('41-MAT.usfm', mat), upload('books/GEN.usfm', GEN)];
    const made = await plan(files);
    const receipt = OPERATIONS['upload.apply'].output.parse(await apply(made.id, files));

    expect(writes()).toEqual([`POST ${REPO}/contents`]);
    // Before the write: the account, the repository (A2), the branch head (R5), the tree at that commit, and the latest full release for the report.
    expect(sent.filter(request => request.method === 'GET').map(request => request.path)).toEqual([
      '/api/v1/user',
      REPO,
      `${REPO}/branches/master`,
      `${REPO}/git/trees/${SHA}?recursive=true&per_page=1000&page=1`,
      `${REPO}/releases/tags/v1.2`,
    ]);
    expect(sent.at(-1)!.method).toBe('POST');
    for (const request of sent) {
      expect(request.headers.get('authorization')).toBe('Bearer door43-token');
      expect([...request.headers.keys()].sort()).toEqual(request.method === 'POST' ? ['accept', 'authorization', 'content-type'] : ['accept', 'authorization']);
    }

    const body = contentsCall();
    // No author or committer: Door43 attributes the commit to the token's user (A3).
    expect(Object.keys(body).sort()).toEqual(['branch', 'files', 'message']);
    expect(body.branch).toBe('master');
    expect(body.message).toMatch(/^Upload MAT, GEN\n\n/);
    expect(body.files.map(file => [file.operation, file.path, file.sha])).toEqual([
      ['update', 'ingredients/MAT.usfm', blob('ingredients/MAT.usfm')],
      ['create', 'ingredients/GEN.usfm', undefined],
      ['update', 'metadata.json', blob('metadata.json')],
    ]);
    // The bytes are the ones sent, unchanged (W1).
    expect(new TextDecoder().decode(decode64(body.files[0]!.content))).toBe(mat);
    expect(new TextDecoder().decode(decode64(body.files[1]!.content))).toBe(GEN);

    expect(made.would_write).toEqual([{ kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@master' }]);
    expect(receipt.wrote).toEqual([{ kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@master', sha: COMMIT, url: `https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/commit/${COMMIT}` }]);
    expect(receipt).toMatchObject({ operation: 'upload.apply', plan_id: made.id, request_id: 'request-75', warnings: [] });
  });

  test('R10: the committed metadata.json is the plan\'s byte for byte, and lists each file with its bytes\' size and md5', async () => {
    const files = [upload('41-MAT.usfm', mat), upload('GEN.usfm', GEN)];
    const made = await plan(files);
    const proposed = storedPlan(made.id).payload.metadata!;
    await apply(made.id, files);
    const written = new TextDecoder().decode(decode64(contentsCall().files.find(file => file.path === 'metadata.json')!.content));
    expect(written).toBe(proposed.content);
    const ingredients = (JSON.parse(written) as { ingredients: Record<string, { size: number; checksum: { md5: string } }> }).ingredients;
    for (const [path, text] of [['ingredients/MAT.usfm', mat], ['ingredients/GEN.usfm', GEN]] as const) {
      expect([ingredients[path]!.size, ingredients[path]!.checksum.md5]).toEqual([encode(text).length, md5(encode(text))]);
    }
  });

  test('H3, H5: the receipt\'s result is the project report: the commit as the default-branch head, coverage from the metadata committed, the latest full release, health not yet read', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    const receipt = await apply(made.id, files);
    const report = receipt.result;
    expect(report.ref).toMatchObject({ owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' });
    expect([report.project_type, report.metadata_format, report.editability.state]).toEqual(['bible', 'sb', 'editable']);
    expect(report.default_branch_head).toEqual({ sha: COMMIT, committed_at: '2026-10-07T23:52:58Z' });
    expect(report.coverage.basis).toBe('archive');
    // Pendau's New Testament with Genesis added: the testament scope widens to the whole Bible (H5), and Genesis is present.
    expect(report.coverage.scope).toBe('full');
    expect(report.coverage.units.find(unit => unit.id === 'gen')).toEqual({ id: 'gen', present: true });
    expect(report.coverage.units.find(unit => unit.id === 'exo')).toEqual({ id: 'exo', present: false });
    expect(report.health).toMatchObject({ state: 'never_checked', ref: COMMIT, checked_at: null });
    expect(report.latest_full_release).toEqual({ tag: 'v1.2', version: 'v1.2', sha: SHA, published_at: release.published_at, author: 'tc-admin-qa' });
    expect(report.setup).toEqual({ state: 'complete', failed_step: null });
    expect(report.permissions).toMatchObject({ push: true, admin: false });
  });

  test('S2: a file whose bytes are already the default branch\'s is left out of the commit; the others and metadata.json are written', async () => {
    const files = [upload('65-JUD.usfm', jud), upload('GEN.usfm', GEN)];
    const made = await plan(files);
    await apply(made.id, files);
    expect(contentsCall().files.map(file => file.path)).toEqual(['ingredients/GEN.usfm', 'metadata.json']);
  });

  test('§1 rule 6, X1: the same plan id answers the same receipt and writes nothing more', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    const first = await apply(made.id, files);
    expect(kv.entries.get(`receipt:${made.id}`)!.ttl).toBe(24 * 60 * 60);
    clock = new Date('2026-10-08T13:00:00.000Z');
    const again = await apply(made.id, files);
    expect(again).toEqual(first);
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
  });

  test('the plan\'s own confirmations may be sent again; the file they identify is committed at the confirmed book\'s path', async () => {
    const files = [upload('draft.usfm', '\\id JON\n\\c 1\n')];
    const made = await plan(files, { 'draft.usfm': { book: 'jon' } });
    await apply(made.id, files, { confirmations: { './draft.usfm': { book: 'JON' } } });
    expect(contentsCall().files.map(file => [file.operation, file.path])).toEqual([['create', 'ingredients/JON.usfm'], ['update', 'metadata.json']]);
  });
});

describe('refused before any write', () => {
  test('A2: a push permission lost since the plan is permission_denied, and nothing is written', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    state.writable = false;
    const error = await failure(apply(made.id, files));
    expect(error).toMatchObject({ code: 'permission_denied', details: PENDAU });
    expect(writes()).toEqual([]);
    expect(sent.map(request => request.path)).toEqual(['/api/v1/user', REPO]);
    expect(kv.entries.has(`receipt:${made.id}`)).toBe(false);
  });

  test('R5: a default branch that moved since the plan is source_changed, and nothing is written', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    state.head = MOVED;
    const error = await failure(apply(made.id, files));
    expect(error).toMatchObject({ code: 'source_changed', details: { bound: SHA, head: MOVED } });
    expect(writes()).toEqual([]);
  });

  test('R5: a file the plan overwrites that is no longer the blob it replaces is source_changed, and nothing is written', async () => {
    const files = [upload('41-MAT.usfm', mat)];
    const made = await plan(files);
    state.trees.set(SHA, { ...tree, tree: tree.tree.map(entry => (entry.path === 'ingredients/MAT.usfm' ? { ...entry, sha: 'e'.repeat(40) } : entry)) });
    const error = await failure(apply(made.id, files));
    expect(error).toMatchObject({ code: 'source_changed', details: { path: 'ingredients/MAT.usfm' } });
    expect(writes()).toEqual([]);
  });

  test('Q33: a file whose bytes differ from the plan\'s, one the plan lists and was not sent, and one it does not list are refused naming each; only the account is read, and nothing is written', async () => {
    const files = [upload('41-MAT.usfm', mat), upload('GEN.usfm', GEN)];
    const made = await plan(files);
    const error = await failure(apply(made.id, [upload('GEN.usfm', `${GEN}\\v 2 more\n`), upload('RUT.usfm', '\\id RUT\n')]));
    expect(error).toMatchObject({
      code: 'validation_failed',
      details: { files: [{ name: '41-MAT.usfm', reason: 'missing' }, { name: 'GEN.usfm', reason: 'content_differs' }, { name: 'RUT.usfm', reason: 'not_planned' }] },
    });
    expect(sent.map(request => request.path)).toEqual(['/api/v1/user']);
  });

  test('S5: a plan that held a file back is unidentified_file naming it, and nothing is written', async () => {
    const files = [upload('GEN.usfm', GEN), upload('notes.txt', 'catatan\n')];
    const made = await plan(files);
    const error = await failure(apply(made.id, files));
    expect(error).toMatchObject({ code: 'unidentified_file', message: 'notes.txt does not identify a book or story. Choose one or leave the file out.', details: { files: [{ name: 'notes.txt', reason: 'unidentified' }] } });
    expect(writes()).toEqual([]);
  });

  test('confirmations other than the plan\'s are validation_failed: a choice the plan did not show is planned again, never applied', async () => {
    const files = [upload('draft.usfm', '\\id JON\n\\c 1\n')];
    const made = await plan(files, { 'draft.usfm': { book: 'jon' } });
    const changed = await failure(apply(made.id, files, { confirmations: { 'draft.usfm': { book: 'rut' } } }));
    expect(changed).toMatchObject({ code: 'validation_failed', details: { reason: 'confirmations_differ' } });
    const dropped = await failure(apply(made.id, files, { confirmations: {} }));
    expect(dropped).toMatchObject({ code: 'validation_failed', details: { reason: 'confirmations_differ' } });
    expect(writes()).toEqual([]);
  });

  test('W6: an unsafe name sent at apply is refused before any Door43 read', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    const error = await failure(apply(made.id, [upload('../GEN.usfm', GEN)]));
    expect(error).toMatchObject({ code: 'validation_failed', details: { files: [{ name: '../GEN.usfm', reason: 'traversal' }] } });
    expect(sent).toEqual([]);
  });

  test('W2: a project no longer editable is not_editable with its reason, and nothing is written', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    state.repo = { ...repository, metadata_type: 'rc' };
    const error = await failure(apply(made.id, files));
    expect(error).toMatchObject({ code: 'not_editable' });
    expect(writes()).toEqual([]);
  });

  test('plan_expired: a plan past its thirty minutes, one another account made, an id no plan has, or a plan of another operation; and a plan for another project is refused', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    clock = new Date('2026-10-08T12:30:00.000Z');
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'plan_expired' });
    clock = new Date('2026-10-08T12:00:00.000Z');
    expect(await failure(apply('no-such-plan', files))).toMatchObject({ code: 'plan_expired' });
    const other = storedPlan(made.id);
    kv.entries.set(`plan:${made.id}`, { value: JSON.stringify({ ...other, account: 'someone-else' }), ttl: undefined });
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'plan_expired' });
    kv.entries.set(`plan:${made.id}`, { value: JSON.stringify({ ...other, plan: { ...other.plan, operation: 'project.create.plan' } }), ttl: undefined });
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'plan_expired' });
    kv.entries.set(`plan:${made.id}`, { value: JSON.stringify(other), ttl: undefined });
    expect(await failure(uploadApply({ owner: 'bahtraku', repo: 'another', plan_id: made.id, files }, context()))).toMatchObject({ code: 'validation_failed', details: { plan_repo: 'Perjanjian-Baru-Pendau' } });
    expect(writes()).toEqual([]);
  });

  test('without a session the apply is session_expired, and Door43 is not asked', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    expect(await failure(apply(made.id, files, {}, null))).toMatchObject({ code: 'session_expired' });
    expect(sent).toEqual([]);
  });
});

describe('X1: a commit whose outcome is unknown is never sent again', () => {
  test('X1: a network failure is one contents call, answered as commit_failed with the outcome unknown and recorded; a second apply on an unmoved branch reads and writes nothing', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    state.commit = 'network';
    const first = await failure(apply(made.id, files));
    expect(first).toMatchObject({ code: 'commit_failed', details: { outcome: 'unknown' } });
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
    expect(storedPlan(made.id).payload.commit).toMatchObject({ outcome: 'unknown' });
    expect(kv.entries.get(`attempt:${made.id}`)!.ttl).toBe(24 * 60 * 60);

    state.commit = 'created';
    const second = await failure(apply(made.id, files));
    expect(second).toMatchObject({ code: 'commit_failed', details: { outcome: 'unknown' } });
    expect(second!.message).toBe('Commit failed: Door43 did not confirm the commit, and the default branch does not show it.');
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
  });

  test('X1: an answer that breaks off is an unknown outcome; once the branch holds every planned file blob for blob, a later apply adopts the head commit, writes nothing, and answers its receipt from then on', async () => {
    const files = [upload('41-MAT.usfm', mat), upload('GEN.usfm', GEN)];
    const made = await plan(files);
    state.commit = 'broken-body';
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'commit_failed', details: { outcome: 'unknown' } });
    const metadata = decode64(contentsCall().files.find(file => file.path === 'metadata.json')!.content);

    // Door43 made the commit after all: the branch's head holds the planned files, blob for blob.
    const landed = new Map([
      ['ingredients/MAT.usfm', await gitBlobSha(mat)],
      ['ingredients/GEN.usfm', await gitBlobSha(GEN)],
      ['metadata.json', await gitBlobSha(metadata)],
    ]);
    const after = { ...tree, sha: 'a'.repeat(40), tree: [...tree.tree.map(entry => (landed.has(entry.path) ? { ...entry, sha: landed.get(entry.path)! } : entry)), { path: 'ingredients/GEN.usfm', type: 'blob', sha: landed.get('ingredients/GEN.usfm')! }] };
    state.head = MOVED;
    state.trees.set(MOVED, after);
    // Past the plan's thirty minutes: reading and adopting needs no live plan.
    clock = new Date('2026-10-08T14:00:00.000Z');
    const adopted = await apply(made.id, files);
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
    expect(adopted.wrote).toEqual([{ kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@master', sha: MOVED, url: `https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/commit/${MOVED}` }]);
    expect(adopted.result.default_branch_head?.sha).toBe(MOVED);
    expect(await apply(made.id, files)).toEqual(adopted);
  });

  test('X1: after an unknown outcome, a branch someone else moved without the planned files is source_changed, and nothing is written', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    state.commit = 'network';
    await failure(apply(made.id, files));
    state.head = MOVED;
    state.trees.set(MOVED, tree);
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'source_changed' });
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
  });

  test('X1: a commit Door43 refused is commit_failed quoting its message, with the outcome failed; the plan may then be applied again, which commits once', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    clock = new Date('2026-10-08T12:00:05.000Z');
    state.commit = 409;
    const refused = await failure(apply(made.id, files));
    expect(refused).toMatchObject({ code: 'commit_failed', message: 'Commit failed: sha does not match [given: 0, expected: 1].', details: { outcome: 'failed', door43_status: 409 } });
    expect(storedPlan(made.id).payload.commit).toMatchObject({ outcome: 'failed', door43_status: 409 });

    state.commit = 'created';
    clock = new Date('2026-10-08T12:01:00.000Z');
    const receipt = await apply(made.id, files);
    expect(receipt.wrote).toHaveLength(1);
    expect(writes()).toEqual([`POST ${REPO}/contents`, `POST ${REPO}/contents`]);
  });

  test('X1: a commit Door43 refused is not adopted when the branch has since moved onto a tree holding the planned blobs; it is source_changed, with no receipt', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    state.commit = 409;
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'commit_failed', details: { outcome: 'failed' } });
    const metadata = decode64(contentsCall().files.find(file => file.path === 'metadata.json')!.content);
    const landed = new Map([['ingredients/GEN.usfm', await gitBlobSha(GEN)], ['metadata.json', await gitBlobSha(metadata)]]);
    const after = { ...tree, sha: MOVED, tree: [...tree.tree.map(entry => (landed.has(entry.path) ? { ...entry, sha: landed.get(entry.path)! } : entry)), { path: 'ingredients/GEN.usfm', type: 'blob', sha: landed.get('ingredients/GEN.usfm')! }] };
    state.head = MOVED;
    state.trees.set(MOVED, after);
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'source_changed', details: { bound: SHA, head: MOVED } });
    expect(kv.entries.has(`receipt:${made.id}`)).toBe(false);
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
  });

  test('X1: an outcome recorded as unknown stays unknown after the attempt\'s key is gone; an apply on an unmoved branch writes nothing', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    state.commit = 'network';
    await failure(apply(made.id, files));
    kv.entries.delete(`attempt:${made.id}`);
    state.commit = 'created';
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'commit_failed', details: { outcome: 'unknown' } });
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
  });

  test('X1: an attempt the store refuses to record stops the apply before any write, as commit_failed with the outcome failed; the plan may be applied again', async () => {
    const files = [upload('GEN.usfm', GEN)];
    const made = await plan(files);
    const put = kv.put.bind(kv);
    kv.put = async (key, value, options) => {
      if (key.startsWith('attempt:')) throw new Error('KV unavailable');
      return put(key, value, options);
    };
    expect(await failure(apply(made.id, files))).toMatchObject({ code: 'commit_failed', details: { outcome: 'failed', reason: 'attempt_not_recorded' } });
    expect(writes()).toEqual([]);
    expect(storedPlan(made.id).payload.commit).toBeUndefined();
    kv.put = put;
    expect((await apply(made.id, files)).wrote).toHaveLength(1);
    expect(writes()).toEqual([`POST ${REPO}/contents`]);
  });

  test('X1: a 5xx or a 408 from the contents call is an unknown outcome, recorded; a second apply on an unmoved branch writes nothing', async () => {
    for (const status of [500, 504, 408]) {
      const files = [upload('GEN.usfm', GEN)];
      const made = await plan(files);
      state.commit = status;
      expect(await failure(apply(made.id, files))).toMatchObject({ code: 'commit_failed', details: { outcome: 'unknown', door43_status: status } });
      expect(storedPlan(made.id).payload.commit).toMatchObject({ outcome: 'unknown', door43_status: status });
      state.commit = 'created';
      expect(await failure(apply(made.id, files))).toMatchObject({ code: 'commit_failed', details: { outcome: 'unknown' } });
      expect(writes()).toEqual([`POST ${REPO}/contents`]);
    }
  });
});
