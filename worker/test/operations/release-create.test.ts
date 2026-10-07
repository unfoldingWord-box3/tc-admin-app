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
      if (/\/releases\/\d+$/.test(pathname)) return options.promoteAnswer ? options.promoteAnswer(body!) : Response.json({ ...probeRelease, tag_name: 'v1.3.0', prerelease: false, target_commitish: COMMIT });
      if (pathname.includes('/branches/')) return options.deleteAnswer ? options.deleteAnswer() : new Response(null, { status: 204 });
      return new Response('', { status: 404 });
    }
    if (pathname === '/api/v1/user') return Response.json(user);
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname)) {
      const catalog = { ...repoView.catalog, latest: { ...repoView.catalog.latest!, commit_sha: options.head ?? HEAD }, prod: options.prod === undefined ? repoView.catalog.prod : options.prod };
      return Response.json({ ...repoView, catalog, permissions: { ...repoView.permissions, push: options.push ?? true, admin: false } });
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
    const promotion = door43({ lookup: () => Response.json({ ...probeRelease, tag_name: 'v1.3.0', prerelease: true, target_commitish: COMMIT }) });
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

  test('R6, X1: a release Door43 did not confirm is release_outcome_unknown, not retried, and a second create of it points to the lookup; a tag already on Door43 is release_exists', async () => {
    await put(ready());
    const lost = door43({ releaseAnswer: () => Promise.reject(new TypeError('fetch failed')) });
    expect((await failure(releaseCreate(input(), lost.context)))?.code).toBe('release_outcome_unknown');
    expect(lost.writes.map(write => write.method)).toEqual(['POST']);
    expect(await get()).toMatchObject({ state: 'retryable_failure', last_error: { code: 'release_outcome_unknown' } });
    const again = door43();
    expect((await failure(releaseCreate(input(), again.context)))?.code).toBe('release_outcome_unknown');
    expect(again.writes).toEqual([]);
    await put(ready());
    const taken = door43({ releaseAnswer: () => Response.json({ message: 'Release is has no Tag' }, { status: 409 }) });
    expect((await failure(releaseCreate(input(), taken.context)))?.code).toBe('release_exists');
    expect(taken.writes.map(write => write.method)).toEqual(['POST']);
    expect((await get())?.state).toBe('ready_for_release');
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
});
