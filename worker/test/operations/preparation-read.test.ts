// `preparation.read` (#36): the stored preparation, the health of its branch
// read from Door43 while it waits, and the state the health moves it to (H1,
// H2); a moved default branch makes it restart_required first (R5); a
// preparation past the health check, or not yet pushed, is answered as
// stored with no Door43 read.
import { CatalogError, Preparation } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { planStore } from '../../src/operations/plans';
import { preparationRead, stateOfHealth } from '../../src/operations/preparation-read';
import { recorded } from '../support/recorded';

type Repo = { catalog: { latest: { branch_or_tag_name: string; commit_sha: string } | null; prod: { branch_or_tag_name: string; commit_sha: string } | null } };
const repoView = recorded<Repo>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const HEAD = repoView.catalog.latest!.commit_sha;
const TAG_SHA = repoView.catalog.prod!.commit_sha;
const health = {
  success: recorded<unknown>('2026-09-22/probe-write/10-health-branch.json'),
  info: recorded<unknown>('2026-09-22/probe-write/05-health-master.json'),
  warning: recorded<unknown>('2026-09-22/probe-write/12-health-tag-v1.1.0.json'),
};
const PENDING = { ok: false, error: 'no metadata found for repo [bahtraku/Perjanjian-Baru-Pendau] and ref [temp-tca-release/v1.3.0]' };
const FAILING = { ok: true, data: { issues: { usfm_invalid: [{ issue_code: 'usfm_invalid', severity_level: 'error', negative_title: 'USFM is invalid', details: 'd', suggestion: 's' }] }, overall_severity_level: 'error' } };

class MemoryKV implements KVNamespace {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

const NOW = new Date('2026-10-07T15:05:00.000Z');
const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
const BRANCH = 'temp-tca-release/v1.3.0';
/** A preparation as `release.prepare` stores it once the push is confirmed. */
const stored = (overrides: Partial<Preparation> = {}): Preparation =>
  Preparation.parse({
    id: 'v1.3.0',
    project_ref: PENDAU,
    state: 'health_checking',
    bound_to: { default_branch_sha: HEAD, release_tag: 'v1.2', release_tag_sha: TAG_SHA },
    selection: { new: ['gen'], revised: ['mat'], unknown_included: [] },
    snapshot: { branch: BRANCH, commit_sha: 'e000000000000000000000000000000000000001', files: [{ path: 'ingredients/GEN.usfm', source: 'default_branch', unit: 'gen' }] },
    health: { state: 'checking', severity_raw: null, ref: BRANCH, checked_at: null, issue_count: null, issues: null, source: 'door43' },
    requires_acknowledgement: false,
    version: { baseline_tag: 'v1.2', proposed: 'v1.3.0', confirmed: 'v1.3.0' },
    notes: { draft: 'Release v1.3.0', confirmed: null },
    release: null,
    last_error: null,
    history: [
      { at: '2026-10-07T15:00:00.000Z', from: null, to: 'selecting', event: 'release.plan' },
      { at: '2026-10-07T15:00:10.000Z', from: 'selecting', to: 'snapshot_prepared', event: 'release.prepare' },
      { at: '2026-10-07T15:00:12.000Z', from: 'snapshot_prepared', to: 'health_checking', event: 'push confirmed' },
    ],
    freshness: { read_at: '2026-10-07T15:00:12.000Z', source: 'live', age_seconds: 0 },
    ...overrides,
  });

let kv: MemoryKV;
beforeEach(() => {
  kv = new MemoryKV();
});

/** Door43 as the read sees it: the repository, and the health answer for the branch. */
function door43(healthAnswer: () => Response | Promise<Response>, head = HEAD) {
  const requests: string[] = [];
  const fetch: Fetch = async url => {
    const { pathname } = new URL(url);
    requests.push(pathname);
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname)) return Response.json({ ...repoView, catalog: { ...repoView.catalog, latest: { ...repoView.catalog.latest!, commit_sha: head } } });
    if (pathname.endsWith('/healthcheck')) return healthAnswer();
    return new Response('', { status: 404 });
  };
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', 'door43-token', kv);
  const context: OperationContext = { ...base, door43: { ...base.door43!, fetch }, now: () => NOW };
  return { context, requests };
}
const json = (body: unknown, status = 200) => () => Response.json(body, { status });
const read = (context: OperationContext) => preparationRead({ ...PENDAU, preparation_id: 'v1.3.0' }, context);
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const put = (preparation: Preparation) => planStore(kv).putPreparation(PENDAU.owner, PENDAU.repo, preparation.id, preparation);
const get = () => planStore(kv).getPreparation<Preparation>(PENDAU.owner, PENDAU.repo, 'v1.3.0');

