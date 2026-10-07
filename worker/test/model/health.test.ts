// Door43 severity to health state; the prototype's health tests, carried over
// (#7), and the mapping of one health-check read (#25, #36): every observed
// severity (E15, E28) and every absent or failed read, pure, with no judgement
// of tC Admin's own (H1), and never healthy without a success result (H3).
import { HEALTH_STATES } from '@tc-admin/shared/schema';
import type { HealthIssue } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { healthFromSeverity, healthOfRead, releasable } from '../../src/model/health';
import type { HealthRead } from '../../src/model/health';

describe('health from the Door43 severity (E15)', () => {
  test('H1: each Door43 severity maps to its own state, and an error is failing', () => {
    expect(['success', 'info', 'warning', 'error'].map(healthFromSeverity)).toEqual(['healthy', 'info', 'warning', 'failing']);
  });

  test('H3: a missing or unknown severity is never_checked, never healthy', () => {
    for (const severity of [null, undefined, '', 'unknown', 'SUCCESS']) expect(healthFromSeverity(severity)).toBe('never_checked');
  });

  test('every mapped value is a health state identifier', () => {
    for (const severity of ['success', 'info', 'warning', 'error', null]) expect(HEALTH_STATES).toContain(healthFromSeverity(severity));
  });
});

describe('health of one health-check read (#25, #36)', () => {
  const AT = '2026-10-07T15:00:00.000Z';
  const REF = 'temp-tca-release/v1.3.0';
  const issue: HealthIssue = { code: 'sb_ingredient_mismatch', rule: 'META-015', severity: 'warning', title: 'Ingredient sizes or checksums do not match the files in the repo', details: 'd', suggestion: 's' };

  test('H1: every observed severity maps as the catalog severity does, with the issues and their count, the ref, and the time', () => {
    const read = (severity: string, issues: HealthIssue[] = []): HealthRead => ({ kind: 'result', severity, issues });
    expect(healthOfRead(read('success'), REF, AT)).toEqual({ state: 'healthy', severity_raw: 'success', ref: REF, checked_at: AT, issue_count: 0, issues: [], source: 'door43' });
    expect(healthOfRead(read('info', [{ ...issue, code: 'release_needed', severity: 'info' }]), REF, AT)).toMatchObject({ state: 'info', severity_raw: 'info', issue_count: 1 });
    expect(healthOfRead(read('warning', [issue]), REF, AT)).toMatchObject({ state: 'warning', severity_raw: 'warning', issue_count: 1, issues: [issue] });
    expect(healthOfRead(read('error', [issue, { ...issue, severity: 'error' }]), REF, AT)).toMatchObject({ state: 'failing', severity_raw: 'error', issue_count: 2 });
  });

  test('H1, H3: a severity outside the vocabulary is health_error with the raw value kept, never a guess', () => {
    expect(healthOfRead({ kind: 'result', severity: 'critical', issues: [] }, REF, AT)).toMatchObject({ state: 'health_error', severity_raw: 'critical', issue_count: 0 });
    expect(healthOfRead({ kind: 'result', severity: 'SUCCESS', issues: [] }, REF, AT).state).toBe('health_error');
  });

  test('H3: a pending, unavailable, or failed read is checking, door43_unavailable, or health_error, each with the ref and time and no severity', () => {
    const reads: [HealthRead, string][] = [
      [{ kind: 'pending' }, 'checking'],
      [{ kind: 'unavailable', reason: 'Door43 answered 503' }, 'door43_unavailable'],
      [{ kind: 'error', reason: 'the health check answer was not JSON', status: 200 }, 'health_error'],
    ];
    for (const [read, state] of reads) expect(healthOfRead(read, REF, AT)).toEqual({ state, severity_raw: null, ref: REF, checked_at: AT, issue_count: null, issues: null, source: 'door43' });
  });

  test('H3: no read but a success result is healthy', () => {
    const reads: HealthRead[] = [
      { kind: 'pending' },
      { kind: 'unavailable', reason: 'x' },
      { kind: 'error', reason: 'x', status: null },
      ...['info', 'warning', 'error', 'unknown', ''].map((severity): HealthRead => ({ kind: 'result', severity, issues: [] })),
    ];
    for (const read of reads) expect(healthOfRead(read, REF, AT).state).not.toBe('healthy');
    expect(healthOfRead({ kind: 'result', severity: 'success', issues: [] }, REF, AT).state).toBe('healthy');
  });

  test('H2: healthy, info, and warning let a preparation go on; every other state blocks', () => {
    expect(HEALTH_STATES.filter(releasable)).toEqual(['healthy', 'info', 'warning']);
  });
});
