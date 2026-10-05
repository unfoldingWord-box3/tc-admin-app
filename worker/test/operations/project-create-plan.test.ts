// `project.create.plan` (#29) against the recorded QA responses for the test
// user (E43): the plan previews the metadata and the files, is bound to no
// source, announces the repository and one commit, and is stored for the apply.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { OperationInput } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { projectCreatePlan } from '../../src/operations/project-create-plan';
import type { ProjectCreatePayload } from '../../src/operations/project-create-plan';
import type { StoredPlan } from '../../src/operations/plans';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const recorded = <T>(path: string): T => (JSON.parse(readFileSync(new URL(path, fixtures), 'utf8')) as { response: { json: T } }).response.json;
const user = recorded<{ id: number; login: string }>('2026-10-05/user/user.json');
const teams = recorded<unknown[]>('2026-10-05/user/user__teams.json');
const pendau = JSON.parse(readFileSync(new URL('2026-09-21/repos/bahtraku__Perjanjian-Baru-Pendau.json', fixtures), 'utf8')) as object;

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

let kv: MemoryKV;
let calls: string[];
/** Repositories that exist, as `owner/repo`; a read of any other answers 404. */
let existing: Set<string>;
let teamsAnswer: unknown;

const door43: Fetch = async url => {
  const { pathname } = new URL(url);
  calls.push(pathname);
  if (pathname === '/api/v1/user') return Response.json(user);
  if (pathname === '/api/v1/user/teams') return Response.json(teamsAnswer);
  const repo = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (repo) return existing.has(`${decodeURIComponent(repo[1]!)}/${decodeURIComponent(repo[2]!)}`) ? Response.json(pendau) : new Response('', { status: 404 });
  return new Response('', { status: 404 });
};

const NOW = new Date('2026-10-05T15:00:00.000Z');
const context = (token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', token, kv);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch: door43 } : null, now: () => NOW };
};

const input = (extra: Partial<OperationInput<'project.create.plan'>> = {}): OperationInput<'project.create.plan'> => ({
  owner: 'tc-admin-qa-org',
  project_type: 'bible',
  title: 'Alkitab Percobaan',
  abbreviation: 'TCAP',
  language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' },
  testament_scope: 'nt',
  license: 'cc-by-sa-4.0',
  ...extra,
});
const parsed = (extra: Partial<OperationInput<'project.create.plan'>> = {}) => OPERATIONS['project.create.plan'].input.parse(input(extra));
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));

beforeEach(() => {
  kv = new MemoryKV();
  calls = [];
  existing = new Set();
  teamsAnswer = teams;
});

describe('a Bible plan', () => {
  test('W1: previews Scripture Burrito metadata with tC Admin as generator and would write the repository and one commit, bound to no source', async () => {
    const plan = OPERATIONS['project.create.plan'].output.parse(await projectCreatePlan(parsed(), context()));
    expect(plan.operation).toBe('project.create.plan');
    expect(plan.created_at).toBe('2026-10-05T15:00:00.000Z');
    expect(plan.expires_at).toBe('2026-10-05T15:30:00.000Z');
    expect(plan.bound_to).toEqual({ default_branch_sha: null, release_tag: null, release_tag_sha: null });
    expect(plan.would_write).toEqual([
      { kind: 'repo', target: 'tc-admin-qa-org/id_tcap' },
      { kind: 'commit', target: 'tc-admin-qa-org/id_tcap@master' },
    ]);
    expect(plan.warnings).toEqual([]);
    expect(plan.preview.repo_name).toBe('id_tcap');
    expect(plan.preview.files.map(file => file.path)).toEqual(['metadata.json', 'ingredients/license.md', 'README.md']);
    expect(plan.preview.metadata_json).toMatchObject({
      format: 'scripture burrito',
      meta: { generator: { softwareName: 'tC Admin', userName: 'tc-admin-qa' } },
      identification: { name: { en: 'Alkitab Percobaan' }, abbreviation: { en: 'TCAP' }, primary: { dcs: { 'tc-admin-qa-org/id_tcap': { revision: 'master' } } } },
      type: { flavorType: { name: 'scripture', flavor: { name: 'textTranslation' } } },
    });
    expect(Object.keys((plan.preview.metadata_json.type as { flavorType: { currentScope: object } }).flavorType.currentScope)).toHaveLength(27);
    expect(calls).toEqual(['/api/v1/user', '/api/v1/user/teams', '/api/v1/repos/tc-admin-qa-org/id_tcap']);
  });

  test('R10: the previewed sizes and checksums are those of the stored files the apply will write, and the plan is kept thirty minutes with its account', async () => {
    const plan = await projectCreatePlan(parsed(), context());
    const entry = kv.entries.get(`plan:${plan.id}`)!;
    expect(entry.ttl).toBe(1800);
    const stored = JSON.parse(entry.value) as StoredPlan<ProjectCreatePayload>;
    expect(stored.account).toBe('tc-admin-qa');
    expect(stored.plan.id).toBe(plan.id);
    expect(stored.payload.owner).toEqual({ login: 'tc-admin-qa-org', kind: 'organization' });
    expect(stored.payload.repo_name).toBe('id_tcap');
    expect(stored.payload.files.map(file => file.path)).toEqual(plan.preview.files.map(file => file.path));
    for (const [index, file] of stored.payload.files.entries()) {
      const bytes = new TextEncoder().encode(file.content);
      expect(plan.preview.files[index]).toEqual({ path: file.path, size: bytes.length, md5: createHash('md5').update(bytes).digest('hex') });
    }
    expect(JSON.parse(stored.payload.files[0]!.content)).toEqual(plan.preview.metadata_json);
  });

  test('derives the repository name from the language and the abbreviation in lowercase', async () => {
    const plan = await projectCreatePlan(parsed({ language: { code: 'es-419', title: 'Español (Latinoamérica)' }, abbreviation: 'ULT ' }), context());
    expect(plan.preview.repo_name).toBe('es-419_ult');
    expect(plan.preview.metadata_json).toMatchObject({ languages: [{ tag: 'es-419', name: { en: 'Español (Latinoamérica)' } }], identification: { abbreviation: { en: 'ULT' } } });
  });

  test('two plans have two ids', async () => {
    const first = await projectCreatePlan(parsed(), context());
    const second = await projectCreatePlan(parsed(), context());
    expect(first.id).not.toBe(second.id);
    expect(kv.entries.size).toBe(2);
  });
});

