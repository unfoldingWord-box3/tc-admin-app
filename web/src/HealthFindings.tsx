// Door43's health-check issues for one preparation (#124): a summary when the
// release is blocked or waits for the manager's confirmation (H2), then each
// issue as a row with its severity badge, Door43's title, details, and
// suggestion, errors first. Every severity is an icon and a word as well as a
// color (H4). Door43's text is shown as Door43 wrote it, with its bold, code,
// and links rendered (H1); it is never inserted as HTML.

import type { ReactNode } from 'react';
import type { HealthIssue } from '@tc-admin/shared/schema';
import { door43Tokens } from './door43-text';
import type { Door43Token } from './door43-text';
import { findingsSummary, groupedIssues, orderedIssues, severityBadge } from './health-findings';
import type { FindingsGate } from './health-findings';

interface Props {
  issues: readonly HealthIssue[] | null;
  gate: FindingsGate;
  /** The Door43 host's origin, such as `https://qa.door43.org`, that Door43's links are relative to; `null` shows them as text. */
  origin: string | null;
  /** An action beside the summary, such as "Check again". */
  children?: ReactNode;
}

/** The Door43 host of a project, from its address on Door43 (`project.ref.url`); `null` if that does not parse. */
export function door43Origin(projectUrl: string): string | null {
  try {
    return new URL(projectUrl).origin;
  } catch {
    return null;
  }
}

export function HealthFindings({ issues, gate, origin, children }: Props) {
  const listed = orderedIssues(issues ?? []);
  const summary = findingsSummary(listed, gate);
  if (!summary && listed.length === 0) return null;
  return (
    <div className="health-findings">
      {summary && (
        <div className="health-summary" data-severity={summary.tone}>
          <SeverityIcon tone={summary.tone} />
          <strong role="status">{summary.text}</strong>
          {children}
        </div>
      )}
      {listed.length > 0 && (
        <ul className="findings" aria-label="Health check findings">
          {listed.map((issue, index) => {
            const badge = severityBadge(issue.severity);
            return (
              <li key={`${issue.code}-${index}`} className="finding" data-severity={badge.tone}>
                <p className="finding-head">
                  <span className="severity-badge">
                    <SeverityIcon tone={badge.tone} />
                    {badge.word}
                  </span>
                  <strong>{issue.title}</strong>
                </p>
                {issue.details && (
                  <p className="finding-details">
                    <Door43Text text={issue.details} origin={origin} />
                  </p>
                )}
                {issue.suggestion && (
                  <p className="finding-suggestion">
                    <span className="finding-label">Suggestion · </span>
                    <Door43Text text={issue.suggestion} origin={origin} />
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The findings grouped by check (#149), as Door43's health check page shows them: one closed row per check with its
 * severity badge (an icon and a word, H4), Door43's title, and how many findings it has; opening a row lists each
 * finding's details and suggestion as Door43 wrote them (H1). Nothing is shown for no findings.
 */
export function GroupedFindings({ issues, origin }: { issues: readonly HealthIssue[] | null; origin: string | null }) {
  const groups = groupedIssues(issues ?? []);
  if (groups.length === 0) return null;
  return (
    <ul className="findings finding-groups" aria-label="Health check findings by check">
      {groups.map(group => {
        const badge = severityBadge(group.severity);
        const n = group.issues.length;
        return (
          <li key={`${group.severity}\u0000${group.code}`} className="finding-group" data-severity={badge.tone}>
            <details>
              <summary>
                <span className="severity-badge">
                  <SeverityIcon tone={badge.tone} />
                  {badge.word}
                </span>
                <strong>{group.title}</strong>
                <span className="finding-count">
                  {' '}
                  · {n} {n === 1 ? 'finding' : 'findings'}
                </span>
              </summary>
              <ul className="findings" aria-label={group.title}>
                {group.issues.map((issue, index) => (
                  <li key={index} className="finding" data-severity={badge.tone}>
                    {issue.title !== group.title && (
                      <p>
                        <strong>{issue.title}</strong>
                      </p>
                    )}
                    {issue.details && (
                      <p className="finding-details">
                        <Door43Text text={issue.details} origin={origin} />
                      </p>
                    )}
                    {issue.suggestion && (
                      <p className="finding-suggestion">
                        <span className="finding-label">Suggestion · </span>
                        <Door43Text text={issue.suggestion} origin={origin} />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** Door43's text, its bold, code, and links as elements; everything else as text. */
export function Door43Text({ text, origin }: { text: string; origin: string | null }) {
  return <>{nodes(door43Tokens(text, origin))}</>;
}

function nodes(tokens: Door43Token[]): ReactNode[] {
  return tokens.map((token, index) => {
    switch (token.kind) {
      case 'text':
        return token.text;
      case 'code':
        return <code key={index}>{token.text}</code>;
      case 'bold':
        return <strong key={index}>{nodes(token.children)}</strong>;
      case 'link':
        return (
          <a key={index} href={token.href} target="_blank" rel="noopener noreferrer">
            {nodes(token.children)}
          </a>
        );
    }
  });
}

/** One shape per severity, so the badge differs by more than color (H4): an octagon for an error, a triangle for a warning, a circle for information. The word beside it carries the meaning. */
export function SeverityIcon({ tone }: { tone: 'error' | 'warning' | 'info' | 'other' }) {
  return (
    <svg className="severity-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {tone === 'error' && (
        <>
          <path className="shape" d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2z" />
          <path className="mark-line" d="M8 4.4v4.4" />
          <circle className="mark" cx="8" cy="11.5" r="1.1" />
        </>
      )}
      {tone === 'warning' && (
        <>
          <path className="shape" d="M8 1.2 15.2 14.4H.8z" />
          <path className="mark-line" d="M8 5.8v3.8" />
          <circle className="mark" cx="8" cy="12" r="1" />
        </>
      )}
      {tone === 'info' && (
        <>
          <circle className="shape" cx="8" cy="8" r="7" />
          <circle className="mark" cx="8" cy="4.8" r="1.1" />
          <path className="mark-line" d="M8 7.4v4.4" />
        </>
      )}
      {tone === 'other' && <circle className="shape" cx="8" cy="8" r="6" />}
    </svg>
  );
}
