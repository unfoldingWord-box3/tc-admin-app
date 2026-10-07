// The release stepper's logic (#41): the plan's defaults as the selection
// (R4), what a selection removes (R2), when a snapshot may be prepared, the
// step each preparation state is at, the release gate (H2, Q6), the version
// the manager types, and the route to the stepper.
import { catalogMessage } from '@tc-admin/shared/schema';
import type { Preparation } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { hashRef, releaseHash } from '../src/portfolio-labels';
import { RESTART_MESSAGE, STEPS, canDiscard, canPrepare, counts, releaseGate, removalsOf, selectionOf, statesFor, stepOf, versionToSend } from '../src/release-stepper';
import type { Book } from '../src/release-stepper';

const books: Book[] = [
  { id: 'mat', group: 'changed_released', selection: 'carry_forward' },
  { id: 'mrk', group: 'new', selection: 'leave_out' },
  { id: 'jhn', group: 'unchanged', selection: 'carry_forward' },
];
const plan = { preview: { books } };
const preparation = (state: Preparation['state'], requires = false): Pick<Preparation, 'state' | 'health' | 'requires_acknowledgement'> => ({
  state,
  requires_acknowledgement: requires,
  health: { state: requires ? 'warning' : 'healthy', severity_raw: null, ref: null, checked_at: null, issue_count: null, issues: null, source: 'door43' },
});

describe('the selection (product spec §10)', () => {
  test('R4: the plan selects the defaults; a released book carried forward, a new one left out; a new book cannot be carried forward', () => {
    expect(selectionOf(plan)).toEqual({ mat: 'carry_forward', mrk: 'leave_out', jhn: 'carry_forward' });
    expect(statesFor({ group: 'new' })).toEqual(['include', 'leave_out']);
    expect(statesFor({ group: 'changed_released' })).toEqual(['include', 'carry_forward', 'leave_out']);
    expect(counts(books, selectionOf(plan))).toEqual({ include: 0, carry_forward: 2, leave_out: 1 });
  });

  test('R2: only a released book left out is a removal, named; a new book left out is not', () => {
    expect(removalsOf(books, selectionOf(plan))).toEqual([]);
    expect(removalsOf(books, { ...selectionOf(plan), jhn: 'leave_out' })).toEqual(['jhn']);
    expect(removalsOf(books, { mat: 'leave_out', mrk: 'leave_out', jhn: 'leave_out' })).toEqual(['mat', 'jhn']);
  });

  test('R4: a release needs at least one book included or carried forward', () => {
    expect(canPrepare(books, selectionOf(plan))).toBe(true);
    expect(canPrepare(books, { mat: 'leave_out', mrk: 'leave_out', jhn: 'leave_out' })).toBe(false);
    expect(canPrepare(books, { mat: 'leave_out', mrk: 'include', jhn: 'leave_out' })).toBe(true);
  });

  test('a version the manager typed is sent with the v the catalog spells, trimmed; the calculated one, untouched, sends null', () => {
    expect(versionToSend('v1.3.0', 'v1.3.0')).toBeNull();
    expect(versionToSend('  ', 'v1.3.0')).toBeNull();
    expect(versionToSend(' 2.0.0 ', 'v1.3.0')).toBe('v2.0.0');
    expect(versionToSend('V2.0.0', 'v1.3.0')).toBe('v2.0.0');
  });
});

describe('the steps (domain model §6)', () => {
  test('every preparation state is at a step, and no preparation is the selection', () => {
    expect(STEPS).toHaveLength(5);
    expect(stepOf(null)).toBe('Select books');
    expect(stepOf({ state: 'snapshot_prepared' })).toBe('Review the snapshot');
    expect(stepOf({ state: 'health_checking' })).toBe('Health check');
    expect(stepOf({ state: 'health_blocked' })).toBe('Health check');
    expect(stepOf({ state: 'ready_for_release' })).toBe('Notes, version, and release');
    expect(stepOf({ state: 'retryable_failure' })).toBe('Notes, version, and release');
    expect(stepOf({ state: 'pre_release' })).toBe('Released');
    expect(stepOf({ state: 'full_release' })).toBe('Released');
    expect(stepOf({ state: 'restart_required' })).toBe('Select books');
    expect(stepOf({ state: 'discarded' })).toBe('Select books');
  });

  test('H2, Q6: the gate is ready on a passing health, asks for an acknowledgement on a warning, waits while checking, and blocks otherwise', () => {
    expect(releaseGate(preparation('ready_for_release'))).toBe('ready');
    expect(releaseGate(preparation('ready_for_release', true))).toBe('acknowledge');
    expect(releaseGate(preparation('retryable_failure'))).toBe('ready');
    expect(releaseGate(preparation('health_checking'))).toBe('checking');
    for (const state of ['health_blocked', 'snapshot_prepared', 'restart_required', 'pre_release', 'discarded'] as const) expect(releaseGate(preparation(state))).toBe('blocked');
  });

  test('R5: the restart message is the one the specification fixes', () => {
    expect(RESTART_MESSAGE).toBe(catalogMessage('source_changed'));
    expect(RESTART_MESSAGE).toBe('Project has been edited. The release process will need to restart.');
  });

  test('Q14: a preparation can be discarded until it is released', () => {
    for (const state of ['snapshot_prepared', 'health_checking', 'health_blocked', 'ready_for_release', 'retryable_failure', 'restart_required'] as const) expect(canDiscard({ state })).toBe(true);
    for (const state of ['pre_release', 'full_release', 'discarded'] as const) expect(canDiscard({ state })).toBe(false);
  });
});

describe('the route', () => {
  test('the stepper is the project hash with /release, and the project view is without', () => {
    const project = { ref: { owner: 'team a', repo: 'en/obs', id: 1, url: '' } };
    expect(releaseHash(project)).toBe('#/team%20a/en%2Fobs/release');
    expect(hashRef(releaseHash(project))).toEqual({ owner: 'team a', repo: 'en/obs', view: 'release' });
    expect(hashRef('#/team%20a/en%2Fobs')).toEqual({ owner: 'team a', repo: 'en/obs', view: 'project' });
    expect(hashRef('#/a/b/other')).toBeNull();
  });
});
