// Door43's health check to a health state (domain model §5, E15, Q21). A
// pure mapping: Door43 decides the result (H1), and nothing short of a
// Door43 success result is `healthy` (H3). `healthFromSeverity` is the
// catalog's severity field, as a project summary carries it (#19);
// `healthOfRead` is one read of the health-check endpoint for a ref (#25,
// #36), in the adapter's words, never Door43's field names.
//
// `unsupported` is in the vocabulary for a project whose format the check
// does not cover; no Door43 answer has been observed that means it (E15
// lists a rule set per format), so nothing maps to it yet.

import type { Health, HealthIssue, HealthState } from '@tc-admin/shared/schema';

const STATE_BY_SEVERITY: Readonly<Record<string, HealthState>> = {
  success: 'healthy',
  info: 'info',
  warning: 'warning',
  error: 'failing',
};

export function healthFromSeverity(severity: string | null | undefined): HealthState {
  return (severity && STATE_BY_SEVERITY[severity]) || 'never_checked';
}

/** One read of the health check for a ref, as the adapter reports it. */
export type HealthRead =
  /** Door43 answered with a result: its overall severity and every issue it listed (E15). */
  | { kind: 'result'; severity: string; issues: HealthIssue[] }
  /** Door43 has no result for the ref yet (the 422 "no metadata found", E15, E28): the check has not run. */
  | { kind: 'pending' }
  /** Door43 could not be reached, or answered as unavailable. */
  | { kind: 'unavailable'; reason: string }
  /** Door43 answered something tC Admin cannot take as a result. */
  | { kind: 'error'; reason: string; status: number | null };

/**
 * The health value of one read (H1): a result's severity maps as the catalog's
 * does, and a severity outside the vocabulary is `health_error`, never a guess;
 * a pending check is `checking`; a failed read is `door43_unavailable` or
 * `health_error`. Nothing but a `success` result is `healthy` (H3). Every value
 * carries the ref and the time of the read.
 */
export function healthOfRead(read: HealthRead, ref: string, checkedAt: string): Health {
  const base = { ref, checked_at: checkedAt, source: 'door43' as const };
  switch (read.kind) {
    case 'result': {
      const state = STATE_BY_SEVERITY[read.severity] ?? 'health_error';
      return { ...base, state, severity_raw: read.severity, issue_count: read.issues.length, issues: read.issues };
    }
    case 'pending':
      return { ...base, state: 'checking', severity_raw: null, issue_count: null, issues: null };
    case 'unavailable':
      return { ...base, state: 'door43_unavailable', severity_raw: null, issue_count: null, issues: null };
    case 'error':
      return { ...base, state: 'health_error', severity_raw: null, issue_count: null, issues: null };
  }
}

/** Whether a health state lets a preparation go on to release creation (H2): `warning` does, with the manager's acknowledgement. */
export const releasable = (state: HealthState): boolean => state === 'healthy' || state === 'info' || state === 'warning';