describe('what a plan refuses', () => {
  test('name_taken when the owner already has a repository of that name, with the catalog message', async () => {
    existing.add('tc-admin-qa-org/id_tcap');
    const error = (await failure(projectCreatePlan(parsed(), context())))!;
    expect(error.code).toBe('name_taken');
    expect(error.message).toBe('A repository named id_tcap already exists in tc-admin-qa-org. Change the abbreviation.');
    expect(kv.entries.size).toBe(0);
  });

  test('A2: permission_denied for an owner where no team of the account may create repositories, failing closed, and nothing is stored', async () => {
    expect((await failure(projectCreatePlan(parsed({ owner: 'unfoldingWord' }), context())))!.code).toBe('permission_denied');
    teamsAnswer = [{ organization: { username: 'tc-admin-qa-org' }, permission: 'write', can_create_org_repo: false }];
    expect((await failure(projectCreatePlan(parsed(), context())))!.code).toBe('permission_denied');
    teamsAnswer = [{ organization: { username: 'tc-admin-qa-org' }, permission: 'write', can_create_org_repo: 'true' }];
    expect((await failure(projectCreatePlan(parsed(), context())))!.code).toBe('permission_denied');
    teamsAnswer = [{ organization: { username: 'tc-admin-qa-org' } }];
    expect((await failure(projectCreatePlan(parsed(), context())))!.code).toBe('permission_denied');
    expect(kv.entries.size).toBe(0);
    expect(calls.filter(path => path.startsWith('/api/v1/repos/'))).toEqual([]);
  });

  test('a team that may create, but is not the owner team, is enough', async () => {
    teamsAnswer = [{ organization: { username: 'tc-admin-qa-org' }, permission: 'write', can_create_org_repo: true }];
    expect((await projectCreatePlan(parsed(), context())).would_write[0]!.target).toBe('tc-admin-qa-org/id_tcap');
  });

  test('the account itself is an owner, planned under the account without a teams read (Q28)', async () => {
    const plan = await projectCreatePlan(parsed({ owner: 'TC-Admin-QA' }), context());
    expect(plan.would_write[0]).toEqual({ kind: 'repo', target: 'tc-admin-qa/id_tcap' });
    expect(calls).not.toContain('/api/v1/user/teams');
    const stored = JSON.parse(kv.entries.get(`plan:${plan.id}`)!.value) as StoredPlan<ProjectCreatePayload>;
    expect(stored.payload.owner).toEqual({ login: 'tc-admin-qa', kind: 'account' });
  });

  test.each([
    ['project_type', { project_type: 'obs' as const, testament_scope: null }],
    ['testament_scope', { testament_scope: null }],
    ['title', { title: '   ' }],
    ['abbreviation', { abbreviation: ' ' }],
    ['abbreviation', { abbreviation: 'my ult' }],
    ['language.code', { language: { code: 'not a tag', title: 'X' } }],
    ['language.title', { language: { code: 'xx', title: ' ' } }],
  ])('validation_failed naming %s, before Door43 is asked about the name', async (field, extra) => {
    const error = (await failure(projectCreatePlan(parsed(extra), context())))!;
    expect(error.code).toBe('validation_failed');
    expect(error.message.startsWith(`${field}: `)).toBe(true);
    expect(error.details).toEqual({ fields: [{ path: field, message: error.message.slice(field.length + 2) }] });
    expect(calls.filter(path => path.startsWith('/api/v1/repos/'))).toEqual([]);
    expect(kv.entries.size).toBe(0);
  });

  test('session_expired without a session, and Door43 is not asked', async () => {
    expect((await failure(projectCreatePlan(parsed(), context(null))))!.code).toBe('session_expired');
    expect(calls).toEqual([]);
  });
});
