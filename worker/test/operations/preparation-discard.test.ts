// `preparation.discard` (#58, Q14): one branch deletion and the preparation
// `discarded` (R7); a released preparation is `already_released` and nothing is
// written; no push right is `permission_denied` and nothing is written (A2); a
// deletion Door43 did not do leaves the branch and the preparation for the
// retry (R7); the same request after success answers the same receipt.
import { CatalogError, Preparation } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { planStore } from '../../src/operations/plans';
import { preparationDiscard } from '../../src/operations/preparation-discard';
import { recorded } from '../support/recorded';

type Repo = { catalog: { latest: { commit_sha: string } | null; prod: { commit_sha: string } | null }; permissions: { push: boolean; admin: boolean; pull: boolean } };
const repoView = recorded<Repo>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const probeRelease = recorded<Record<string, unknown>>('2026-09-22/probe-write/11-prerelease-v1.1.0.json');
const user = recorded<unknown>('2026-10-05/user/user.json');
const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
const BRANCH = 'temp-tca-release/v1.3.0';
const NOW = new Date('2026-10-07T17:00:00.000Z');

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
let kv: MemoryKV;
beforeEach(() => {
  kv = new MemoryKV();
});

const prepared = (overrides: Partial<Preparation> = {}): Preparation =>
  Preparation.parse({
    id: 'v1.3.0',
    project_ref: PENDAU,
    state: 'health_blocked',
    bound_to: { default_branch_sha: repoView.catalog.latest!.commit_sha, release_tag: 'v1.2', release_tag_sha: repoView.catalog.prod!.commit_sha },
    selection: { new: ['gen'], revised: [], unknown_included: [] },
    snapshot: { branch: BRANCH, commit_sha: 'e000000000000000000000000000000000000001', files: [] },
    health: { state: 'failing', severity_raw: 'error', ref: BRANCH, checked_at: '2026-10-07T15:05:00.000Z', issue_count: 1, issues: [], source: 'door43' },
    requires_acknowledgement: false,
    version: { baseline_tag: 'v1.2', proposed: 'v1.3.0', confirmed: 'v1.3.0' },
    notes: { draft: 'Release v1.3.0', confirmed: null },
    release: null,
    last_error: null,
    history: [{ at: '2026-10-07T15:05:00.000Z', from: 'health_checking', to: 'health_blocked', event: 'health failing' }],
    freshness: { read_at: '2026-10-07T15:05:00.000Z', source: 'live', age_seconds: 0 },
    ...overrides,
  });

function door43(options: { push?: boolean; deleteAnswer?: () => Response | Promise<Response>; lookup?: () => Response } = {}) {
  const writes: { method: string; path: string }[] = [];
  const fetch: Fetch = async (url, init) => {
    const { pathname } = new URL(url);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      writes.push({ method, path: pathname });
      if (pathname.includes('/branches/')) return options.deleteAnswer ? options.deleteAnswer() : new Response(null, { status: 204 });
      return new Response('', { status: 404 });
    }
    if (pathname === '/api/v1/user') return Response.json(user);
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname)) return Response.json({ ...repoView, permissions: { ...repoView.permissions, push: options.push ?? true, admin: false } });
    if (pathname.includes('/releases/tags/') && options.lookup) return options.lookup();
    return new Response('', { status: 404 });
  };
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-5', 'door43-token', kv);
  const context: OperationContext = { ...base, door43: { ...base.door43!, fetch }, now: () => NOW };
  return { context, writes };
}
const put = (preparation: Preparation) => planStore(kv).putPreparation(PENDAU.owner, PENDAU.repo, preparation.id, preparation);
const get = () => planStore(kv).getPreparation<Preparation>(PENDAU.owner, PENDAU.repo, 'v1.3.0');
const discard = (context: OperationContext, id = 'v1.3.0') => preparationDiscard({ ...PENDAU, preparation_id: id }, context);
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));

