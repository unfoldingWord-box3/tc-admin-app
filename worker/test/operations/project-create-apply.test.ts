// `project.create.apply` (#30): the plan's writes and nothing else (W5), with
// the session's token only (A3), after the permission is read again (A2);
// a failed first commit leaves the repository (W4) and is not retried (X1);
// the same plan applied twice writes once. Door43 answers with the recorded
// QA responses (E27, E43).
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { OperationInput } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { projectCreateApply } from '../../src/operations/project-create-apply';
import { projectCreatePlan } from '../../src/operations/project-create-plan';
import type { ProjectCreatePayload } from '../../src/operations/project-create-plan';
import type { StoredPlan } from '../../src/operations/plans';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const recorded = <T>(path: string): T => (JSON.parse(readFileSync(new URL(path, fixtures), 'utf8')) as { response: { json: T } }).response.json;
const user = recorded<{ id: number; login: string }>('2026-10-05/user/user.json');
const teams = recorded<unknown[]>('2026-10-05/user/user__teams.json');
const createdRepo = recorded<Record<string, unknown>>('2026-09-22/probe-write/03-create-repo.json');
const firstCommit = recorded<{ commit: { sha: string } }>('2026-09-22/probe-write/04-first-commit.json');

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
}

interface Sent {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

let kv: MemoryKV;
let sent: Sent[];
let existing: Set<string>;
let teamsAnswer: unknown;
/** What the contents endpoint answers: the recorded commit, a status, or a thrown network failure. */
let commitAnswer: 'created' | number | 'network' | 'broken-body';
let createAnswer: 'created' | number | 'broken-body';

const door43: Fetch = async (url, init) => {
  const { pathname } = new URL(url);
  const method = init?.method ?? 'GET';
  sent.push({ method, path: pathname, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
  if (pathname === '/api/v1/user') return Response.json(user);
  if (pathname === '/api/v1/user/teams') return Response.json(Number(new URL(url).searchParams.get('page') ?? '1') === 1 ? teamsAnswer : []);
  const repo = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (repo && method === 'GET') {
    return existing.has(`${repo[1]}/${repo[2]}`)
      ? Response.json({ ...createdRepo, name: repo[2], full_name: `${repo[1]}/${repo[2]}`, html_url: `https://qa.door43.org/${repo[1]}/${repo[2]}` })
      : new Response('', { status: 404 });
  }
  if (method === 'POST' && (pathname === '/api/v1/orgs/tc-admin-qa-org/repos' || pathname === '/api/v1/user/repos')) {
    if (typeof createAnswer === 'number') return Response.json({ message: 'refused' }, { status: createAnswer });
    const name = (sent.at(-1)!.body as { name: string }).name;
    const owner = pathname.startsWith('/api/v1/orgs/') ? 'tc-admin-qa-org' : 'tc-admin-qa';
    existing.add(`${owner}/${name}`);
    if (createAnswer === 'broken-body') return new Response(new ReadableStream({ start: controller => controller.error(new TypeError('terminated')) }), { status: 201 });
    return Response.json({ ...createdRepo, name, full_name: `${owner}/${name}`, html_url: `https://qa.door43.org/${owner}/${name}` }, { status: 201 });
  }
  if (method === 'POST' && /^\/api\/v1\/repos\/[^/]+\/[^/]+\/contents$/.test(pathname)) {
    if (commitAnswer === 'network') throw new TypeError('fetch failed');
    if (commitAnswer === 'broken-body') return new Response(new ReadableStream({ start: controller => controller.error(new TypeError('terminated')) }), { status: 201 });
    if (commitAnswer !== 'created') return Response.json({ message: 'the server broke' }, { status: commitAnswer });
    return Response.json(firstCommit, { status: 201 });
  }
  return new Response('', { status: 404 });
};

let clock: Date;
const context = (token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-7', token, kv);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch: door43 } : null, now: () => clock };
};

const planInput: OperationInput<'project.create.plan'> = {
  owner: 'tc-admin-qa-org',
  project_type: 'bible',
  title: 'Alkitab Percobaan',
  abbreviation: 'TCAP',
  language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' },
  testament_scope: 'nt',
  license: 'cc-by-sa-4.0',
};
const plan = (extra: Partial<OperationInput<'project.create.plan'>> = {}) => projectCreatePlan(OPERATIONS['project.create.plan'].input.parse({ ...planInput, ...extra }), context());
const apply = (plan_id: string, token: string | null = 'door43-token') => projectCreateApply({ plan_id }, context(token));
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const writesSent = () => sent.filter(request => request.method !== 'GET').map(request => `${request.method} ${request.path}`);

beforeEach(() => {
  kv = new MemoryKV();
  sent = [];
  existing = new Set();
  teamsAnswer = teams;
  commitAnswer = 'created';
  createAnswer = 'created';
  clock = new Date('2026-10-05T15:00:00.000Z');
});

describe('a successful apply', () => {
  test('W5: creates the repository and makes exactly one contents call with the plan\'s three files, and the receipt\'s wrote equals the plan\'s would_write', async () => {
    const planned = await plan();
    sent = [];
    const receipt = OPERATIONS['project.create.apply'].output.parse(await apply(planned.id));
    expect(writesSent()).toEqual(['POST /api/v1/orgs/tc-admin-qa-org/repos', 'POST /api/v1/repos/tc-admin-qa-org/id_tcap/contents']);
    const commit = sent.find(request => request.path.endsWith('/contents'))!.body as { message: string; files: { operation: string; path: string; content: string }[] };
    expect(commit.files.map(file => [file.operation, file.path])).toEqual([
      ['create', 'metadata.json'],
      ['create', 'ingredients/license.md'],
      ['create', 'README.md'],
    ]);
    const stored = JSON.parse(kv.entries.get(`plan:${planned.id}`)!.value) as StoredPlan<{ files: { path: string; content: string }[] }>;
    for (const [index, file] of stored.payload.files.entries()) expect(Buffer.from(commit.files[index]!.content, 'base64').toString('utf8')).toBe(file.content);
    expect(JSON.parse(stored.payload.files[0]!.content)).toEqual(planned.preview.metadata_json);
    expect(commit.message.startsWith('Create Alkitab Percobaan')).toBe(true);
    expect(receipt.wrote.map(({ kind, target }) => ({ kind, target }))).toEqual(planned.would_write);
    expect(receipt.wrote[1]!.sha).toBe(firstCommit.commit.sha);
    expect(receipt).toMatchObject({ operation: 'project.create.apply', request_id: 'request-7', plan_id: planned.id, warnings: [] });
  });

  test('A3: every write carries the session\'s bearer token and no other credential, and names no author or committer', async () => {
    const planned = await plan();
    sent = [];
    await apply(planned.id);
    const writes = sent.filter(request => request.method !== 'GET');
    expect(writes).toHaveLength(2);
    for (const request of writes) {
      expect(request.headers.get('authorization')).toBe('Bearer door43-token');
      expect(request.headers.has('cookie')).toBe(false);
      expect(Object.keys(request.body as object)).not.toContain('author');
      expect(Object.keys(request.body as object)).not.toContain('committer');
    }
  });

  test('the receipt\'s result is the new project\'s report: a Scripture Burrito Bible, editable, no books yet, health never checked, the first commit as head', async () => {
    const planned = await plan();
    const { result } = await apply(planned.id);
    expect(result).toMatchObject({
      ref: { owner: 'tc-admin-qa-org', repo: 'id_tcap', id: 96475, url: 'https://qa.door43.org/tc-admin-qa-org/id_tcap' },
      title: 'Alkitab Percobaan',
      default_branch: 'master',
      language: { code: 'id', title: 'Bahasa Indonesia' },
      project_type: 'bible',
      metadata_format: 'sb',
      editability: { state: 'editable' },
      coverage: { present: 0, target: 27, scope: 'nt', basis: 'archive' },
      health: { state: 'never_checked', severity_raw: null, ref: 'master', checked_at: null, issue_count: null, source: 'door43' },
      latest_full_release: null,
      default_branch_head: { sha: firstCommit.commit.sha, committed_at: '2026-09-22T19:49:22Z' },
      active_preparation: null,
      setup: { state: 'complete', failed_step: null },
      permissions: { push: true, admin: true, checked_at: '2026-10-05T15:00:00.000Z' },
      freshness: { source: 'live', age_seconds: 0 },
    });
    expect(result.coverage.units).toHaveLength(27);
    expect(result.coverage.units.every(unit => !unit.present)).toBe(true);
  });

  test('a repeated apply with the same plan id answers the same receipt and writes nothing more; the receipt is kept a day', async () => {
    const planned = await plan();
    const first = await apply(planned.id);
    sent = [];
    const again = await apply(planned.id);
    expect(again).toEqual(first);
    expect(writesSent()).toEqual([]);
    expect(kv.entries.get(`receipt:${planned.id}`)!.ttl).toBe(86_400);
  });

  test('the account itself is created under /user/repos (Q28)', async () => {
    const planned = await plan({ owner: 'tc-admin-qa' });
    sent = [];
    const receipt = await apply(planned.id);
    expect(writesSent()).toEqual(['POST /api/v1/user/repos', 'POST /api/v1/repos/tc-admin-qa/id_tcap/contents']);
    expect(receipt.wrote[0]!.target).toBe('tc-admin-qa/id_tcap');
  });
});

describe('what an apply refuses before writing', () => {
  test('A2: a plan whose owner no longer grants creation is permission_denied, and nothing is written', async () => {
    for (const answer of [
      [{ id: 1, organization: { username: 'tc-admin-qa-org' }, permission: 'write', can_create_org_repo: false }],
      [{ id: 1, organization: { username: 'tc-admin-qa-org' }, permission: 'write', can_create_org_repo: 'true' }],
      [],
    ]) {
      teamsAnswer = teams;
      const planned = await plan();
      teamsAnswer = answer;
      sent = [];
      expect((await failure(apply(planned.id)))!.code).toBe('permission_denied');
      expect(writesSent()).toEqual([]);
      expect(kv.entries.has(`receipt:${planned.id}`)).toBe(false);
    }
  });

  test('name_taken when the name was taken since the plan, and nothing is written', async () => {
    const planned = await plan();
    existing.add('tc-admin-qa-org/id_tcap');
    sent = [];
    expect((await failure(apply(planned.id)))!.code).toBe('name_taken');
    expect(writesSent()).toEqual([]);
  });

  test('plan_expired for an unknown id, an expired plan, or another account\'s plan, and nothing is written', async () => {
    expect((await failure(apply('no-such-plan')))!.code).toBe('plan_expired');
    const planned = await plan();
    clock = new Date('2026-10-05T15:30:00.000Z');
    expect((await failure(apply(planned.id)))!.code).toBe('plan_expired');
    clock = new Date('2026-10-05T15:00:00.000Z');
    const key = `plan:${planned.id}`;
    kv.entries.set(key, { ...kv.entries.get(key)!, value: JSON.stringify({ ...JSON.parse(kv.entries.get(key)!.value), account: 'someone-else' }) });
    expect((await failure(apply(planned.id)))!.code).toBe('plan_expired');
    expect(writesSent()).toEqual([]);
  });

  test('Door43 refusing the repository is answered as the catalog code, and no commit follows', async () => {
    for (const [status, code] of [[409, 'name_taken'], [403, 'permission_denied'], [422, 'validation_failed'], [500, 'door43_unavailable']] as const) {
      const planned = await plan();
      createAnswer = status;
      sent = [];
      expect((await failure(apply(planned.id)))!.code, String(status)).toBe(code);
      expect(writesSent()).toEqual(['POST /api/v1/orgs/tc-admin-qa-org/repos']);
      expect(kv.entries.has(`receipt:${planned.id}`)).toBe(false);
    }
  });

  test('session_expired without a session, and Door43 is not asked', async () => {
    expect((await failure(apply('any', null)))!.code).toBe('session_expired');
    expect(sent).toEqual([]);
  });
});

describe('a repository whose creation answer broke off', () => {
  test('X1, W4: Door43 said 201 and the body broke off: the repository is read back, recorded on the plan, and the apply completes', async () => {
    const planned = await plan();
    createAnswer = 'broken-body';
    sent = [];
    const receipt = OPERATIONS['project.create.apply'].output.parse(await apply(planned.id));
    expect(receipt.warnings).toEqual([]);
    expect(receipt.result.ref).toMatchObject({ owner: 'tc-admin-qa-org', repo: 'id_tcap', id: 96475 });
    expect(sent.filter(request => request.method === 'GET' && request.path === '/api/v1/repos/tc-admin-qa-org/id_tcap')).toHaveLength(2);
    expect(writesSent()).toEqual(['POST /api/v1/orgs/tc-admin-qa-org/repos', 'POST /api/v1/repos/tc-admin-qa-org/id_tcap/contents']);
    const stored = JSON.parse(kv.entries.get(`plan:${planned.id}`)!.value) as StoredPlan<ProjectCreatePayload>;
    expect(stored.payload.created_repository).toMatchObject({ id: 96475, full_name: 'tc-admin-qa-org/id_tcap' });
  });
});

describe('a first commit that fails', () => {
  test('W4: the repository is kept, the receipt lists the repository only and warns setup_incomplete, the report says setup is incomplete, and the plan is kept for the retry', async () => {
    const planned = await plan();
    commitAnswer = 500;
    sent = [];
    const receipt = OPERATIONS['project.create.apply'].output.parse(await apply(planned.id));
    expect(writesSent()).toEqual(['POST /api/v1/orgs/tc-admin-qa-org/repos', 'POST /api/v1/repos/tc-admin-qa-org/id_tcap/contents']);
    expect(sent.some(request => request.method === 'DELETE')).toBe(false);
    expect(receipt.wrote).toEqual([{ kind: 'repo', target: 'tc-admin-qa-org/id_tcap', url: 'https://qa.door43.org/tc-admin-qa-org/id_tcap' }]);
    expect(receipt.warnings).toEqual([{ code: 'setup_incomplete', message: 'Setup incomplete. The repository exists but its first commit failed.' }]);
    expect(receipt.result.setup).toEqual({ state: 'incomplete', failed_step: 'first_commit' });
    expect(receipt.result.default_branch_head).toBeNull();
    const stored = JSON.parse(kv.entries.get(`plan:${planned.id}`)!.value) as StoredPlan<{ repository_created?: boolean }>;
    expect(stored.payload.repository_created).toBe(true);
    expect(kv.entries.get(`plan:${planned.id}`)!.ttl).toBe(86_400);
    expect((JSON.parse(kv.entries.get(`plan:${planned.id}`)!.value) as StoredPlan<ProjectCreatePayload>).payload.first_commit).toEqual({ outcome: 'failed', door43_status: 500 });
  });

  test('X1: a commit whose outcome is unknown is not retried: one contents call, setup incomplete, and a repeated apply answers the same receipt without writing', async () => {
    const planned = await plan();
    commitAnswer = 'network';
    sent = [];
    const receipt = await apply(planned.id);
    expect(writesSent().filter(write => write.endsWith('/contents'))).toHaveLength(1);
    expect(receipt.warnings.map(warning => warning.code)).toEqual(['setup_incomplete']);
    sent = [];
    expect(await apply(planned.id)).toEqual(receipt);
    expect(writesSent()).toEqual([]);
    expect((JSON.parse(kv.entries.get(`plan:${planned.id}`)!.value) as StoredPlan<ProjectCreatePayload>).payload.first_commit).toEqual({ outcome: 'unknown', door43_status: null });
  });

  test('X1: a commit whose status arrives but whose body breaks off is an unknown outcome: setup incomplete, the receipt stored, and a repeated apply writes nothing', async () => {
    const planned = await plan();
    commitAnswer = 'broken-body';
    sent = [];
    const receipt = OPERATIONS['project.create.apply'].output.parse(await apply(planned.id));
    expect(writesSent()).toEqual(['POST /api/v1/orgs/tc-admin-qa-org/repos', 'POST /api/v1/repos/tc-admin-qa-org/id_tcap/contents']);
    expect(receipt.warnings.map(warning => warning.code)).toEqual(['setup_incomplete']);
    expect(kv.entries.has(`receipt:${planned.id}`)).toBe(true);
    sent = [];
    expect(await apply(planned.id)).toEqual(receipt);
    expect(writesSent()).toEqual([]);
    expect((JSON.parse(kv.entries.get(`plan:${planned.id}`)!.value) as StoredPlan<ProjectCreatePayload>).payload.first_commit).toEqual({ outcome: 'unknown', door43_status: 201 });
  });

  test('W4, X1: a commit refused at once still stores its outcome and its receipt within Workers KV\'s one write a second to a key', async () => {
    const planned = await plan();
    // Workers KV refuses a second write to the same key inside a second (429); the plan step's own write is long past.
    const put = kv.put.bind(kv);
    const lastWrite = new Map<string, number>();
    kv.put = async (key, value, options) => {
      const now = Date.now();
      if (now - (lastWrite.get(key) ?? -Infinity) < 1000) throw new Error('KV PUT failed: 429 Too Many Requests');
      lastWrite.set(key, now);
      return put(key, value, options);
    };
    commitAnswer = 403;
    sent = [];
    const receipt = OPERATIONS['project.create.apply'].output.parse(await apply(planned.id));
    expect(writesSent()).toEqual(['POST /api/v1/orgs/tc-admin-qa-org/repos', 'POST /api/v1/repos/tc-admin-qa-org/id_tcap/contents']);
    expect(receipt.warnings.map(warning => warning.code)).toEqual(['setup_incomplete']);
    expect(kv.entries.has(`receipt:${planned.id}`)).toBe(true);
    const stored = JSON.parse(kv.entries.get(`plan:${planned.id}`)!.value) as StoredPlan<ProjectCreatePayload>;
    expect(stored.payload.created_repository).toMatchObject({ full_name: 'tc-admin-qa-org/id_tcap' });
    expect(stored.payload.first_commit).toEqual({ outcome: 'failed', door43_status: 403 });
  });

  test('W4: a commit outcome the plan cannot store does not cost the apply its receipt; the repository marked before the commit stands', async () => {
    const planned = await plan();
    const put = kv.put.bind(kv);
    let planWrites = 0;
    kv.put = async (key, value, options) => {
      if (key.startsWith('plan:') && ++planWrites === 2) throw new Error('KV PUT failed: 500');
      return put(key, value, options);
    };
    commitAnswer = 500;
    sent = [];
    const receipt = OPERATIONS['project.create.apply'].output.parse(await apply(planned.id));
    expect(receipt.warnings.map(warning => warning.code)).toEqual(['setup_incomplete']);
    expect(kv.entries.has(`receipt:${planned.id}`)).toBe(true);
    const stored = JSON.parse(kv.entries.get(`plan:${planned.id}`)!.value) as StoredPlan<ProjectCreatePayload>;
    expect(stored.payload.created_repository).toMatchObject({ full_name: 'tc-admin-qa-org/id_tcap' });
    sent = [];
    expect(await apply(planned.id)).toEqual(receipt);
    expect(writesSent()).toEqual([]);
  });
});

describe('a repository this plan created, with no receipt stored', () => {
  test('X1: an apply that ended after creating the repository is answered setup_incomplete on the next apply, never name_taken, and nothing is written again', async () => {
    const planned = await plan();
    const put = kv.put.bind(kv);
    kv.put = async (key, value, options) => {
      if (key.startsWith('receipt:')) throw new Error('the request ended before its receipt was stored');
      return put(key, value, options);
    };
    await expect(apply(planned.id)).rejects.toThrow('the request ended');
    kv.put = put;
    expect(existing.has('tc-admin-qa-org/id_tcap')).toBe(true);
    sent = [];
    const receipt = OPERATIONS['project.create.apply'].output.parse(await apply(planned.id));
    expect(writesSent()).toEqual([]);
    expect(receipt.wrote).toEqual([{ kind: 'repo', target: 'tc-admin-qa-org/id_tcap', url: 'https://qa.door43.org/tc-admin-qa-org/id_tcap' }]);
    expect(receipt.warnings.map(warning => warning.code)).toEqual(['setup_incomplete']);
    expect(receipt.result.setup).toEqual({ state: 'incomplete', failed_step: 'first_commit' });
    expect(kv.entries.has(`receipt:${planned.id}`)).toBe(false);
  });

  test('X1: an apply sent while the first is still committing finds the repository marked on the plan and writes nothing', async () => {
    const planned = await plan();
    const pending: { second?: ReturnType<typeof projectCreateApply> } = {};
    const answer = door43;
    const pausing: Fetch = async (url, init) => {
      if (init?.method === 'POST' && url.endsWith('/contents') && !pending.second) {
        // The second apply answers while the first's commit is still in flight.
        pending.second = projectCreateApply({ plan_id: planned.id }, { ...context(), door43: { ...context().door43!, fetch: answer } });
        await pending.second;
      }
      return answer(url, init);
    };
    const base = context();
    sent = [];
    const first = await projectCreateApply({ plan_id: planned.id }, { ...base, door43: { ...base.door43!, fetch: pausing } });
    const concurrent = await pending.second!;
    expect(writesSent()).toEqual(['POST /api/v1/orgs/tc-admin-qa-org/repos', 'POST /api/v1/repos/tc-admin-qa-org/id_tcap/contents']);
    expect(concurrent.warnings.map(warning => warning.code)).toEqual(['setup_incomplete']);
    expect(first.warnings).toEqual([]);
    expect(await apply(planned.id)).toEqual(first);
  });
});
