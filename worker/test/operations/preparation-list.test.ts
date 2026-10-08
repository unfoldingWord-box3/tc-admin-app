// `preparation.list` (#125): the project's stored preparations, so a page that
// did not make a preparation can find it again. The push permission is read
// first, before the store (A2); only this project's keys are listed, through
// every page of the KV listing; a record that no longer parses is left out;
// each preparation is answered as stored, newest first, with no health read.
import { CatalogError, OPERATIONS, Preparation } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVListResult, KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { planStore } from '../../src/operations/plans';
import { preparationList } from '../../src/operations/preparation-list';
import { preparationRead } from '../../src/operations/preparation-read';
import { recorded } from '../support/recorded';

type Repo = { catalog: { latest: { commit_sha: string } | null; prod: { commit_sha: string } | null }; permissions: { push: boolean; admin: boolean; pull: boolean } };
const repoView = recorded<Repo>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const HEAD = repoView.catalog.latest!.commit_sha;

/** Workers KV as the store sees it: keys listed in name order, `pageSize` at a time, with a cursor while more remain. */
class MemoryKV implements KVNamespace {
  readonly entries = new Map<string, string>();
  readonly calls: string[] = [];
  constructor(private readonly pageSize = 1000) {}
  async get(key: string) {
    this.calls.push(`get ${key}`);
    return this.entries.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.entries.set(key, value);
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
  async list(options: { prefix: string; cursor?: string }): Promise<KVListResult> {
    this.calls.push(`list ${options.prefix} ${options.cursor ?? ''}`.trim());
    const names = [...this.entries.keys()].filter(name => name.startsWith(options.prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = names.slice(start, start + this.pageSize).map(name => ({ name }));
    const next = start + this.pageSize;
    return next < names.length ? { keys: page, list_complete: false, cursor: String(next) } : { keys: page, list_complete: true };
  }
}

const NOW = new Date('2026-10-08T12:00:00.000Z');
const TB = { owner: 'bahtraku', repo: 'id_tb' };

/** A preparation as `release.prepare` and the reads after it store one. */
const stored = (id: string, at: string, overrides: Partial<Preparation> = {}): Preparation =>
  Preparation.parse({
    id,
    project_ref: TB,
    state: 'health_checking',
    bound_to: { default_branch_sha: HEAD, release_tag: null, release_tag_sha: null },
    selection: { new: ['gen'], revised: [], unknown_included: [] },
    snapshot: { branch: `temp-tca-release/${id}`, commit_sha: 'e000000000000000000000000000000000000001', files: [{ path: 'ingredients/GEN.usfm', source: 'default_branch', unit: 'gen' }] },
    health: { state: 'checking', severity_raw: null, ref: `temp-tca-release/${id}`, checked_at: null, issue_count: null, issues: null, source: 'door43' },
    requires_acknowledgement: false,
    version: { baseline_tag: null, proposed: id, confirmed: id },
    notes: { draft: `Release ${id}`, confirmed: null },
    release: null,
    last_error: null,
    history: [
      { at: '2026-10-08T09:00:00.000Z', from: null, to: 'selecting', event: 'release.plan' },
      { at, from: 'snapshot_prepared', to: 'health_checking', event: 'push confirmed' },
    ],
    freshness: { read_at: at, source: 'live', age_seconds: 0 },
    ...overrides,
  });

let kv: MemoryKV;
beforeEach(() => {
  kv = new MemoryKV();
});

/** Door43 as the list sees it: the repository, with the caller's push right. */
function door43(push = true) {
  const requests: string[] = [];
  const fetch: Fetch = async url => {
    const { pathname } = new URL(url);
    requests.push(pathname);
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname)) return Response.json({ ...repoView, permissions: { ...repoView.permissions, push, admin: false } });
    if (pathname.endsWith('/healthcheck')) return Response.json({ ok: true, data: { issues: {}, overall_severity_level: 'success' } });
    return new Response('', { status: 404 });
  };
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', 'door43-token', kv);
  const context: OperationContext = { ...base, door43: { ...base.door43!, fetch }, now: () => NOW };
  return { context, requests };
}
const put = (ref: { owner: string; repo: string }, preparation: Preparation) => planStore(kv).putPreparation(ref.owner, ref.repo, preparation.id, preparation);
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const list = (context: OperationContext, ref = TB) => preparationList(ref, context).then(output => OPERATIONS['preparation.list'].output.parse(output));

describe('preparation.list (#125)', () => {
  test('A2: an account without push to the project is permission_denied, and nothing stored is read or answered', async () => {
    await put(TB, stored('v1.0.0', '2026-10-08T10:00:00.000Z'));
    kv.calls.length = 0;
    const { context, requests } = door43(false);
    const error = await failure(preparationList(TB, context));
    expect(error?.code).toBe('permission_denied');
    expect(requests).toEqual(['/api/v1/repos/bahtraku/id_tb']);
    expect(kv.calls).toEqual([]);
  });

  test('A2: with no session it is session_expired, before Door43 or the store is asked', async () => {
    const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', null, kv);
    expect((await failure(preparationList(TB, base)))?.code).toBe('session_expired');
    expect(kv.calls).toEqual([]);
  });

  test('R7: only this project\'s preparations are listed; id_tb1 and another owner\'s id_tb, whose keys share the prefix\'s start, never leak', async () => {
    await put(TB, stored('v1.0.0', '2026-10-08T10:00:00.000Z'));
    await put({ owner: 'bahtraku', repo: 'id_tb1' }, stored('v9.0.0', '2026-10-08T11:00:00.000Z', { project_ref: { owner: 'bahtraku', repo: 'id_tb1' } }));
    await put({ owner: 'bahtraku2', repo: 'id_tb' }, stored('v8.0.0', '2026-10-08T11:00:00.000Z', { project_ref: { owner: 'bahtraku2', repo: 'id_tb' } }));
    const result = await list(door43().context);
    expect(result.preparations.map(preparation => preparation.id)).toEqual(['v1.0.0']);
    expect(kv.calls.filter(call => call.startsWith('list'))).toEqual(['list preparation:bahtraku/id_tb/']);
  });

  test('R7: the owner is matched as the store keys it, whatever its case, and a preparation of another project under this key is left out', async () => {
    await put({ owner: 'Bahtraku', repo: 'id_tb' }, stored('v1.0.0', '2026-10-08T10:00:00.000Z'));
    kv.entries.set('preparation:bahtraku/id_tb/v7.0.0', JSON.stringify(stored('v7.0.0', '2026-10-08T10:00:00.000Z', { project_ref: { owner: 'someone', repo: 'else' } })));
    const result = await list(door43().context, { owner: 'BAHTRAKU', repo: 'id_tb' });
    expect(result.preparations.map(preparation => preparation.id)).toEqual(['v1.0.0']);
  });

  test('R7: every page of the KV listing is read, newest first by the last change, finished ones included', async () => {
    kv = new MemoryKV(2);
    await put(TB, stored('v1.0.0', '2026-10-08T08:00:00.000Z', { state: 'full_release', release: { tag: 'v1.0.0', url: 'https://qa.door43.org/bahtraku/id_tb/releases/tag/v1.0.0', prerelease: false } }));
    await put(TB, stored('v1.1.0', '2026-10-08T09:30:00.000Z', { state: 'discarded' }));
    await put(TB, stored('v1.2.0', '2026-10-08T11:30:00.000Z', { state: 'retryable_failure' }));
    await put(TB, stored('v2.0.0', '2026-10-08T10:00:00.000Z', { state: 'restart_required' }));
    await put(TB, stored('v1.3.0', '2026-10-08T11:00:00.000Z'));
    const result = await list(door43().context);
    expect(result.preparations.map(preparation => [preparation.id, preparation.state])).toEqual([
      ['v1.2.0', 'retryable_failure'],
      ['v1.3.0', 'health_checking'],
      ['v2.0.0', 'restart_required'],
      ['v1.1.0', 'discarded'],
      ['v1.0.0', 'full_release'],
    ]);
    expect(kv.calls.filter(call => call.startsWith('list'))).toEqual(['list preparation:bahtraku/id_tb/', 'list preparation:bahtraku/id_tb/ 2', 'list preparation:bahtraku/id_tb/ 4']);
  });

  test('X2: a stored record that no longer parses, as JSON or as a preparation, is left out, never thrown', async () => {
    await put(TB, stored('v1.0.0', '2026-10-08T10:00:00.000Z'));
    kv.entries.set('preparation:bahtraku/id_tb/v1.1.0', '{not json');
    kv.entries.set('preparation:bahtraku/id_tb/v1.2.0', JSON.stringify({ id: 'v1.2.0', state: 'a state no one knows' }));
    kv.entries.set('preparation:bahtraku/id_tb/v1.3.0/extra', JSON.stringify(stored('v1.3.0', '2026-10-08T10:00:00.000Z')));
    const result = await list(door43().context);
    expect(result.preparations.map(preparation => preparation.id)).toEqual(['v1.0.0']);
  });

  test('H1, H3: each preparation is answered as stored, its health not read or judged again, its freshness the store\'s with its age', async () => {
    await put(TB, stored('v1.3.0', '2026-10-08T11:00:00.000Z'));
    const { context, requests } = door43();
    const result = await list(context);
    expect(requests).toEqual(['/api/v1/repos/bahtraku/id_tb']);
    expect(result.preparations[0]).toMatchObject({ state: 'health_checking', health: { state: 'checking' }, freshness: { read_at: '2026-10-08T11:00:00.000Z', source: 'cache', age_seconds: 3600 } });
    expect(result.freshness).toEqual({ read_at: NOW.toISOString(), source: 'live', age_seconds: 0 });
  });

  test('a project with nothing stored answers an empty list', async () => {
    expect((await list(door43().context)).preparations).toEqual([]);
  });

  test('a preparation this page did not make is found by the list and read by its id, landing on its current step (#125)', async () => {
    await put(TB, stored('v1.3.0', '2026-10-08T11:00:00.000Z'));
    const { context } = door43();
    const [found] = (await list(context)).preparations;
    const read = await preparationRead({ ...TB, preparation_id: found!.id }, context);
    expect(read).toMatchObject({ id: 'v1.3.0', state: 'ready_for_release', health: { state: 'healthy' } });
  });
});
