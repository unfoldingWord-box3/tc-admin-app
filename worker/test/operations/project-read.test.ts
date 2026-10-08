// `project.read` and `project.refresh` (#26) over the recorded Pendau project:
// its repository (E14, E52), its default branch's health check (E15), its
// release `v1.2` by tag (E27), and its branch head (E63); the preparation
// under way from the store (#125). A project the account cannot write is
// refused (A2, P2); no archive is read (Q17); health is Door43's, never better
// (H1, H3); and both answer live (P3).
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS, Preparation } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { planStore } from '../../src/operations/plans';
import { projectRead, projectRefresh } from '../../src/operations/project-read';
import { recorded } from '../support/recorded';

const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
const REPO = '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau';
const SHA = '2d9dbd1ee09b5a1c28edd8668462f6a64029619b';
const raw = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../../fixtures/door43/qa.door43.org/${path}`, import.meta.url), 'utf8')) as T;
const repository = recorded<Record<string, unknown>>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const health = raw<unknown>('2026-09-21/healthcheck/bahtraku__Perjanjian-Baru-Pendau__master.json');
const releaseHealth = raw<unknown>('2026-09-21/healthcheck/bahtraku__Perjanjian-Baru-Pendau__v1.2.json');
const branch = raw<{ commit: Record<string, unknown> }>('2026-10-07/setup-retry/08-GET-branch.json');
const probeRelease = recorded<Record<string, unknown> & { door43_metadata: Record<string, unknown> }>('2026-09-22/probe-write/14-lookup-by-tag.json');
const release = { ...probeRelease, tag_name: 'v1.2', target_commitish: SHA, door43_metadata: { ...probeRelease.door43_metadata, commit_sha: SHA } };

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

interface State {
  permissions: Record<string, unknown> | null;
  /** The health check's answer: the recorded one, a status Door43 answers instead, or a refused connection. */
  health: unknown;
  /** The branch read's status when it is not the recorded head. */
  branch: 'recorded' | 404;
  /** The health check's answer for the release tag `v1.2` (#146), as `health` is the branch's. */
  releaseHealth: unknown;
  /** Whether the catalog names a full release (E14); without one, no tag is read. */
  release: boolean;
  /** The tag Door43's release answer names, when it is not the one asked for. */
  releaseTag?: string;
}

const NOW = new Date('2026-10-08T12:00:00.000Z');
let kv: MemoryKV;
let calls: string[];
let state: State;

const fetch: Fetch = async url => {
  const { pathname, search } = new URL(url);
  calls.push(pathname + search);
  if (pathname === REPO) {
    const { permissions: _recorded, ...recorded } = repository;
    const catalog = recorded.catalog as Record<string, unknown> | undefined;
    const bare = state.release ? recorded : { ...recorded, catalog: { ...catalog, prod: null } };
    return Response.json(state.permissions === null ? bare : { ...bare, permissions: state.permissions });
  }
  if (pathname === `${REPO}/healthcheck`) {
    const answer = new URLSearchParams(search).get('ref') === 'v1.2' ? state.releaseHealth : state.health;
    return typeof answer === 'number' ? new Response('', { status: answer }) : Response.json(answer);
  }
  if (pathname === `${REPO}/branches/master`) return state.branch === 404 ? new Response('', { status: 404 }) : Response.json({ ...branch, name: 'master', commit: { ...branch.commit, id: SHA } });
  if (pathname === `${REPO}/releases/tags/v1.2`) return Response.json(state.releaseTag ? { ...release, tag_name: state.releaseTag } : release);
  return new Response('', { status: 404 });
};

const context = (): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-26', 'door43-token', kv);
  return { ...base, door43: { ...base.door43!, fetch }, now: () => NOW };
};
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const read = () => projectRead(PENDAU, context()).then(report => OPERATIONS['project.read'].output.parse(report));

/** A preparation as `release.prepare` stores one, in a given state. */
const preparationOf = (id: string, state: Preparation['state'], at: string): Preparation =>
  Preparation.parse({
    id,
    project_ref: PENDAU,
    state,
    bound_to: { default_branch_sha: SHA, release_tag: 'v1.2', release_tag_sha: SHA },
    selection: { new: [], revised: ['mat'], unknown_included: [] },
    snapshot: null,
    health: { state: 'checking', severity_raw: null, ref: `temp-tca-release/${id}`, checked_at: null, issue_count: null, issues: null, source: 'door43' },
    requires_acknowledgement: false,
    version: { baseline_tag: 'v1.2', proposed: id, confirmed: id },
    notes: { draft: `Release ${id}`, confirmed: null },
    release: null,
    last_error: null,
    history: [{ at, from: null, to: state, event: 'release.plan' }],
    freshness: { read_at: at, source: 'live', age_seconds: 0 },
  });

beforeEach(() => {
  kv = new MemoryKV();
  calls = [];
  state = { permissions: { push: true, admin: false, pull: true }, health, branch: 'recorded', releaseHealth, release: true };
});

describe('project.read over the recorded Pendau project', () => {
  test('P3, H1, Q17: the report is live, with the default branch\'s health and its issues, the latest full release, and the head; no archive is read', async () => {
    const report = await read();
    expect(report.ref).toMatchObject({ owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' });
    expect(report).toMatchObject({ project_type: 'bible', metadata_format: 'sb', editability: { state: 'editable' } });
    expect(report.coverage.basis).toBe('catalog');
    // H1: Door43's result as recorded (2026-09-21): a warning, one `ingredient_title_is_en` and 27 `sb_ingredient_mismatch`, each kept for the manager.
    expect(report.health).toMatchObject({ state: 'warning', severity_raw: 'warning', ref: 'master', checked_at: NOW.toISOString(), issue_count: 28, source: 'door43' });
    expect(report.health.issues?.map(issue => issue.code)).toEqual(expect.arrayContaining(['ingredient_title_is_en', 'sb_ingredient_mismatch']));
    expect(report.latest_full_release).toMatchObject({ tag: 'v1.2', version: 'v1.2', sha: SHA });
    expect(report.default_branch_head?.sha).toBe(SHA);
    expect(report.setup).toEqual({ state: 'complete', failed_step: null });
    expect(report.active_preparation).toBeNull();
    expect(report.freshness).toEqual({ read_at: NOW.toISOString(), source: 'live', age_seconds: 0 });
    expect(report.permissions).toEqual({ push: true, admin: false, checked_at: NOW.toISOString() });
    // Q17: the repository, its health, its head, and its release by tag; never an archive or a tree.
    expect(calls.some(call => call.includes('/sb/') || call.includes('/archive/') || call.includes('/git/trees/'))).toBe(false);
    expect(calls[0]).toBe(REPO);
  });

  test('#125: the newest preparation under way is the report\'s; a released or discarded one is not', async () => {
    const store = planStore(kv);
    await store.putPreparation('bahtraku', 'Perjanjian-Baru-Pendau', 'v1.2.1', preparationOf('v1.2.1', 'health_checking', '2026-10-08T10:00:00.000Z'));
    await store.putPreparation('bahtraku', 'Perjanjian-Baru-Pendau', 'v1.3.0', preparationOf('v1.3.0', 'ready_for_release', '2026-10-08T11:00:00.000Z'));
    await store.putPreparation('bahtraku', 'Perjanjian-Baru-Pendau', 'v2.0.0', preparationOf('v2.0.0', 'full_release', '2026-10-08T11:30:00.000Z'));
    expect((await read()).active_preparation).toEqual({ id: 'v1.3.0', state: 'ready_for_release', version: 'v1.3.0' });
  });

  test('H3: a health check Door43 has not run is checking, and one Door43 cannot answer is door43_unavailable, never healthy', async () => {
    state.health = { ok: false, error: 'no metadata found' };
    // The recorded pending answer is a 422 with that error (E15); a bare 422 answer reads the same.
    const fetchPending: Fetch = async (url, init) => (new URL(url).pathname.endsWith('/healthcheck') ? Response.json({ ok: false, error: 'no metadata found' }, { status: 422 }) : fetch(url, init));
    const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'r', 'door43-token', kv);
    const pending = await projectRead(PENDAU, { ...base, door43: { ...base.door43!, fetch: fetchPending }, now: () => NOW });
    expect(pending.health).toMatchObject({ state: 'checking', severity_raw: null, issue_count: null });
    state.health = 503;
    expect((await read()).health).toMatchObject({ state: 'door43_unavailable', severity_raw: null });
  });

  test('#146, H1, E28: the latest full release\'s health is read by its tag beside the branch\'s, with its own issues', async () => {
    const report = await read();
    // H1: Door43's result for v1.2 as recorded (2026-09-21): a warning, one `ingredient_title_is_en` and 55 `sb_ingredient_mismatch`.
    expect(report.release_health).toMatchObject({ state: 'warning', severity_raw: 'warning', ref: 'v1.2', checked_at: NOW.toISOString(), issue_count: 56, source: 'door43' });
    expect(report.release_health?.issues?.filter(issue => issue.code === 'sb_ingredient_mismatch')).toHaveLength(55);
    expect(report.health).toMatchObject({ ref: 'master', issue_count: 28 });
    expect(calls).toEqual(expect.arrayContaining([`${REPO}/healthcheck?ref=master`, `${REPO}/healthcheck?ref=v1.2`]));
  });

  test('#146, H3: a release health check Door43 cannot answer is door43_unavailable, never healthy; the branch\'s is still reported', async () => {
    state.releaseHealth = 503;
    const report = await read();
    expect(report.release_health).toMatchObject({ state: 'door43_unavailable', ref: 'v1.2', issue_count: null, issues: null });
    expect(report.health).toMatchObject({ state: 'warning', issue_count: 28 });
  });

  test('#146: a release answer naming another tag than the catalog\'s has no release health, so no health is shown under another release (bench round 1 on #147)', async () => {
    state.releaseTag = 'v1.3';
    const report = await read();
    expect(report.latest_full_release?.tag).toBe('v1.3');
    expect(report.release_health).toBeNull();
  });

  test('#146: a project without a full release has no release health, and no tag\'s health check is read', async () => {
    state.release = false;
    const report = await read();
    expect(report.latest_full_release).toBeNull();
    expect(report.release_health).toBeNull();
    expect(calls.filter(call => call.includes('/healthcheck'))).toEqual([`${REPO}/healthcheck?ref=master`]);
  });

  test('W4, E10: a default branch with no commit is no head and an incomplete setup', async () => {
    state.branch = 404;
    const report = await read();
    expect(report.default_branch_head).toBeNull();
    expect(report.setup).toEqual({ state: 'incomplete', failed_step: 'first_commit' });
  });
});

describe('who may read it', () => {
  test('A2, P2: a project the account cannot write, or whose permissions Door43 does not state, is permission_denied, and nothing more is read', async () => {
    state.permissions = { push: false, admin: false, pull: true };
    expect((await failure(read()))?.code).toBe('permission_denied');
    expect(calls).toEqual([REPO]);
    calls = [];
    state.permissions = null;
    expect((await failure(read()))?.code).toBe('permission_denied');
    expect(calls).toEqual([REPO]);
  });

  test('a project Door43 does not have is not_found; without a session the read is session_expired and Door43 is not asked', async () => {
    expect((await failure(projectRead({ owner: 'bahtraku', repo: 'no_such' }, context())))?.code).toBe('not_found');
    calls = [];
    const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'r', null, kv);
    expect((await failure(projectRead(PENDAU, base)))?.code).toBe('session_expired');
    expect(calls).toEqual([]);
  });
});

describe('project.refresh', () => {
  test('P3: the refresh is the read, live: tC Admin caches nothing to invalidate', async () => {
    const refreshed = OPERATIONS['project.refresh'].output.parse(await projectRefresh(PENDAU, context()));
    expect(refreshed.freshness).toEqual({ read_at: NOW.toISOString(), source: 'live', age_seconds: 0 });
    expect(refreshed).toEqual(await read());
  });
});
