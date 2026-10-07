// `project.create.retry` (#31): a project whose setup is incomplete gets its
// first commit from the plan the apply kept, once, after the repository's
// permission and state are read (A2, X1); a commit Door43 made already is
// adopted, never made twice; a repository is never created or deleted (W4);
// a name the plan could not learn it took is adopted only under Q29's rule;
// the same retry answers the same receipt. Door43 is a stub over the recorded
// QA responses (E27, E43, E45) that keeps each repository's files.
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { OperationInput } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { gitBlobSha } from '../../src/model/git-blob';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import type { StoredAttempt, StoredPlan } from '../../src/operations/plans';
import { projectCreateApply } from '../../src/operations/project-create-apply';
import { projectCreatePlan } from '../../src/operations/project-create-plan';
import type { ProjectCreatePayload } from '../../src/operations/project-create-plan';
import { adoptable, createdSinceAttempt, projectCreateRetry } from '../../src/operations/project-create-retry';

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

/** A repository as the stub keeps it: who owns it, when Door43 created it, and its default branch's files, `null` before a first commit. */
interface Repository {
  owner: string;
  created_at: string;
  files: { path: string; sha: string }[] | null;
  push: boolean;
}

interface Sent {
  method: string;
  path: string;
}

let kv: MemoryKV;
let sent: Sent[];
let repositories: Map<string, Repository>;
/** What the contents endpoint does: commit and answer; refuse with a status; commit and lose the answer; or lose the request before Door43 commits. */
let commitAnswer: 'created' | number | 'lost-after-commit' | 'lost-before-commit';
/** What the create endpoint does: create and answer, or create and lose the answer (Q29). */
let createAnswer: 'created' | 'lost-after-create';
let clock: Date;

const door43: Fetch = async (url, init) => {
  const { pathname } = new URL(url);
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  sent.push({ method, path: pathname });
  if (pathname === '/api/v1/user') return Response.json(user);
  if (pathname === '/api/v1/user/teams') return Response.json(Number(new URL(url).searchParams.get('page') ?? '1') === 1 ? teams : []);
  const repo = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (repo && method === 'GET') {
    const found = repositories.get(`${repo[1]}/${repo[2]}`);
    if (!found) return new Response('', { status: 404 });
    return Response.json({
      ...createdRepo,
      name: repo[2],
      full_name: `${found.owner}/${repo[2]}`,
      html_url: `https://qa.door43.org/${found.owner}/${repo[2]}`,
      owner: { ...(createdRepo.owner as object), login: found.owner },
      empty: found.files === null,
      created_at: found.created_at,
      permissions: { admin: found.push, push: found.push, pull: true },
    });
  }
  if (method === 'POST' && (pathname === '/api/v1/orgs/tc-admin-qa-org/repos' || pathname === '/api/v1/user/repos')) {
    const name = String(body!.name);
    const owner = pathname.startsWith('/api/v1/orgs/') ? 'tc-admin-qa-org' : 'tc-admin-qa';
    repositories.set(`${owner}/${name}`, { owner, created_at: `${clock.toISOString().slice(0, 19)}Z`, files: null, push: true });
    if (createAnswer === 'lost-after-create') throw new TypeError('fetch failed');
    return Response.json({ ...createdRepo, name, full_name: `${owner}/${name}`, html_url: `https://qa.door43.org/${owner}/${name}` }, { status: 201 });
  }
  const contents = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/contents$/.exec(pathname);
  if (method === 'POST' && contents) {
    if (commitAnswer === 'lost-before-commit') throw new TypeError('fetch failed');
    if (typeof commitAnswer === 'number') return Response.json({ message: 'the server broke' }, { status: commitAnswer });
    const target = repositories.get(`${contents[1]}/${contents[2]}`)!;
    if (target.files !== null) return Response.json({ message: 'repository file already exists [path: metadata.json]' }, { status: 422 });
    const files = body!.files as { path: string; content: string }[];
    target.files = await Promise.all(files.map(async file => ({ path: file.path, sha: await gitBlobSha(new Uint8Array(Buffer.from(file.content, 'base64'))) })));
    if (commitAnswer === 'lost-after-commit') throw new TypeError('fetch failed');
    return Response.json(firstCommit, { status: 201 });
  }
  const tree = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^/]+)$/.exec(pathname);
  if (tree && method === 'GET') {
    const found = repositories.get(`${tree[1]}/${tree[2]}`);
    if (!found?.files) return new Response('', { status: 404 });
    // Read by branch, Door43 names the commit as the tree's sha (E19, E14).
    return Response.json({ sha: firstCommit.commit.sha, tree: found.files.map(file => ({ ...file, type: 'blob', mode: '100644', size: 1 })), truncated: false, page: 1, total_count: found.files.length });
  }
  return new Response('', { status: 404 });
};

