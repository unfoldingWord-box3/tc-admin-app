// A project's health in full (#146): Door43's check of the default branch and
// of the latest full release's tag, each with its findings in the stepper's
// findings display (#124: severity as an icon and a word, H4; Door43's text as
// written, H1), framed as the project's state rather than a release's gate.
// A check that found nothing says so; one still running, one Door43 could not
// answer, or one tC Admin could not read says that, never healthy (H3).
// The section is closed when the view opens, so the page's actions stay near
// the top (#149); its closed line states each ref's health and count. Open,
// each ref's findings are grouped by check, one closed row per check, as
// Door43's own health check page shows them.

import type { Health } from '@tc-admin/shared/schema';
import { GroupedFindings, SeverityIcon, door43Origin } from './HealthFindings';
import { healthLabel } from './portfolio-labels';

/** What a health with no findings listed says, by its state. */
export function healthStatement(health: Pick<Health, 'state' | 'ref' | 'issues' | 'issue_count'>): string | null {
  const on = health.ref ? ` on ${health.ref}` : '';
  switch (health.state) {
    case 'checking':
      return `Door43 is still checking${on}. Refresh in a moment.`;
    case 'door43_unavailable':
      return `Door43 could not be asked for its health check${on}. Refresh later.`;
    case 'health_error':
      return `Door43's health check${on} answered something tC Admin cannot read.`;
    case 'never_checked':
      return `Door43 has not checked${on || ' this project'} yet.`;
    case 'unsupported':
      return null;
    default:
      // A result: "nothing to report" only when Door43 listed no finding and counted none; a result whose findings were not read says so.
      if (health.issues === null) return `Door43's findings${on} were not read with this report. Refresh to list them.`;
      return health.issues.length === 0 && health.issue_count === 0 ? `Door43's check found nothing to report${on}.` : null;
  }
}

/** Door43's verdicts as tones, worst first (#149). A healthy result has none, and a state that is no verdict of Door43's (still checking, unavailable, unreadable, never checked) has none either, so an unknown never takes a verdict's color (H3). */
const TONE_BY_STATE: Partial<Record<Health['state'], 'error' | 'warning' | 'info'>> = { failing: 'error', warning: 'warning', info: 'info' };
const TONE_RANK = ['error', 'warning', 'info'] as const;

/** The closed card's tone: the worst of the default branch's and the latest release's verdicts, or none (#149). */
export function overallTone(healths: readonly (Health | null)[]): 'error' | 'warning' | 'info' | null {
  const tones = healths.flatMap(health => (health && TONE_BY_STATE[health.state] ? [TONE_BY_STATE[health.state]!] : []));
  return TONE_RANK.find(tone => tones.includes(tone)) ?? null;
}

/** A ref's health in words: its state, and Door43's count of findings when there are any (H4). */
export function healthLine(health: Pick<Health, 'state' | 'issues' | 'issue_count'>): string {
  // Door43's own count, so a list shorter than the count never under-reports (bench round 1 on #147).
  const count = health.issue_count ?? health.issues?.length ?? 0;
  return `${healthLabel(health.state)}${count > 0 ? ` · ${count} ${count === 1 ? 'finding' : 'findings'}` : ''}`;
}

function HealthPart({ heading, health, origin }: { heading: string; health: Health; origin: string | null }) {
  const statement = healthStatement(health);
  return (
    <section aria-label={heading}>
      <h3>
        {heading} · {healthLine(health)}
      </h3>
      {statement && <p className="muted">{statement}</p>}
      <GroupedFindings issues={health.issues} origin={origin} />
    </section>
  );
}

interface Props {
  url: string;
  defaultBranch: string;
  health: Health;
  release: { tag: string } | null;
  releaseHealth: Health | null;
}

export function ProjectHealth({ url, defaultBranch, health, release, releaseHealth }: Props) {
  const origin = door43Origin(url);
  // Named by the branch: a receipt's health is of the commit it wrote, whose ref is a commit hash (bench round 1 on #147).
  const branchHeading = `Default branch, ${defaultBranch}`;
  const releaseHeading = release ? `Latest release, ${release.tag}` : null;
  // #149: the closed card takes the color of Door43's worst verdict, with its icon; the words beside it say the same (H4).
  const tone = overallTone([health, release ? releaseHealth : null]);
  return (
    <section className="project-health" aria-label="Health check">
      {/* Closed when the view opens (#149): the closed line says enough to decide whether to open it. */}
      <details>
        <summary data-severity={tone ?? undefined}>
          {/* The heading comes first in the summary, as HTML allows, and carries the icon (bench round 1 on #150). */}
          <h2>
            {tone && <SeverityIcon tone={tone} />}
            Health check
          </h2>
          <span className="health-overview">
            <span>
              {branchHeading} · {healthLine(health)}
            </span>
            {/* Read aloud, the two lines are two sentences, not one run-on (bench round 1 on #150). */}
            <span className="visually-hidden">. </span>
            {releaseHeading && <span>{releaseHealth ? `${releaseHeading} · ${healthLine(releaseHealth)}` : `${releaseHeading} · not in this report`}</span>}
            {!release && <span>No full release yet</span>}
          </span>
        </summary>
        <HealthPart heading={branchHeading} health={health} origin={origin} />
        {releaseHeading && releaseHealth && <HealthPart heading={releaseHeading} health={releaseHealth} origin={origin} />}
        {/* True whichever way it came: a receipt, which reads no release health, or a release answer naming another tag than the one checked (bench round 2 on #147). */}
        {release && !releaseHealth && <p className="muted">This report has no health check of the latest release, {release.tag}. Refresh to read it.</p>}
        {!release && <p className="muted">No full release yet, so there is no release to check.</p>}
      </details>
    </section>
  );
}
