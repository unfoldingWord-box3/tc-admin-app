// Finding a release preparation again (#125): which listed preparations are
// under way, their words, a preparation's own address and how it reads back,
// the preparation a `preparation_active` refusal names, and a stepper that did
// not make a preparation finding it from the list and a read.
import { PREPARATION_STATES, Preparation } from '@tc-admin/shared/schema';
import type { OperationErrorShape } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { ApiError, callOperation } from '../src/api/client';
import { hashRef, releaseHash } from '../src/portfolio-labels';
import { ACTIVE_STATES, FINISHED_STATES, activePreparations, activeSummary, isActive, preparationHash, preparationLink, preparationVersion, refusedFor, withAnswer } from '../src/preparations';
import { STATE_LABELS, canDiscard, discardOnly, releaseGate, stepOf } from '../src/release-stepper';

const project = { ref: { owner: 'tc-admin-qa-org', repo: 'id_obs1948', id: 1, url: 'https://qa.door43.org/tc-admin-qa-org/id_obs1948' } };

const stored = (id: string, state: Preparation['state'], overrides: Partial<Preparation> = {}): Preparation =>
  Preparation.parse({
    id,
    project_ref: { owner: project.ref.owner, repo: project.ref.repo },
    state,
    bound_to: { default_branch_sha: 'a'.repeat(40), release_tag: 'v1.0.0', release_tag_sha: 'b'.repeat(40) },
    selection: { new: [], revised: [], unknown_included: [] },
    snapshot: { branch: `temp-tca-release/${id}`, commit_sha: 'c'.repeat(40), files: [] },
    health: { state: 'checking', severity_raw: null, ref: `temp-tca-release/${id}`, checked_at: null, issue_count: null, issues: null, source: 'door43' },
    requires_acknowledgement: false,
    version: { baseline_tag: 'v1.0.0', proposed: id, confirmed: id },
    notes: { draft: `Release ${id}`, confirmed: null },
    release: null,
    last_error: null,
    history: [{ at: '2026-10-08T10:00:00.000Z', from: 'snapshot_prepared', to: state, event: 'push confirmed' }],
    freshness: { read_at: '2026-10-08T10:00:00.000Z', source: 'cache', age_seconds: 60 },
    ...overrides,
  });

const error = (code: OperationErrorShape['code'], details: Record<string, unknown>): OperationErrorShape => ({ code, message: 'm', retryable: false, next_action: 'n', request_id: 'r1', details, invariant: null });

describe('preparations under way and finished (domain model §6)', () => {
  test('R7: every state is either under way or finished, never both; under way is exactly what can be discarded', () => {
    expect([...ACTIVE_STATES, ...FINISHED_STATES].sort()).toEqual([...PREPARATION_STATES].sort());
    for (const state of PREPARATION_STATES) expect(isActive({ state }), state).toBe(canDiscard({ state }));
    expect(FINISHED_STATES).toEqual(['pre_release', 'full_release', 'discarded']);
  });

  test('R7: the list keeps the preparations under way, in its order (newest first), and leaves released and discarded ones out', () => {
    const listed = [stored('v1.3.0', 'retryable_failure'), stored('v1.2.0', 'full_release'), stored('v1.1.9', 'restart_required'), stored('v1.1.0', 'discarded'), stored('v1.0.1', 'health_checking')];
    expect(activePreparations(listed).map(preparation => preparation.id)).toEqual(['v1.3.0', 'v1.1.9', 'v1.0.1']);
  });

  test('a preparation under way reads in glossary words, by the version it goes by', () => {
    expect(activeSummary(stored('v1.1.0', 'health_checking'))).toBe('A release is being prepared: version v1.1.0 · Health check running');
    expect(activeSummary(stored('v1.1.0', 'restart_required'))).toBe('A release is being prepared: version v1.1.0 · Restart required');
    expect(preparationVersion(stored('v1.1.0', 'retryable_failure', { version: { baseline_tag: 'v1.0.0', proposed: 'v1.1.0', confirmed: 'v1.2.0' } }))).toBe('v1.2.0');
    expect(preparationVersion(stored('v1.1.0', 'selecting', { version: { baseline_tag: null, proposed: 'v1.1.0', confirmed: null } }))).toBe('v1.1.0');
    for (const state of ACTIVE_STATES) expect(STATE_LABELS[state]).toBeTruthy();
  });

  test('a listed preparation leads to the stepper at it while under way, to its release once released, and nowhere once discarded', () => {
    expect(preparationLink(project, stored('v1.1.0', 'ready_for_release'))).toBe('#/tc-admin-qa-org/id_obs1948/release/v1.1.0');
    expect(preparationLink(project, stored('v1.1.0', 'pre_release', { release: { tag: 'v1.1.0', url: 'u', prerelease: true } }))).toBe('#/tc-admin-qa-org/id_obs1948/releases/v1.1.0');
    expect(preparationLink(project, stored('v1.1.0', 'discarded'))).toBeNull();
  });

  test('a discard\'s answer replaces the listed preparation, which then leaves the ones under way', () => {
    const listed = [stored('v1.2.0', 'health_blocked'), stored('v1.1.0', 'ready_for_release')];
    expect(activePreparations(withAnswer(listed, stored('v1.2.0', 'discarded'))).map(preparation => preparation.id)).toEqual(['v1.1.0']);
  });
});

