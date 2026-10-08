// `release.create` (#39): the Door43 release of a prepared snapshot. Before
// any write, the gates: health (H2, Q6), notes, version (R9), binding (R5),
// permission (A2). Then the tag and the release on the snapshot commit, the
// branch deleted only after (R3, R7), a refused release kept for retry and an
// unconfirmed one not retried (R6, X1), and the same request after success
// answered as the same receipt (§1 rule 6).
import { CatalogError, Preparation } from '@tc-admin/shared/schema';
import type { Health } from '@tc-admin/shared/schema';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { planStore } from '../../src/operations/plans';
import { releaseCreate, releaseVersion } from '../../src/operations/release-create';
import { releasePromote } from '../../src/operations/release-promote';
import { recorded } from '../support/recorded';

type Repo = { catalog: { latest: { branch_or_tag_name: string; commit_sha: string } | null; prod: { branch_or_tag_name: string; commit_sha: string } | null }; permissions: { push: boolean; admin: boolean; pull: boolean } };
const repoView = recorded<Repo>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const HEAD = repoView.catalog.latest!.commit_sha;
const TAG_SHA = repoView.catalog.prod!.commit_sha;
const user = recorded<unknown>('2026-10-05/user/user.json');
const probeRelease = recorded<Record<string, unknown>>('2026-09-22/probe-write/11-prerelease-v1.1.0.json');
const COMMIT = 'e000000000000000000000000000000000000001';
const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
const BRANCH = 'temp-tca-release/v1.3.0';
const NOW = new Date('2026-10-07T16:00:00.000Z');
const WARNING_ISSUE = { code: 'sb_ingredient_mismatch', rule: 'META-015', severity: 'warning', title: 'Ingredient sizes or checksums do not match the files in the repo', details: 'd', suggestion: 's' };
const health = (state: Health['state'], issues: Health['issues'] = []): Health => ({ state, severity_raw: state === 'healthy' ? 'success' : state, ref: BRANCH, checked_at: '2026-10-07T15:05:00.000Z', issue_count: issues?.length ?? null, issues, source: 'door43' });

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
  async list(options: { prefix: string }) {
    return { keys: [...this.store.keys()].filter(name => name.startsWith(options.prefix)).map(name => ({ name })), list_complete: true };
  }
}
let kv: MemoryKV;
beforeEach(() => {
  kv = new MemoryKV();
});

/** A preparation as `preparation.read` leaves it once the health is in. */
const ready = (overrides: Partial<Preparation> = {}): Preparation =>
  Preparation.parse({
    id: 'v1.3.0',
    project_ref: PENDAU,
    state: 'ready_for_release',
    bound_to: { default_branch_sha: HEAD, release_tag: 'v1.2', release_tag_sha: TAG_SHA },
    selection: { new: ['gen'], revised: ['mat'], unknown_included: [] },
    snapshot: { branch: BRANCH, commit_sha: COMMIT, files: [{ path: 'ingredients/GEN.usfm', source: 'default_branch', unit: 'gen' }] },
    health: health('healthy'),
    requires_acknowledgement: false,
    version: { baseline_tag: 'v1.2', proposed: 'v1.3.0', confirmed: 'v1.3.0' },
    notes: { draft: 'Release v1.3.0: Genesis added, Matthew revised.', confirmed: null },
    release: null,
    last_error: null,
    history: [{ at: '2026-10-07T15:05:00.000Z', from: 'health_checking', to: 'ready_for_release', event: 'health healthy' }],
    freshness: { read_at: '2026-10-07T15:05:00.000Z', source: 'live', age_seconds: 0 },
    ...overrides,
  });

