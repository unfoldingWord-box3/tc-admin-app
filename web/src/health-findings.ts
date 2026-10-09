// How Door43's health-check issues read on the page (#124): each issue's
// severity as a word (H4: an icon and a word, never color alone), the issues
// in severity order, and the summary above them when the release is blocked
// or needs the manager's confirmation (H2). Door43 decides the severity and
// the words (H1): an issue is never moved to another severity, and a
// severity outside Door43's vocabulary is shown as Door43 wrote it.

import type { HealthIssue, OperationErrorShape, Preparation } from '@tc-admin/shared/schema';
import { releaseGate } from './release-stepper';

/** Door43's issue severities (`severity_level`, E15, E60), in the order the page lists them. */
export const SEVERITIES = ['error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

const SEVERITY_WORDS: Readonly<Record<Severity, string>> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Information',
};

const known = (severity: string): severity is Severity => (SEVERITIES as readonly string[]).includes(severity);

/** The badge for an issue's severity: its style, and the word shown beside the icon. A severity Door43 has not been seen to use keeps its own word and a neutral style. */
export function severityBadge(severity: string): { tone: Severity | 'other'; word: string } {
  return known(severity) ? { tone: severity, word: SEVERITY_WORDS[severity] } : { tone: 'other', word: severity || 'No severity' };
}

/** Errors, then warnings, then information, then anything else; Door43's order within each. */
export function orderedIssues(issues: readonly HealthIssue[]): HealthIssue[] {
  const rank = (severity: string) => (known(severity) ? SEVERITIES.indexOf(severity) : SEVERITIES.length);
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => rank(a.issue.severity) - rank(b.issue.severity) || a.index - b.index)
    .map(entry => entry.issue);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Where the release stands because of health, as the stepper's release gate
 * says: `blocked` while the preparation is `health_blocked`, `acknowledge`
 * while a warning waits for the manager's confirmation (H2), else `none`.
 */
export type FindingsGate = 'blocked' | 'acknowledge' | 'none';

/** The findings' gate for a preparation: blocked by health, waiting for the confirmation of its warnings, or neither (H2). */
export function findingsGate(preparation: Pick<Preparation, 'state' | 'health' | 'requires_acknowledgement'> & { last_error?: Pick<OperationErrorShape, 'code'> | null }): FindingsGate {
  if (preparation.state === 'health_blocked') return 'blocked';
  return releaseGate(preparation) === 'acknowledge' ? 'acknowledge' : 'none';
}

/**
 * The line above the issues, or `null` when the release is neither blocked nor
 * waiting for a confirmation. It counts Door43's errors and warnings; a release
 * blocked with no error listed (Door43 unavailable, a health-check error) says
 * it is blocked until the check passes.
 */
export function findingsSummary(issues: readonly HealthIssue[], gate: FindingsGate): { tone: 'error' | 'warning'; text: string } | null {
  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;
  if (gate === 'blocked') {
    if (errors === 0) return { tone: 'error', text: "Release blocked until Door43's health check passes" };
    const text = `Release blocked: ${count(errors, 'error', 'errors')} from Door43's health check`;
    return { tone: 'error', text: warnings > 0 ? `${text} · ${count(warnings, 'warning', 'warnings')}` : text };
  }
  if (gate === 'acknowledge') {
    const what = warnings > 0 ? count(warnings, 'warning', 'warnings') : 'Warnings';
    return { tone: 'warning', text: `${what} from Door43's health check: confirm below before releasing` };
  }
  return null;
}

/** One check's findings, as one row (#149): Door43's check (`code`), its severity, its title, and each finding it reported. */
export interface FindingGroup {
  code: string;
  severity: string;
  /** Door43's title of the check's first finding; a finding whose own title differs shows it beside its details. */
  title: string;
  issues: HealthIssue[];
}

/**
 * The findings grouped by check, as Door43's health check page groups them: one group per `code` and severity, so no
 * finding is moved to another severity (H1); errors first, then warnings, then information, then anything else. Within a
 * severity the groups go by title: Door43 answers its checks as a map whose order is not the same from one answer to the
 * next (observed on QA, 8 October 2026), so a page read twice keeps its rows in place. Findings keep Door43's order.
 */
export function groupedIssues(issues: readonly HealthIssue[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const issue of orderedIssues(issues)) {
    const key = `${issue.severity}\u0000${issue.code}`;
    const group = groups.get(key);
    if (group) group.issues.push(issue);
    else groups.set(key, { code: issue.code, severity: issue.severity, title: issue.title, issues: [issue] });
  }
  const rank = (severity: string) => (known(severity) ? SEVERITIES.indexOf(severity) : SEVERITIES.length);
  return [...groups.values()].sort((a, b) => rank(a.severity) - rank(b.severity) || a.title.localeCompare(b.title) || a.code.localeCompare(b.code));
}