describe('a preparation\'s own address (#125)', () => {
  test('#/<owner>/<repo>/release/<version> names the preparation and reads back; /release alone is the stepper', () => {
    const hash = preparationHash(project, 'v1.1.0');
    expect(hash).toBe('#/tc-admin-qa-org/id_obs1948/release/v1.1.0');
    expect(hashRef(hash)).toEqual({ owner: 'tc-admin-qa-org', repo: 'id_obs1948', view: 'preparation', preparation: 'v1.1.0' });
    expect(hashRef(releaseHash(project))).toEqual({ owner: 'tc-admin-qa-org', repo: 'id_obs1948', view: 'release' });
    expect(hashRef('#/o/r/releases/v1.1.0')).toEqual({ owner: 'o', repo: 'r', view: 'tag', tag: 'v1.1.0' });
  });

  test('a version that needs encoding round-trips; extra segments or a bad encoding name nothing', () => {
    expect(hashRef(preparationHash({ ref: { owner: 'team a', repo: 'en/obs', id: 1, url: '' } }, 'v1.1.0+x/y'))).toEqual({ owner: 'team a', repo: 'en/obs', view: 'preparation', preparation: 'v1.1.0+x/y' });
    expect(hashRef('#/o/r/release/v1/extra')).toBeNull();
    expect(hashRef('#/o/r/release/%E0%A4')).toBeNull();
    expect(hashRef('#/o/r/release/')).toBeNull();
  });
});

describe('the preparation_active refusal (#125)', () => {
  test('X2: names the preparation by the version release.prepare put in its details; any other failure names none', () => {
    expect(refusedFor(error('preparation_active', { owner: 'o', repo: 'r', branch: 'temp-tca-release/v1.1.0', preparation_id: 'v1.1.0' }))).toBe('v1.1.0');
    expect(refusedFor(error('preparation_active', { branch: 'temp-tca-release/v1.1.0' }))).toBeNull();
    expect(refusedFor(error('source_changed', { preparation_id: 'v1.1.0' }))).toBeNull();
    expect(refusedFor(null)).toBeNull();
  });

  test('X2: arrives through the client as an ApiError carrying the version', async () => {
    const body = { ...error('preparation_active', { preparation_id: 'v1.1.0' }), message: 'A release is being prepared for this project. Finish or discard it first.', invariant: 'W7' };
    const failure = await callOperation('release.prepare', { owner: 'o', repo: 'r', plan_id: 'p1', selection: {}, unknown_included: [], version: null }, async () => new Response(JSON.stringify(body), { status: 409 })).catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(ApiError);
    expect(refusedFor((failure as ApiError).error)).toBe('v1.1.0');
  });
});

describe('continuing a preparation this page did not make (#125)', () => {
  test('R7, H3: the stepper finds a stored preparation from the list and lands on the step its live read is at', async () => {
    const requests: string[] = [];
    const door: Parameters<typeof callOperation>[2] = async url => {
      requests.push(url);
      if (url === '/api/projects/tc-admin-qa-org/id_obs1948/preparations') return Response.json({ preparations: [stored('v1.1.0', 'health_checking'), stored('v1.0.0', 'full_release')], freshness: { read_at: '2026-10-08T10:01:00.000Z', source: 'live', age_seconds: 0 } });
      if (url === '/api/projects/tc-admin-qa-org/id_obs1948/preparations/v1.1.0') return Response.json(stored('v1.1.0', 'health_blocked', { health: { state: 'door43_unavailable', severity_raw: null, ref: 'temp-tca-release/v1.1.0', checked_at: '2026-10-08T10:01:00.000Z', issue_count: null, issues: null, source: 'door43' } }));
      return new Response('{}', { status: 404 });
    };
    const listed = await callOperation('preparation.list', { owner: 'tc-admin-qa-org', repo: 'id_obs1948' }, door);
    const [offer] = activePreparations(listed.preparations);
    expect(offer?.id).toBe('v1.1.0');
    const read = await callOperation('preparation.read', { owner: 'tc-admin-qa-org', repo: 'id_obs1948', preparation_id: offer!.id }, door);
    expect(stepOf(read)).toBe('Health check');
    expect(releaseGate(read)).toBe('blocked');
    expect(requests).toEqual(['/api/projects/tc-admin-qa-org/id_obs1948/preparations', '/api/projects/tc-admin-qa-org/id_obs1948/preparations/v1.1.0']);
  });

  test('R7: each state under way lands on its step: health, notes and release, or the restart', () => {
    expect(stepOf({ state: 'health_checking' })).toBe('Health check');
    expect(stepOf({ state: 'ready_for_release' })).toBe('Notes, version, and release');
    expect(stepOf({ state: 'retryable_failure' })).toBe('Notes, version, and release');
    expect(stepOf({ state: 'restart_required' })).toBe('Select books');
  });

  test('R6, R7: a retryable failure of a release attempt is tried again; one of the snapshot or of a discard can only be discarded', () => {
    const health = { state: 'healthy' as const, severity_raw: null, ref: null, checked_at: null, issue_count: null, issues: null, source: 'door43' as const };
    const failed = (code: OperationErrorShape['code']) => ({ state: 'retryable_failure' as const, health, requires_acknowledgement: false, last_error: { code } });
    expect(releaseGate(failed('release_failed'))).toBe('ready');
    expect(releaseGate(failed('release_outcome_unknown'))).toBe('ready');
    for (const code of ['commit_failed', 'preparation_active', 'door43_unavailable'] as const) {
      expect(releaseGate(failed(code)), code).toBe('blocked');
      expect(discardOnly(failed(code)), code).toBe(true);
      expect(canDiscard(failed(code))).toBe(true);
    }
    expect(discardOnly(failed('release_failed'))).toBe(false);
    expect(discardOnly({ state: 'ready_for_release', last_error: { code: 'commit_failed' } })).toBe(false);
  });
});