interface Door43Options {
  head?: string;
  prod?: { branch_or_tag_name: string; commit_sha: string } | null;
  push?: boolean;
  releaseAnswer?: (body: Record<string, unknown>) => Response | Promise<Response>;
  deleteAnswer?: () => Response | Promise<Response>;
  lookup?: (tag: string) => Response;
  promoteAnswer?: (body: Record<string, unknown>) => Response;
  metadataType?: string;
}
/** Door43 as the release sees it: the account, the repository, the release write, the branch deletion, and the lookup. */
function door43(options: Door43Options = {}) {
  const writes: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  const fetch: Fetch = async (url, init) => {
    const { pathname } = new URL(url);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      writes.push({ method, path: pathname, body });
      if (pathname.endsWith('/releases')) return options.releaseAnswer ? options.releaseAnswer(body!) : Response.json({ ...probeRelease, door43_metadata: null, tag_name: body!.tag_name, name: body!.tag_name, body: body!.body, target_commitish: body!.target_commitish, prerelease: body!.prerelease, html_url: `https://qa.door43.org/${PENDAU.owner}/${PENDAU.repo}/releases/tag/${String(body!.tag_name)}` }, { status: 201 });
      if (/\/releases\/\d+$/.test(pathname)) return options.promoteAnswer ? options.promoteAnswer(body!) : Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: COMMIT });
      if (pathname.includes('/branches/')) return options.deleteAnswer ? options.deleteAnswer() : new Response(null, { status: 204 });
      return new Response('', { status: 404 });
    }
    if (pathname === '/api/v1/user') return Response.json(user);
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname)) {
      const catalog = { ...repoView.catalog, latest: { ...repoView.catalog.latest!, commit_sha: options.head ?? HEAD }, prod: options.prod === undefined ? repoView.catalog.prod : options.prod };
      return Response.json({ ...repoView, ...(options.metadataType ? { metadata_type: options.metadataType } : {}), catalog, permissions: { ...repoView.permissions, push: options.push ?? true, admin: false } });
    }
    const tag = /\/releases\/tags\/([^/]+)$/.exec(pathname);
    if (tag) return options.lookup ? options.lookup(decodeURIComponent(tag[1]!)) : Response.json({ message: 'not found' }, { status: 404 });
    return new Response('', { status: 404 });
  };
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-9', 'door43-token', kv);
  const context: OperationContext = { ...base, door43: { ...base.door43!, fetch }, now: () => NOW };
  return { context, writes };
}
const put = (preparation: Preparation) => planStore(kv).putPreparation(PENDAU.owner, PENDAU.repo, preparation.id, preparation);
const get = () => planStore(kv).getPreparation<Preparation>(PENDAU.owner, PENDAU.repo, 'v1.3.0');
const input = (overrides: Partial<Parameters<typeof releaseCreate>[0]> = {}) => ({ ...PENDAU, preparation_id: 'v1.3.0', version: 'v1.3.0', notes: 'Release v1.3.0: Genesis added, Matthew revised.', prerelease: false, acknowledge_warnings: false, ...overrides });
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));

