// `project.create.plan` (#29) against the recorded QA responses for the test
// user (E43): the plan previews the metadata and the files, is bound to no
// source, announces the repository and one commit, and is stored for the apply.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
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

// The recorded Scripture Burrito schema (E44), loaded as `worker/test/model/burrito.test.ts` loads it.
const SCHEMA_DIR = new URL('../../../fixtures/scripture-burrito/2026-10-05/schema/', import.meta.url);
const schemaFiles = (dir: URL): URL[] =>
  readdirSync(dir).flatMap(name => {
    const entry = new URL(name, dir);
    if (statSync(entry).isDirectory()) return schemaFiles(new URL(`${name}/`, dir));
    return name.endsWith('.schema.json') && name !== 'scripture_flavor_type.schema.json' ? [entry] : [];
  });
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
for (const file of schemaFiles(SCHEMA_DIR)) ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')) as object);
const validateSource = ajv.getSchema('https://burrito.bible/schema/source_metadata.schema.json')!;

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
/** When set, the teams list by page (1-based), for the pagination tests. */
let teamsPages: unknown[][] | null;

const door43: Fetch = async url => {
  const { pathname } = new URL(url);
  calls.push(pathname);
  if (pathname === '/api/v1/user') return Response.json(user);
  if (pathname === '/api/v1/user/teams') {
    // Door43 pages the list (E43): the fake answers page 1, or `teamsPages[n]`, and an empty page after the last.
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    const pages = teamsPages ?? [teamsAnswer];
    return Response.json(pages[page - 1] ?? []);
  }
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
  teamsPages = null;
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
    // The teams list is read to its empty last page (E43), then the name is checked.
    expect(calls).toEqual(['/api/v1/user', '/api/v1/user/teams', '/api/v1/user/teams', '/api/v1/repos/tc-admin-qa-org/id_tcap']);
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

  test.each([
    ['id', 'Bahasa Indonesia'],
    ['es-419', 'Español (Latinoamérica)'],
    ['el-x-koine', 'Koine Greek'],
    ['zh-Hant-TW', '中文 (台灣)'],
  ])('W1: the stored metadata.json validates against the recorded Scripture Burrito schema (language %s)', async (code, title) => {
    const plan = await projectCreatePlan(parsed({ language: { code, title } }), context());
    const stored = JSON.parse(kv.entries.get(`plan:${plan.id}`)!.value) as StoredPlan<ProjectCreatePayload>;
    const written = JSON.parse(stored.payload.files[0]!.content) as unknown;
    expect(validateSource(written), JSON.stringify(validateSource.errors, null, 2)).toBe(true);
  });

  test('W1: an Open Bible Stories plan has no testament scope and previews gloss/textStories metadata with the fixed scope (#82)', async () => {
    const plan = OPERATIONS['project.create.plan'].output.parse(await projectCreatePlan(parsed({ project_type: 'obs', testament_scope: null, abbreviation: 'OBS' }), context()));
    expect(plan.preview.repo_name).toBe('id_obs');
    expect(plan.would_write).toEqual([
      { kind: 'repo', target: 'tc-admin-qa-org/id_obs' },
      { kind: 'commit', target: 'tc-admin-qa-org/id_obs@master' },
    ]);
    const type = plan.preview.metadata_json.type as { flavorType: { name: string; flavor: object; currentScope: Record<string, string[]> } };
    expect(type.flavorType.name).toBe('gloss');
    expect(type.flavorType.flavor).toEqual({ name: 'textStories' });
    expect(Object.keys(type.flavorType.currentScope)).toHaveLength(33);
    expect(type.flavorType.currentScope.GEN).toContain('1-2');
    const stored = JSON.parse(kv.entries.get(`plan:${plan.id}`)!.value) as StoredPlan<ProjectCreatePayload>;
    expect(stored.payload.project).toMatchObject({ project_type: 'obs', testament_scope: null });
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
    teamsAnswer = [
      { organization: { username: 'tc-admin-qa-org' }, permission: 'read', can_create_org_repo: false },
      { organization: { username: 'tc-admin-qa-org' }, permission: 'write', can_create_org_repo: false },
      { organization: { username: 'other-org' }, permission: 'owner', can_create_org_repo: true },
    ];
    expect((await failure(projectCreatePlan(parsed(), context())))!.code).toBe('permission_denied');
    expect(kv.entries.size).toBe(0);
    expect(calls.filter(path => path.startsWith('/api/v1/repos/'))).toEqual([]);
  });

  const denying = { organization: { username: 'tc-admin-qa-org' }, permission: 'read', can_create_org_repo: false };
  const owning = { organization: { username: 'tc-admin-qa-org' }, permission: 'owner', can_create_org_repo: false };
  test.each([
    ['a denying team listed before the owner team', [denying, owning]],
    ['the owner team listed before a denying team', [owning, denying]],
  ])('A2: any one team that may create is enough, whatever the order: %s', async (_order, answer) => {
    teamsAnswer = answer;
    const plan = await projectCreatePlan(parsed(), context());
    expect(plan.would_write[0]!.target).toBe('tc-admin-qa-org/id_tcap');
    expect(kv.entries.size).toBe(1);
  });

  test('a team that may create, but is not the owner team, is enough', async () => {
    teamsAnswer = [{ organization: { username: 'tc-admin-qa-org' }, permission: 'write', can_create_org_repo: true }];
    expect((await projectCreatePlan(parsed(), context())).would_write[0]!.target).toBe('tc-admin-qa-org/id_tcap');
  });

  test('A2: a granting team listed on a later page grants; every page is read before a denial', async () => {
    const deny = { organization: { username: 'tc-admin-qa-org' }, permission: 'write', can_create_org_repo: false };
    const other = { organization: { username: 'some-other-org' }, permission: 'owner', can_create_org_repo: true };
    teamsPages = [
      Array.from({ length: 50 }, (_, i) => ({ id: i + 1, ...deny })),
      [{ id: 51, ...other }, { id: 52, organization: { username: 'tc-admin-qa-org' }, permission: 'owner', can_create_org_repo: true }],
    ];
    const plan = await projectCreatePlan(parsed(), context());
    expect(plan.would_write[0]!.target).toBe('tc-admin-qa-org/id_tcap');
    expect(calls.filter(path => path === '/api/v1/user/teams')).toHaveLength(3);
    teamsPages = [Array.from({ length: 50 }, (_, i) => ({ id: i + 1, ...deny })), [{ id: 51, ...other }]];
    expect((await failure(projectCreatePlan(parsed(), context())))!.code).toBe('permission_denied');
  });

  test('the account itself is an owner, planned under the account without a teams read (Q28)', async () => {
    const plan = await projectCreatePlan(parsed({ owner: 'TC-Admin-QA' }), context());
    expect(plan.would_write[0]).toEqual({ kind: 'repo', target: 'tc-admin-qa/id_tcap' });
    expect(calls).not.toContain('/api/v1/user/teams');
    const stored = JSON.parse(kv.entries.get(`plan:${plan.id}`)!.value) as StoredPlan<ProjectCreatePayload>;
    expect(stored.payload.owner).toEqual({ login: 'tc-admin-qa', kind: 'account' });
  });

  test.each([
    ['testament_scope', { testament_scope: null }],
    ['testament_scope', { project_type: 'obs' as const }],
    ['title', { title: '   ' }],
    ['abbreviation', { abbreviation: ' ' }],
    ['abbreviation', { abbreviation: 'my ult' }],
    ['language.code', { language: { code: 'not a tag', title: 'X' } }],
    ['language.title', { language: { code: 'xx', title: ' ' } }],
    ['title', { title: 'Alkitab\nPercobaan' }],
    ['language.code', { language: { code: 'en-a', title: 'English' } }],
    ['language.title', { language: { code: 'id', title: 'Bahasa\nIndonesia' } }],
  ])('X2: validation_failed naming %s, before Door43 is asked anything, so a schema-invalid metadata.json is never stored', async (field, extra) => {
    const error = (await failure(projectCreatePlan(parsed(extra), context())))!;
    expect(error.code).toBe('validation_failed');
    expect(error.message.startsWith(`${field}: `)).toBe(true);
    expect(error.details).toEqual({ fields: [{ path: field, message: error.message.slice(field.length + 2) }] });
    expect(calls).toEqual([]);
    expect(kv.entries.size).toBe(0);
  });

  test('session_expired without a session, and Door43 is not asked', async () => {
    expect((await failure(projectCreatePlan(parsed(), context(null))))!.code).toBe('session_expired');
    expect(calls).toEqual([]);
  });
});