describe('preparation.read (#36)', () => {
  test('H1: a success result on the branch moves the preparation to ready_for_release, with the health as Door43 gave it, stored', async () => {
    await put(stored());
    const { context, requests } = door43(json(health.success));
    const result = await read(context);
    expect(result).toMatchObject({ state: 'ready_for_release', requires_acknowledgement: false, health: { state: 'healthy', severity_raw: 'success', ref: BRANCH, checked_at: NOW.toISOString(), issue_count: 0, issues: [] } });
    expect(result.history.at(-1)).toEqual({ at: NOW.toISOString(), from: 'health_checking', to: 'ready_for_release', event: 'health healthy' });
    expect(requests).toEqual(['/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/healthcheck']);
    expect((await get())?.state).toBe('ready_for_release');
    expect(Preparation.parse(result)).toEqual(result);
  });

  test('H1, Q21: an info result also moves it to ready_for_release, with the note visible and no acknowledgement needed', async () => {
    await put(stored());
    const result = await read(door43(json(health.info)).context);
    expect(result).toMatchObject({ state: 'ready_for_release', requires_acknowledgement: false, health: { state: 'info', issue_count: 1 } });
    expect(result.health.issues?.[0]).toMatchObject({ code: 'release_needed', severity: 'info' });
  });

  test('H2, Q6: a warning result moves it to ready_for_release with requires_acknowledgement and the warnings for the manager to read', async () => {
    await put(stored());
    const result = await read(door43(json(health.warning)).context);
    expect(result).toMatchObject({ state: 'ready_for_release', requires_acknowledgement: true, health: { state: 'warning', severity_raw: 'warning', issue_count: 1 } });
    expect(result.health.issues?.[0]).toMatchObject({ code: 'sb_ingredient_mismatch', rule: 'META-015', title: 'Ingredient sizes or checksums do not match the files in the repo' });
    expect(result.health.issues?.[0]?.details).toContain('ingredients/EXO.usfm');
  });

  test('H2: a failing result, an unreachable Door43, or an answer that is no result moves it to health_blocked, never ready', async () => {
    const answers: [() => Response | Promise<Response>, string][] = [
      [json(FAILING), 'failing'],
      [() => Promise.reject(new TypeError('fetch failed')), 'door43_unavailable'],
      [json({ message: 'bad gateway' }, 502), 'door43_unavailable'],
      [() => new Response('<html>', { status: 200 }), 'health_error'],
      [json({ ok: true, data: { issues: {}, overall_severity_level: 'critical' } }), 'health_error'],
    ];
    for (const [answer, state] of answers) {
      kv = new MemoryKV();
      await put(stored());
      const result = await read(door43(answer).context);
      expect(result).toMatchObject({ state: 'health_blocked', requires_acknowledgement: false, health: { state, ref: BRANCH, checked_at: NOW.toISOString() } });
      expect(result.history.at(-1)).toMatchObject({ from: 'health_checking', to: 'health_blocked', event: `health ${state}` });
    }
  });

  test('H3: the 422 before the check has run keeps it health_checking with health checking, the time of the read, and no new history', async () => {
    await put(stored());
    const result = await read(door43(json(PENDING, 422)).context);
    expect(result).toMatchObject({ state: 'health_checking', health: { state: 'checking', severity_raw: null, checked_at: NOW.toISOString(), issue_count: null, issues: null } });
    expect(result.history).toHaveLength(3);
    expect((await get())?.health.checked_at).toBe(NOW.toISOString());
  });

  test('H2: a refresh of a health_blocked preparation reads Door43 again and moves it on when the result is in', async () => {
    await put(stored({ state: 'health_blocked', health: { state: 'door43_unavailable', severity_raw: null, ref: BRANCH, checked_at: '2026-10-07T15:01:00.000Z', issue_count: null, issues: null, source: 'door43' } }));
    const result = await read(door43(json(health.success)).context);
    expect(result).toMatchObject({ state: 'ready_for_release', health: { state: 'healthy' } });
    expect(result.history.at(-1)).toMatchObject({ from: 'health_blocked', to: 'ready_for_release' });
  });

  test('R5: a default branch that moved since the plan makes the preparation restart_required before any health read, and stores it', async () => {
    await put(stored());
    const { context, requests } = door43(json(health.success), 'f000000000000000000000000000000000000000');
    const result = await read(context);
    expect(result.state).toBe('restart_required');
    expect(result.history.at(-1)).toMatchObject({ from: 'health_checking', to: 'restart_required', event: 'default branch moved to f000000000000000000000000000000000000000' });
    expect(requests).toEqual(['/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau']);
    expect((await get())?.state).toBe('restart_required');
  });

  test('a preparation that is ready, released, failed before the push, or discarded is answered as stored: no health read, and no Door43 read at all once it is released', async () => {
    for (const state of ['ready_for_release', 'retryable_failure', 'snapshot_prepared'] as const) {
      kv = new MemoryKV();
      await put(stored({ state }));
      const { context, requests } = door43(json(health.warning));
      expect((await read(context)).state).toBe(state);
      expect(requests).toEqual(['/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau']);
    }
    for (const state of ['pre_release', 'full_release', 'discarded', 'restart_required'] as const) {
      kv = new MemoryKV();
      await put(stored({ state }));
      const { context, requests } = door43(json(health.warning));
      expect((await read(context)).state).toBe(state);
      expect(requests).toEqual([]);
    }
  });

  test('a preparation Door43 or the store does not have is not_found; a signed-out read is session_expired', async () => {
    const { context } = door43(json(health.success));
    expect((await failure(read(context)))?.code).toBe('not_found');
    expect((await failure(read({ ...context, door43: null })))?.code).toBe('session_expired');
  });

  test('the state a health value moves a waiting preparation to (domain model §6)', () => {
    const at = (state: Preparation['health']['state']) => stateOfHealth({ state, severity_raw: null, ref: BRANCH, checked_at: null, issue_count: null, issues: null, source: 'door43' });
    expect((['healthy', 'info', 'warning'] as const).map(at)).toEqual(['ready_for_release', 'ready_for_release', 'ready_for_release']);
    expect(at('checking')).toBe('health_checking');
    expect((['failing', 'never_checked', 'door43_unavailable', 'health_error', 'unsupported'] as const).map(at)).toEqual(Array(5).fill('health_blocked'));
  });
});