describe('release.create (#39)', () => {
  test('R3, R7: a ready preparation becomes a full release by one POST on the snapshot commit, then the branch is deleted; the receipt lists the tag and the release', async () => {
    await put(ready());
    const { context, writes } = door43();
    const receipt = await releaseCreate(input(), context);
    expect(writes.map(write => [write.method, write.path])).toEqual([
      ['POST', `/api/v1/repos/${PENDAU.owner}/${PENDAU.repo}/releases`],
      ['DELETE', `/api/v1/repos/${PENDAU.owner}/${PENDAU.repo}/branches/${encodeURIComponent(BRANCH)}`],
    ]);
    expect(writes[0]!.body).toEqual({ tag_name: 'v1.3.0', name: 'v1.3.0', body: 'Release v1.3.0: Genesis added, Matthew revised.', target_commitish: COMMIT, prerelease: false, draft: false });
    expect(receipt.wrote).toEqual([
      { kind: 'tag', target: 'v1.3.0', sha: COMMIT },
      { kind: 'release', target: 'v1.3.0', sha: COMMIT, url: `https://qa.door43.org/${PENDAU.owner}/${PENDAU.repo}/releases/tag/v1.3.0` },
    ]);
    expect(receipt.result).toMatchObject({ state: 'full_release', release: { tag: 'v1.3.0', prerelease: false }, version: { confirmed: 'v1.3.0' }, notes: { confirmed: 'Release v1.3.0: Genesis added, Matthew revised.' }, last_error: null });
    expect(receipt.result.history.at(-1)).toMatchObject({ from: 'ready_for_release', to: 'full_release', event: 'release.create' });
    expect(receipt).toMatchObject({ warnings: [], acknowledged_warnings: false, plan_id: null });
    expect((await get())?.state).toBe('full_release');
    expect(Preparation.parse(receipt.result)).toEqual(receipt.result);
  });

  test('a pre-release is created with the flag and leaves the preparation pre_release; release.promote then makes it full by one PATCH of the flag alone (R8)', async () => {
    await put(ready());
    const { context, writes } = door43();
    const receipt = await releaseCreate(input({ prerelease: true }), context);
    expect(writes[0]!.body).toMatchObject({ prerelease: true });
    expect(receipt.result).toMatchObject({ state: 'pre_release', release: { prerelease: true } });
    const promotion = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: true, target_commitish: COMMIT }) });
    const promoted = await releasePromote({ ...PENDAU, tag: 'v1.3.0' }, promotion.context);
    expect(promotion.writes).toEqual([{ method: 'PATCH', path: `/api/v1/repos/${PENDAU.owner}/${PENDAU.repo}/releases/${String(probeRelease.id)}`, body: { prerelease: false } }]);
    expect(promoted.result).toEqual({ tag: 'v1.3.0', url: String(probeRelease.html_url), prerelease: false });
    expect((await get())).toMatchObject({ state: 'full_release', release: { prerelease: false } });
  });

  test('release.promote refuses a release Door43 lacks as not_found, a full release as not_prerelease, and a refused edit as promotion_failed with Door43 message', async () => {
    expect((await failure(releasePromote({ ...PENDAU, tag: 'v9.9.9' }, door43().context)))?.code).toBe('not_found');
    const full = door43({ lookup: () => Response.json({ ...probeRelease, tag_name: 'v1.2', prerelease: false }) });
    expect((await failure(releasePromote({ ...PENDAU, tag: 'v1.2' }, full.context)))?.code).toBe('not_prerelease');
    expect(full.writes).toEqual([]);
    const refused = door43({ lookup: () => Response.json({ ...probeRelease, tag_name: 'v1.3.0', prerelease: true }), promoteAnswer: () => Response.json({ message: 'release is locked' }, { status: 422 }) });
    const error = await failure(releasePromote({ ...PENDAU, tag: 'v1.3.0' }, refused.context));
    expect(error).toMatchObject({ code: 'promotion_failed' });
    expect(error?.message).toContain('release is locked');
    expect((await failure(releasePromote({ ...PENDAU, tag: 'v1.3.0' }, door43({ push: false }).context)))?.code).toBe('permission_denied');
  });

  test('H2: every state short of ready is health_blocked and writes nothing', async () => {
    for (const [state, healthState] of [['health_checking', 'checking'], ['health_blocked', 'failing'], ['health_blocked', 'door43_unavailable'], ['snapshot_prepared', 'checking']] as const) {
      kv = new MemoryKV();
      await put(ready({ state, health: health(healthState, null) }));
      const { context, writes } = door43();
      expect((await failure(releaseCreate(input(), context)))?.code).toBe('health_blocked');
      expect(writes).toEqual([]);
    }
  });

  test('H2, Q6: a warning needs acknowledgement; without it warning_not_acknowledged and nothing written, with it the release proceeds and the receipt records the acknowledgement', async () => {
    await put(ready({ health: health('warning', [WARNING_ISSUE]), requires_acknowledgement: true }));
    const refused = door43();
    expect((await failure(releaseCreate(input(), refused.context)))?.code).toBe('warning_not_acknowledged');
    expect(refused.writes).toEqual([]);
    const accepted = door43();
    const receipt = await releaseCreate(input({ acknowledge_warnings: true }), accepted.context);
    expect(receipt.acknowledged_warnings).toBe(true);
    expect(receipt.result.history.at(-1)?.event).toBe('release.create, warnings acknowledged');
    expect(accepted.writes).toHaveLength(2);
    kv = new MemoryKV();
    await put(ready({ health: health('info', [{ ...WARNING_ISSUE, code: 'release_needed', severity: 'info' }]) }));
    expect((await releaseCreate(input(), door43().context)).acknowledged_warnings).toBe(false);
  });

  test('R9: the version must be valid, after the baseline, and not below the one confirmed at prepare; empty notes are validation_failed; nothing is written', async () => {
    expect(releaseVersion('v1.3.0', 'v1.2', 'v1.3.0')).toBe('v1.3.0');
    expect(releaseVersion(' 1.4.0 ', 'v1.2', 'v1.3.0')).toBe('v1.4.0');
    expect(releaseVersion('v2.0.0', null, 'v1.0.0')).toBe('v2.0.0');
    for (const [sent, baseline, confirmed] of [['v1.2', 'v1.2', 'v1.3.0'], ['v1.1.9', 'v1.2', 'v1.3.0'], ['v1.2.9', 'v1.2', 'v1.3.0'], ['latest', 'v1.2', 'v1.3.0'], ['', null, 'v1.0.0']] as const) {
      expect(() => releaseVersion(sent, baseline, confirmed)).toThrow(expect.objectContaining({ code: 'invalid_version' }));
    }
    await put(ready());
    const { context, writes } = door43();
    expect((await failure(releaseCreate(input({ version: 'v1.2.9' }), context)))?.code).toBe('invalid_version');
    const empty = await failure(releaseCreate(input({ notes: '  ' }), context));
    expect(empty).toMatchObject({ code: 'validation_failed' });
    expect(empty?.details).toMatchObject({ fields: [{ path: 'notes' }] });
    expect(writes).toEqual([]);
  });

  test('R5, A2: a moved default branch or a new release since the plan is source_changed and the preparation restart_required; a lost push right is permission_denied; nothing is written', async () => {
    await put(ready());
    const moved = door43({ head: 'f000000000000000000000000000000000000000' });
    expect((await failure(releaseCreate(input(), moved.context)))?.code).toBe('source_changed');
    expect(moved.writes).toEqual([]);
    expect((await get())?.state).toBe('restart_required');
    await put(ready());
    const released = door43({ prod: { branch_or_tag_name: 'v1.2.5', commit_sha: 'a1'.padEnd(40, '0') } });
    expect((await failure(releaseCreate(input(), released.context)))?.code).toBe('source_changed');
    await put(ready());
    const denied = door43({ push: false });
    expect((await failure(releaseCreate(input(), denied.context)))?.code).toBe('permission_denied');
    expect(denied.writes).toEqual([]);
    expect((await get())?.state).toBe('ready_for_release');
  });

  test('R7, X1: a release Door43 refuses keeps the branch and the preparation as retryable_failure with the error; the retry creates it', async () => {
    await put(ready());
    const refused = door43({ releaseAnswer: () => Response.json({ message: 'target_commitish is not a valid commit' }, { status: 422 }) });
    const error = await failure(releaseCreate(input(), refused.context));
    expect(error).toMatchObject({ code: 'release_failed' });
    expect(error?.message).toBe('Release creation failed: target_commitish is not a valid commit.');
    expect(refused.writes.map(write => write.method)).toEqual(['POST']);
    const after = await get();
    expect(after).toMatchObject({ state: 'retryable_failure', last_error: { code: 'release_failed' }, release: null });
    expect(after?.history.at(-1)).toMatchObject({ from: 'ready_for_release', to: 'retryable_failure' });
    const retry = door43();
    const receipt = await releaseCreate(input(), retry.context);
    expect(receipt.result.state).toBe('full_release');
    expect(retry.writes.map(write => write.method)).toEqual(['POST', 'DELETE']);
  });

  test('R6, X1: a release Door43 did not confirm is release_outcome_unknown and not retried; the next create looks the tag up first: found on the snapshot commit, it is release_exists, the preparation records it and its branch is deleted; found elsewhere, release_exists and nothing changes; not found, it is created (#40)', async () => {
    await put(ready());
    const lost = door43({ releaseAnswer: () => Promise.reject(new TypeError('fetch failed')) });
    expect((await failure(releaseCreate(input(), lost.context)))?.code).toBe('release_outcome_unknown');
    expect(lost.writes.map(write => write.method)).toEqual(['POST']);
    expect(await get()).toMatchObject({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown' } });
    const denied = door43({ push: false, lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: COMMIT }) });
    expect((await failure(releaseCreate(input(), denied.context)))?.code).toBe('permission_denied');
    expect(denied.writes).toEqual([]);
    expect(await get()).toMatchObject({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown' } });
    const found = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: COMMIT, html_url: 'https://qa.door43.org/found' }) });
    const exists = await failure(releaseCreate(input(), found.context));
    expect(exists).toMatchObject({ code: 'release_exists' });
    expect(exists?.details).toMatchObject({ tag: 'v1.3.0', url: 'https://qa.door43.org/found', target_sha: COMMIT });
    expect(found.writes.map(write => write.method)).toEqual(['DELETE']);
    expect(exists?.details).toMatchObject({ branch_deleted: true });
    expect(await get()).toMatchObject({ state: 'full_release', release: { tag: 'v1.3.0', url: 'https://qa.door43.org/found', prerelease: false }, last_error: null });
    await put(ready({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown', message: 'Door43 did not confirm the release.', retryable: true, next_action: 'run `release.lookup` for the tag before retrying', request_id: 'r', details: {}, invariant: 'R6' } }));
    const other = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: 'f000000000000000000000000000000000000000' }) });
    expect((await failure(releaseCreate(input(), other.context)))?.code).toBe('release_exists');
    expect(other.writes).toEqual([]);
    expect((await get())?.state).toBe('retryable_failure');
    await put(ready({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown', message: 'Door43 did not confirm the release.', retryable: true, next_action: 'run `release.lookup` for the tag before retrying', request_id: 'r', details: {}, invariant: 'R6' } }));
    const absent = door43();
    expect((await releaseCreate(input(), absent.context)).result.state).toBe('full_release');
    expect(absent.writes.map(write => write.method)).toEqual(['POST', 'DELETE']);
    kv = new MemoryKV();
    await put(ready());
    const taken = door43({ releaseAnswer: () => Response.json({ message: 'Release is has no Tag' }, { status: 409 }) });
    expect((await failure(releaseCreate(input(), taken.context)))?.code).toBe('release_exists');
    expect(taken.writes.map(write => write.method)).toEqual(['POST']);
    expect((await get())?.state).toBe('ready_for_release');
  });

  test('R6, R5, X1: an unconfirmed attempt on a moved source (restart_required) is looked up first: found on the snapshot commit, it is recorded and its branch deleted; not found, it stays source_changed and nothing is created', async () => {
    const unknown = { code: 'release_outcome_unknown', message: 'Door43 did not confirm the release.', retryable: true, next_action: 'run `release.lookup` for the tag before retrying', request_id: 'r', details: {}, invariant: 'R6' } as const;
    await put(ready({ state: 'restart_required', last_error: unknown }));
    const found = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: COMMIT }) });
    expect((await failure(releaseCreate(input(), found.context)))?.code).toBe('release_exists');
    expect(found.writes.map(write => write.method)).toEqual(['DELETE']);
    expect(await get()).toMatchObject({ state: 'full_release', last_error: null });
    await put(ready({ state: 'restart_required', last_error: unknown }));
    const looked: string[] = [];
    const absent = door43({ lookup: tag => (looked.push(tag), Response.json({ message: 'not found' }, { status: 404 })) });
    expect((await failure(releaseCreate(input(), absent.context)))?.code).toBe('source_changed');
    expect(looked).toEqual(['v1.3.0']);
    expect(absent.writes).toEqual([]);
    expect(await get()).toMatchObject({ state: 'restart_required', last_error: { code: 'release_outcome_unknown' } });
  });

  test('R6, X1: a 5xx answer to the release is release_outcome_unknown; a second create, even at a higher version, looks the tag it sent up first and, finding none, creates (decided 7 October 2026)', async () => {
    await put(ready());
    const gateway = door43({ releaseAnswer: () => Response.json({ message: 'gateway timeout' }, { status: 504 }) });
    expect((await failure(releaseCreate(input(), gateway.context)))?.code).toBe('release_outcome_unknown');
    expect(await get()).toMatchObject({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown' } });
    const looked: string[] = [];
    const bumped = door43({ lookup: tag => (looked.push(tag), Response.json({ message: 'not found' }, { status: 404 })) });
    const receipt = await releaseCreate(input({ version: 'v1.4.0' }), bumped.context);
    expect(looked).toEqual(['v1.3.0']);
    expect(bumped.writes.map(write => write.method)).toEqual(['POST', 'DELETE']);
    expect(receipt.result).toMatchObject({ state: 'full_release', release: { tag: 'v1.4.0' } });
  });

  test('R6, R7: a 201 for another commit is release_outcome_unknown; nothing is recorded as released and the branch is kept', async () => {
    await put(ready());
    const other = door43({ releaseAnswer: body => Response.json({ ...probeRelease, door43_metadata: null, tag_name: body.tag_name, target_commitish: 'f'.repeat(40), prerelease: body.prerelease }, { status: 201 }) });
    expect((await failure(releaseCreate(input(), other.context)))?.code).toBe('release_outcome_unknown');
    expect(other.writes.map(write => write.method)).toEqual(['POST']);
    expect(await get()).toMatchObject({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown' }, release: null });
  });

  test('A2: a caller without push learns nothing of the preparation or its receipt; permission_denied comes first', async () => {
    await put(ready());
    await releaseCreate(input(), door43().context);
    const denied = door43({ push: false });
    const error = await failure(releaseCreate(input(), denied.context));
    expect(error?.code).toBe('permission_denied');
    expect(error?.details).toEqual({ owner: PENDAU.owner, repo: PENDAU.repo });
    expect((await failure(releaseCreate(input({ preparation_id: 'v9.9.9' }), denied.context)))?.code).toBe('permission_denied');
    expect(denied.writes).toEqual([]);
  });

  test('R8, R9: a pre-release created above the prepared version is promoted by its tag, and the preparation it came from follows to full_release', async () => {
    await put(ready());
    await releaseCreate(input({ version: 'v1.4.0', prerelease: true }), door43().context);
    const promotion = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.4.0', prerelease: true, target_commitish: COMMIT }), promoteAnswer: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.4.0', prerelease: false, target_commitish: COMMIT }) });
    await releasePromote({ ...PENDAU, tag: 'v1.4.0' }, promotion.context);
    expect(await get()).toMatchObject({ id: 'v1.3.0', state: 'full_release', release: { tag: 'v1.4.0', prerelease: false } });
  });

  test('W2: release.promote in a project that is not Scripture Burrito is not_releasable and writes nothing', async () => {
    const lookup = () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: true, target_commitish: COMMIT });
    const rc = door43({ metadataType: 'rc', lookup });
    expect((await failure(releasePromote({ ...PENDAU, tag: 'v1.3.0' }, rc.context)))?.code).toBe('not_releasable');
    expect(rc.writes).toEqual([]);
    const sb = door43({ metadataType: 'sb', lookup });
    expect((await releasePromote({ ...PENDAU, tag: 'v1.3.0' }, sb.context)).result.prerelease).toBe(false);
    expect(sb.writes.map(write => write.method)).toEqual(['PATCH']);
  });

  test('R8, X1: a promotion Door43 applied but did not answer is followed on the next promote without a write, also above the prepared version', async () => {
    await put(ready());
    await releaseCreate(input({ version: 'v1.4.0', prerelease: true }), door43().context);
    const lost = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.4.0', prerelease: true, target_commitish: COMMIT }), promoteAnswer: () => Response.json({ message: 'bad gateway' }, { status: 502 }) });
    expect((await failure(releasePromote({ ...PENDAU, tag: 'v1.4.0' }, lost.context)))?.code).toBe('promotion_failed');
    expect((await get())?.state).toBe('pre_release');
    const full = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.4.0', prerelease: false, target_commitish: COMMIT }) });
    const receipt = await releasePromote({ ...PENDAU, tag: 'v1.4.0' }, full.context);
    expect(full.writes).toEqual([]);
    expect(receipt).toMatchObject({ wrote: [], result: { tag: 'v1.4.0', prerelease: false } });
    expect(await get()).toMatchObject({ id: 'v1.3.0', state: 'full_release', release: { tag: 'v1.4.0', prerelease: false } });
    const other = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.4.0', prerelease: false, target_commitish: 'f'.repeat(40) }) });
    expect((await failure(releasePromote({ ...PENDAU, tag: 'v1.4.0' }, other.context)))?.code).toBe('not_prerelease');
  });

  test('R8, X1: a promotion answered 200 for another tag or commit is promotion_failed, and the preparation does not follow', async () => {
    await put(ready());
    await releaseCreate(input({ prerelease: true }), door43().context);
    const lookup = () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: true, target_commitish: COMMIT });
    for (const answer of [{ tag_name: 'v9.9.9', target_commitish: COMMIT }, { tag_name: 'v1.3.0', target_commitish: 'f'.repeat(40) }]) {
      const lying = door43({ lookup, promoteAnswer: () => Response.json({ ...probeRelease, door43_metadata: null, prerelease: false, ...answer }) });
      expect((await failure(releasePromote({ ...PENDAU, tag: 'v1.3.0' }, lying.context)))?.code).toBe('promotion_failed');
      expect((await get())?.state).toBe('pre_release');
    }
  });

  test('§1 rule 6: a preparation prepared again under the same id after its pre-release is not answered the old receipt; its own release is created', async () => {
    await put(ready());
    const first = await releaseCreate(input({ version: 'v1.4.0', prerelease: true }), door43().context);
    const again = 'e000000000000000000000000000000000000002';
    await put(ready({ snapshot: { ...ready().snapshot!, commit_sha: again } }));
    const second = door43();
    const receipt = await releaseCreate(input({ version: 'v1.5.0', prerelease: true }), second.context);
    expect(receipt).not.toEqual(first);
    expect(receipt.result).toMatchObject({ state: 'pre_release', release: { tag: 'v1.5.0' } });
    expect(second.writes[0]).toMatchObject({ method: 'POST', body: { tag_name: 'v1.5.0', target_commitish: again } });
  });

  test('R9, X1: a refused release leaves the prepare-time version as the floor; a retry at it performs the POST', async () => {
    await put(ready());
    const refused = door43({ releaseAnswer: () => Response.json({ message: 'tag name is not allowed' }, { status: 422 }) });
    expect((await failure(releaseCreate(input({ version: 'v1.4.0' }), refused.context)))?.code).toBe('release_failed');
    expect(await get()).toMatchObject({ state: 'retryable_failure', version: { confirmed: 'v1.3.0' } });
    const retry = door43();
    expect((await releaseCreate(input(), retry.context)).result.release?.tag).toBe('v1.3.0');
    expect(retry.writes.map(write => write.method)).toEqual(['POST', 'DELETE']);
  });

  test('R7: a branch that resists deletion after the release is a warning on the receipt, and the preparation is released all the same', async () => {
    await put(ready());
    const { context } = door43({ deleteAnswer: () => Response.json({ message: 'branch is protected' }, { status: 500 }) });
    const receipt = await releaseCreate(input(), context);
    expect(receipt.result.state).toBe('full_release');
    expect(receipt.warnings).toEqual([{ code: 'branch_not_deleted', message: `The temporary branch ${BRANCH} could not be deleted: branch is protected. The release is complete; delete the branch on Door43.` }]);
    expect((await get())?.state).toBe('full_release');
  });

  test('the same request after success answers the same receipt and writes nothing; a released preparation created again by another request is release_exists; a missing one is not_found', async () => {
    await put(ready());
    const first = door43();
    const receipt = await releaseCreate(input(), first.context);
    const second = door43();
    expect(await releaseCreate(input(), second.context)).toEqual(receipt);
    expect(second.writes).toEqual([]);
    kv.store.delete(`receipt:release:${PENDAU.owner.toLowerCase()}/${PENDAU.repo}/v1.3.0`);
    expect((await failure(releaseCreate(input(), door43().context)))?.code).toBe('release_exists');
    expect((await failure(releaseCreate(input({ preparation_id: 'v9.9.9' }), door43().context)))?.code).toBe('not_found');
  });
  test('R6, R7: a 409 at creation is looked up (decided 7 October 2026): this snapshot\'s release is recorded, its branch deleted, and the answer release_exists; a tag on another commit is release_exists with the error recorded and nothing deleted; no second POST', async () => {
    await put(ready());
    const ours = door43({ releaseAnswer: () => Response.json({ message: 'Release is has no Tag' }, { status: 409 }), lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: COMMIT, html_url: 'https://qa.door43.org/ours' }) });
    const exists = await failure(releaseCreate(input(), ours.context));
    expect(exists).toMatchObject({ code: 'release_exists' });
    expect(exists?.details).toMatchObject({ url: 'https://qa.door43.org/ours', target_sha: COMMIT, branch_deleted: true });
    expect(ours.writes.map(write => write.method)).toEqual(['POST', 'DELETE']);
    expect(await get()).toMatchObject({ state: 'full_release', release: { tag: 'v1.3.0', url: 'https://qa.door43.org/ours' }, last_error: null });
    kv = new MemoryKV();
    await put(ready());
    const foreign = door43({ releaseAnswer: () => Response.json({ message: 'Release is has no Tag' }, { status: 409 }), lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.3.0', prerelease: false, target_commitish: 'f000000000000000000000000000000000000000' }) });
    expect((await failure(releaseCreate(input(), foreign.context)))?.code).toBe('release_exists');
    expect(foreign.writes.map(write => write.method)).toEqual(['POST']);
    expect(await get()).toMatchObject({ state: 'ready_for_release', release: null, last_error: { code: 'release_exists' } });
  });

  test('R5: a repository whose catalog names no default-branch head is door43_unavailable and nothing is written or restarted (decided 7 October 2026)', async () => {
    await put(ready());
    const { context, writes } = door43({ head: '' });
    expect((await failure(releaseCreate(input(), context)))?.code).toBe('door43_unavailable');
    expect(writes).toEqual([]);
    expect((await get())?.state).toBe('ready_for_release');
  });

  test('R6, R8, R9: a pre-release above the preparation id found by the lookup after an unconfirmed attempt is recorded with its tag pointer, so its promotion by tag moves the original preparation to full_release', async () => {
    await put(ready({ state: 'retryable_failure', version: { baseline_tag: 'v1.2', proposed: 'v1.3.0', confirmed: 'v1.4.0' }, last_error: { code: 'release_outcome_unknown', message: 'Door43 did not confirm the release.', retryable: true, next_action: 'run `release.lookup` for the tag before retrying', request_id: 'r', details: {}, invariant: 'R6' } }));
    const found = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.4.0', prerelease: true, target_commitish: COMMIT }) });
    expect((await failure(releaseCreate(input({ version: 'v1.4.0' }), found.context)))?.code).toBe('release_exists');
    expect(await get()).toMatchObject({ id: 'v1.3.0', state: 'pre_release', release: { tag: 'v1.4.0', prerelease: true } });
    const promotion = door43({ lookup: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.4.0', prerelease: true, target_commitish: COMMIT }), promoteAnswer: () => Response.json({ ...probeRelease, door43_metadata: null, tag_name: 'v1.4.0', prerelease: false, target_commitish: COMMIT }) });
    await releasePromote({ ...PENDAU, tag: 'v1.4.0' }, promotion.context);
    expect(await get()).toMatchObject({ id: 'v1.3.0', state: 'full_release', release: { tag: 'v1.4.0', prerelease: false } });
  });

});