describe('preparation.discard (#58)', () => {
  test('R7: an unreleased preparation is discarded by exactly one branch deletion, the receipt lists it, and the state is stored', async () => {
    await put(prepared());
    const { context, writes } = door43();
    const receipt = await discard(context);
    expect(writes).toEqual([{ method: 'DELETE', path: `/api/v1/repos/${PENDAU.owner}/${PENDAU.repo}/branches/${encodeURIComponent(BRANCH)}` }]);
    expect(receipt.wrote).toEqual([{ kind: 'branch', target: BRANCH }]);
    expect(receipt.result).toMatchObject({ state: 'discarded', last_error: null });
    expect(receipt.result.history.at(-1)).toEqual({ at: NOW.toISOString(), from: 'health_blocked', to: 'discarded', event: 'preparation.discard' });
    expect((await get())?.state).toBe('discarded');
    expect(Preparation.parse(receipt.result)).toEqual(receipt.result);
    const again = door43();
    expect(await discard(again.context)).toEqual(receipt);
    expect(again.writes).toEqual([]);
  });

  test('R7: a released preparation is already_released and nothing is written, pre-release or full', async () => {
    for (const state of ['pre_release', 'full_release'] as const) {
      kv = new MemoryKV();
      await put(prepared({ state, release: { tag: 'v1.3.0', url: 'https://qa.door43.org/r', prerelease: state === 'pre_release' } }));
      const { context, writes } = door43();
      expect((await failure(discard(context)))?.code).toBe('already_released');
      expect(writes).toEqual([]);
      expect((await get())?.state).toBe(state);
    }
  });

  test('A2: no push right is permission_denied and nothing is written; a preparation the store lacks is not_found', async () => {
    await put(prepared());
    const { context, writes } = door43({ push: false });
    expect((await failure(discard(context)))?.code).toBe('permission_denied');
    expect(writes).toEqual([]);
    expect((await get())?.state).toBe('health_blocked');
    expect((await failure(discard(door43().context, 'v9.9.9')))?.code).toBe('not_found');
  });

  test('R7: a deletion Door43 did not do is door43_unavailable with the reason, the branch stays, and the preparation is retryable_failure for the retry', async () => {
    await put(prepared());
    const { context, writes } = door43({ deleteAnswer: () => Response.json({ message: 'branch is protected' }, { status: 500 }) });
    const error = await failure(discard(context));
    expect(error).toMatchObject({ code: 'door43_unavailable' });
    expect(error?.details.reason).toBe('the temporary branch could not be deleted: branch is protected');
    expect(writes).toHaveLength(1);
    const after = await get();
    expect(after).toMatchObject({ state: 'retryable_failure', last_error: { code: 'door43_unavailable' } });
    expect(after?.history.at(-1)).toMatchObject({ from: 'health_blocked', to: 'retryable_failure' });
    const retry = door43();
    expect((await discard(retry.context)).result.state).toBe('discarded');
    expect(retry.writes).toHaveLength(1);
  });

  test('a preparation never pushed, or already discarded, is discarded with no Door43 write', async () => {
    await put(prepared({ state: 'selecting', snapshot: null, last_error: { code: 'door43_unavailable', message: 'Door43 did not answer.', retryable: true, next_action: 'try again', request_id: 'r', details: {}, invariant: null } }));
    const never = door43();
    expect((await discard(never.context)).result).toMatchObject({ state: 'discarded', last_error: null });
    expect(never.writes).toEqual([]);
    expect((await get())?.state).toBe('discarded');
    kv = new MemoryKV();
    await put(prepared({ state: 'discarded' }));
    const already = door43();
    const receipt = await discard(already.context);
    expect(receipt.result.state).toBe('discarded');
    expect(receipt.wrote).toEqual([]);
    expect(already.writes).toEqual([]);
  });

  test('R7: a replacement prepared under the same version after a discard is discarded on its own, by its own branch deletion', async () => {
    await put(prepared());
    await discard(door43().context);
    await put(prepared({ state: 'ready_for_release', health: { ...prepared().health, state: 'healthy' } }));
    const replacement = door43();
    expect((await discard(replacement.context)).result.history.at(-1)).toMatchObject({ from: 'ready_for_release', to: 'discarded' });
    expect(replacement.writes).toHaveLength(1);
    expect((await get())?.state).toBe('discarded');
  });

  test('R6, R7: an unconfirmed release found on the snapshot commit is already_released, recorded, and its branch deleted as after any release (decided 7 October 2026); a failed lookup keeps the preparation; none found discards', async () => {
    const unknown = () => prepared({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown', message: 'Door43 did not confirm the release.', retryable: true, next_action: 'look the tag up', request_id: 'r', details: {}, invariant: 'R6' } });
    await put(unknown());
    const found = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: true, target_commitish: 'e000000000000000000000000000000000000001' }) });
    expect((await failure(discard(found.context)))?.code).toBe('already_released');
    expect(found.writes.map(write => write.method)).toEqual(['DELETE']);
    expect(await get()).toMatchObject({ state: 'pre_release', release: { tag: 'v1.3.0', prerelease: true }, last_error: null });
    await put(unknown());
    const broken = door43({ lookup: () => new Response('', { status: 502 }) });
    expect((await failure(discard(broken.context)))?.code).toBe('door43_unavailable');
    expect(broken.writes).toEqual([]);
    expect(await get()).toMatchObject({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown' } });
    const absent = door43();
    expect((await discard(absent.context)).result.state).toBe('discarded');
    expect(absent.writes).toHaveLength(1);
  });

  test('R6, R7: an unconfirmed attempt whose source then moved (restart_required) is still looked up; a release found on the snapshot commit is already_released, recorded, and its branch deleted', async () => {
    await put(prepared({ state: 'restart_required', last_error: { code: 'release_outcome_unknown', message: 'Door43 did not confirm the release.', retryable: true, next_action: 'look the tag up', request_id: 'r', details: {}, invariant: 'R6' } }));
    const found = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: 'e000000000000000000000000000000000000001' }) });
    expect((await failure(discard(found.context)))?.code).toBe('already_released');
    expect(found.writes.map(write => write.method)).toEqual(['DELETE']);
    expect(await get()).toMatchObject({ state: 'full_release', release: { tag: 'v1.3.0', prerelease: false }, last_error: null });
  });
  test('R7: a branch that resists deletion after a found release is adopted is on the preparation\'s record, and the answer says so', async () => {
    await put(prepared({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown', message: 'Door43 did not confirm the release.', retryable: true, next_action: 'run `release.lookup` for the tag before retrying', request_id: 'r', details: {}, invariant: 'R6' } }));
    const stuck = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: 'e000000000000000000000000000000000000001' }), deleteAnswer: () => Response.json({ message: 'branch is protected' }, { status: 500 }) });
    const error = await failure(discard(stuck.context));
    expect(error).toMatchObject({ code: 'already_released' });
    expect(error?.details).toMatchObject({ branch_deleted: false, branch: BRANCH, reason: 'branch is protected' });
    const after = await get();
    expect(after).toMatchObject({ state: 'full_release', last_error: null });
    expect(after?.history.at(-1)?.event).toContain('could not be deleted: branch is protected');
  });

});