const context = (token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-9', token, kv);
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
const plan = () => projectCreatePlan(OPERATIONS['project.create.plan'].input.parse(planInput), context());
const apply = (plan_id: string) => projectCreateApply({ plan_id }, context());
const retry = (plan_id: string, extra: Partial<{ owner: string; repo: string }> = {}, token: string | null = 'door43-token') =>
  projectCreateRetry(OPERATIONS['project.create.retry'].input.parse({ owner: 'tc-admin-qa-org', repo: 'id_tcap', plan_id, ...extra }), context(token));
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const writesSent = () => sent.filter(request => request.method !== 'GET').map(request => `${request.method} ${request.path}`);
const storedPlan = (id: string) => JSON.parse(kv.entries.get(`plan:${id}`)!.value) as StoredPlan<ProjectCreatePayload>;
const COMMIT = 'POST /api/v1/repos/tc-admin-qa-org/id_tcap/contents';

/** A plan applied with a first commit that failed: the repository exists, empty, and the receipt says setup incomplete. */
async function incomplete(answer: typeof commitAnswer = 500) {
  const planned = await plan();
  commitAnswer = answer;
  const receipt = await apply(planned.id);
  expect(receipt.result.setup.state).toBe('incomplete');
  commitAnswer = 'created';
  sent = [];
  return planned;
}

beforeEach(() => {
  kv = new MemoryKV();
  sent = [];
  repositories = new Map();
  commitAnswer = 'created';
  createAnswer = 'created';
  clock = new Date('2026-10-05T15:00:00.000Z');
});

describe('a first commit that failed', () => {
  test('W4: the apply kept the repository and answered setup incomplete; the retry commits the plan\'s files once and answers setup complete, creating and deleting nothing', async () => {
    const planned = await incomplete();
    const receipt = OPERATIONS['project.create.retry'].output.parse(await retry(planned.id));
    expect(writesSent()).toEqual([COMMIT]);
    expect(sent.some(request => request.method === 'DELETE' || request.path.endsWith('/repos'))).toBe(false);
    expect(receipt).toMatchObject({ operation: 'project.create.retry', request_id: 'request-9', plan_id: planned.id, warnings: [] });
    expect(receipt.wrote).toEqual([{ kind: 'commit', target: 'tc-admin-qa-org/id_tcap@master', sha: firstCommit.commit.sha, url: expect.any(String) }]);
    expect(receipt.result).toMatchObject({
      ref: { owner: 'tc-admin-qa-org', repo: 'id_tcap' },
      project_type: 'bible',
      metadata_format: 'sb',
      coverage: { present: 0, target: 27, scope: 'nt', basis: 'archive' },
      health: { state: 'never_checked' },
      default_branch_head: { sha: firstCommit.commit.sha },
      setup: { state: 'complete', failed_step: null },
    });
    // The files committed are the plan's, byte for byte (W5).
    const files = repositories.get('tc-admin-qa-org/id_tcap')!.files!;
    const planFiles = storedPlan(planned.id).payload.files;
    expect(files).toEqual(await Promise.all(planFiles.map(async file => ({ path: file.path, sha: await gitBlobSha(file.content) }))));
  });

  test('W4: the plan stays retryable for the day it is kept with the receipt, past its thirty minutes', async () => {
    const planned = await incomplete();
    clock = new Date('2026-10-05T20:00:00.000Z');
    expect((await retry(planned.id)).result.setup.state).toBe('complete');
  });

  test('a repeated retry with the same plan id answers the same receipt and writes nothing more; the receipt is kept a day', async () => {
    const planned = await incomplete();
    const first = await retry(planned.id);
    sent = [];
    expect(await retry(planned.id)).toEqual(first);
    expect(writesSent()).toEqual([]);
    expect(kv.entries.get(`retry-receipt:${planned.id}`)!.ttl).toBe(86_400);
  });

  test('X1: a commit the retry sees refused is commit_failed with Door43\'s message, recorded on the plan, and the next retry commits once more', async () => {
    const planned = await incomplete();
    commitAnswer = 500;
    const error = (await failure(retry(planned.id)))!;
    expect(error.code).toBe('commit_failed');
    expect(error.message).toBe('Commit failed: the server broke.');
    expect(writesSent()).toEqual([COMMIT]);
    expect(storedPlan(planned.id).payload.first_commit).toEqual({ outcome: 'failed', door43_status: 500 });
    expect(kv.entries.has(`retry-receipt:${planned.id}`)).toBe(false);
    commitAnswer = 'created';
    sent = [];
    expect((await retry(planned.id)).result.setup.state).toBe('complete');
    expect(writesSent()).toEqual([COMMIT]);
  });
});

describe('a first commit whose outcome is unknown', () => {
  test('X1: Door43 did not make it: the retry reads the repository empty and commits once', async () => {
    const planned = await incomplete('lost-before-commit');
    expect(storedPlan(planned.id).payload.first_commit).toEqual({ outcome: 'unknown', door43_status: null });
    const receipt = await retry(planned.id);
    expect(writesSent()).toEqual([COMMIT]);
    expect(receipt.result.setup.state).toBe('complete');
  });

  test('X1: Door43 made it: the retry finds the plan\'s files on the default branch and adopts the commit, writing nothing', async () => {
    const planned = await incomplete('lost-after-commit');
    const receipt = OPERATIONS['project.create.retry'].output.parse(await retry(planned.id));
    expect(writesSent()).toEqual([]);
    expect(receipt.wrote).toEqual([]);
    expect(receipt.result.setup).toEqual({ state: 'complete', failed_step: null });
    expect(receipt.result.default_branch_head?.sha).toBe(firstCommit.commit.sha);
  });

  test('X1: a retry whose own commit has no answer is commit_failed with the outcome unknown, and the next retry reads before it commits, adopting what landed', async () => {
    const planned = await incomplete();
    commitAnswer = 'lost-after-commit';
    const error = (await failure(retry(planned.id)))!;
    expect(error.code).toBe('commit_failed');
    expect(error.details.outcome).toBe('unknown');
    expect(storedPlan(planned.id).payload.first_commit).toEqual({ outcome: 'unknown', door43_status: null });
    commitAnswer = 'created';
    sent = [];
    const receipt = await retry(planned.id);
    expect(writesSent()).toEqual([]);
    expect(receipt.result.setup.state).toBe('complete');
  });

  test('X1: a default branch with files other than the plan\'s is not this plan\'s first commit: commit_failed, and nothing is written', async () => {
    const planned = await incomplete();
    repositories.get('tc-admin-qa-org/id_tcap')!.files = [{ path: 'README.md', sha: 'someone-else' }];
    const error = (await failure(retry(planned.id)))!;
    expect(error.code).toBe('commit_failed');
    expect(error.details.reason).toBe('default branch differs from the plan');
    expect(writesSent()).toEqual([]);
  });
});

describe('the replay Q29 names', () => {
  test('Q29: the commit landed and the receipt\'s write failed; a replayed apply says setup incomplete; the retry tells the commit landed and adopts it, writing nothing', async () => {
    const planned = await plan();
    const put = kv.put.bind(kv);
    kv.put = async (key, value, options) => {
      if (key.startsWith('receipt:')) throw new Error('the request ended before its receipt was stored');
      return put(key, value, options);
    };
    await expect(apply(planned.id)).rejects.toThrow('the request ended');
    kv.put = put;
    const replay = await apply(planned.id);
    expect(replay.result.setup.state).toBe('incomplete');
    sent = [];
    const receipt = await retry(planned.id);
    expect(writesSent()).toEqual([]);
    expect(receipt.result.setup.state).toBe('complete');
    expect(receipt.result.default_branch_head?.sha).toBe(firstCommit.commit.sha);
  });

  test('Q29: an apply whose receipt lists its commit has a complete setup, and the retry writes nothing', async () => {
    const planned = await plan();
    await apply(planned.id);
    sent = [];
    const receipt = await retry(planned.id);
    expect(writesSent()).toEqual([]);
    expect(receipt.result.setup.state).toBe('complete');
  });
});

describe('a repository the plan could not learn it created (Q29)', () => {
  /** The create reached Door43 and its answer did not reach the apply: the apply fails, and applying again reads the name as taken. */
  async function lostCreation() {
    const planned = await plan();
    createAnswer = 'lost-after-create';
    expect((await failure(apply(planned.id)))!.code).toBe('door43_unavailable');
    createAnswer = 'created';
    expect((await failure(apply(planned.id)))!.code).toBe('name_taken');
    sent = [];
    return planned;
  }

  test('Q29, W4: the apply recorded its attempt before the create, in its own key, kept a day', async () => {
    const planned = await lostCreation();
    const attempt = JSON.parse(kv.entries.get(`attempt:${planned.id}`)!.value) as StoredAttempt<ProjectCreatePayload>;
    expect(attempt.attempted_at).toBe('2026-10-05T15:00:00.000Z');
    expect(attempt.stored.plan.id).toBe(planned.id);
    expect(kv.entries.get(`attempt:${planned.id}`)!.ttl).toBe(86_400);
    expect(storedPlan(planned.id).payload.created_repository).toBeUndefined();
  });

  test('Q29: an empty repository under the planned owner, created after the attempt, is adopted, recorded on the plan, and committed to once', async () => {
    const planned = await lostCreation();
    const receipt = await retry(planned.id);
    expect(writesSent()).toEqual([COMMIT]);
    expect(receipt.result.setup.state).toBe('complete');
    expect(storedPlan(planned.id).payload.created_repository).toMatchObject({ full_name: 'tc-admin-qa-org/id_tcap' });
  });

  test('Q29: once adopted, a retry after a commit with no answer still knows the repository is this plan\'s, and adopts the commit', async () => {
    const planned = await lostCreation();
    commitAnswer = 'lost-after-commit';
    expect((await failure(retry(planned.id)))!.code).toBe('commit_failed');
    commitAnswer = 'created';
    sent = [];
    expect((await retry(planned.id)).result.setup.state).toBe('complete');
    expect(writesSent()).toEqual([]);
  });

  test('Q29: the plan\'s own record lost past its thirty minutes, the attempt still carries the plan for the day', async () => {
    const planned = await lostCreation();
    kv.entries.delete(`plan:${planned.id}`);
    clock = new Date('2026-10-05T18:00:00.000Z');
    expect((await retry(planned.id)).result.setup.state).toBe('complete');
  });

  test('Q29: a repository with a commit, one created before the attempt, or one under another owner is name_taken, and nothing is written', async () => {
    for (const change of [
      (repo: Repository) => (repo.files = [{ path: 'README.md', sha: 'x' }]),
      (repo: Repository) => (repo.created_at = '2026-10-05T14:59:59Z'),
      (repo: Repository) => (repo.owner = 'someone-else'),
    ]) {
      kv = new MemoryKV();
      repositories = new Map();
      const planned = await lostCreation();
      change(repositories.get('tc-admin-qa-org/id_tcap')!);
      const error = (await failure(retry(planned.id)))!;
      expect(error.code).toBe('name_taken');
      expect(error.message).toBe('A repository named id_tcap already exists in tc-admin-qa-org. Change the abbreviation.');
      expect(writesSent()).toEqual([]);
    }
  });

  test('Q29: with no attempt recorded, nothing is adopted: name_taken, and nothing is written', async () => {
    const planned = await lostCreation();
    kv.entries.delete(`attempt:${planned.id}`);
    expect((await failure(retry(planned.id)))!.code).toBe('name_taken');
    expect(writesSent()).toEqual([]);
  });

  test('Q29: a store that refuses the attempt does not stop the apply', async () => {
    const planned = await plan();
    const put = kv.put.bind(kv);
    kv.put = async (key, value, options) => {
      if (key.startsWith('attempt:')) throw new Error('KV PUT failed: 500');
      return put(key, value, options);
    };
    expect((await apply(planned.id)).result.setup.state).toBe('complete');
  });

  test('Q29: the rule at the second Door43 gives: created in the attempt\'s second counts; a second before, or an unreadable time, does not', () => {
    expect(createdSinceAttempt('2026-10-05T15:00:00Z', '2026-10-05T15:00:00.900Z')).toBe(true);
    expect(createdSinceAttempt('2026-10-05T14:59:59Z', '2026-10-05T15:00:00.000Z')).toBe(false);
    expect(createdSinceAttempt(null, '2026-10-05T15:00:00.000Z')).toBe(false);
    const state = { repository: { id: 1, full_name: 'o/r', url: '', default_branch: 'master', permissions: { push: true, admin: true } }, owner: 'O', empty: null, created_at: '2026-10-05T15:00:01Z' };
    expect(adoptable(state, 'o', { stored: {} as StoredPlan, attempted_at: '2026-10-05T15:00:00.000Z' })).toBe(false);
    expect(adoptable({ ...state, empty: true }, 'o', { stored: {} as StoredPlan, attempted_at: '2026-10-05T15:00:00.000Z' })).toBe(true);
    expect(adoptable({ ...state, empty: true }, 'o', null)).toBe(false);
  });
});

describe('what a retry refuses before writing', () => {
  test('A2: an account without push permission in the repository is permission_denied, and nothing is written', async () => {
    const planned = await incomplete();
    repositories.get('tc-admin-qa-org/id_tcap')!.push = false;
    expect((await failure(retry(planned.id)))!.code).toBe('permission_denied');
    expect(writesSent()).toEqual([]);
  });

  test('not_found when the repository is gone; the retry never creates one (W4)', async () => {
    const planned = await incomplete();
    repositories.delete('tc-admin-qa-org/id_tcap');
    expect((await failure(retry(planned.id)))!.code).toBe('not_found');
    expect(writesSent()).toEqual([]);
  });

  test('plan_expired for an unknown plan or another account\'s, and validation_failed for a plan of another project; nothing is written', async () => {
    expect((await failure(retry('no-such-plan')))!.code).toBe('plan_expired');
    const planned = await incomplete();
    const key = `plan:${planned.id}`;
    const mine = kv.entries.get(key)!;
    kv.entries.set(key, { ...mine, value: JSON.stringify({ ...JSON.parse(mine.value), account: 'someone-else' }) });
    kv.entries.delete(`attempt:${planned.id}`);
    expect((await failure(retry(planned.id)))!.code).toBe('plan_expired');
    kv.entries.set(key, mine);
    const other = (await failure(retry(planned.id, { repo: 'id_other' })))!;
    expect(other.code).toBe('validation_failed');
    expect(other.details.fields).toEqual([{ path: 'plan_id', message: 'the plan is for another project' }]);
    expect(writesSent()).toEqual([]);
  });

  test('session_expired without a session, and Door43 is not asked', async () => {
    expect((await failure(retry('any', {}, null)))!.code).toBe('session_expired');
    expect(sent).toEqual([]);
  });
});
