// A project's health in full (#146): Door43's check of the default branch and
// of the latest full release's tag, each with its findings in the stepper's
// findings display (#124: severity as an icon and a word, H4; Door43's text as
// written, H1), framed as the project's state rather than a release's gate.
// A check that found nothing says so; one still running, one Door43 could not
// answer, or one tC Admin could not read says that, never healthy (H3).

import type { Health } from '@tc-admin/shared/schema';
import { HealthFindings, door43Origin } from './HealthFindings';
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

function HealthPart({ heading, health, origin }: { heading: string; health: Health; origin: string | null }) {
  const statement = healthStatement(health);
  const findings = health.issues ?? [];
  // Door43's own count heads the list, so a list shorter than the count never under-reports (bench round 1 on #147).
  const count = health.issue_count ?? findings.length;
  return (
    <section aria-label={heading}>
      <h4>
        {heading} · {healthLabel(health.state)}
        {count > 0 && ` · ${count} ${count === 1 ? 'finding' : 'findings'}`}
      </h4>
      {statement && <p className="muted">{statement}</p>}
      {findings.length > 0 && <HealthFindings issues={findings} gate="none" origin={origin} />}
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
  return (
    <section className="project-health" aria-label="Health check">
      <h3>Health check</h3>
      {/* Named by the branch: a receipt's health is of the commit it wrote, whose ref is a commit hash (bench round 1 on #147). */}
      <HealthPart heading={`Default branch, ${defaultBranch}`} health={health} origin={origin} />
      {release && releaseHealth && <HealthPart heading={`Latest release, ${release.tag}`} health={releaseHealth} origin={origin} />}
      {release && !releaseHealth && <p className="muted">The health check of the latest release, {release.tag}, was not read with this report. Refresh to read it.</p>}
      {!release && <p className="muted">No full release yet, so there is no release to check.</p>}
    </section>
  );
}
