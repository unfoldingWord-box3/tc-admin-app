// The portfolio (`portfolio.list`): every project the manager can write,
// grouped by owner. An editable project opens; an unsupported one is listed
// with its reason and does not (P1). The open project is named in the address
// (`#/<owner>/<repo>`) so a reload keeps it. Filters and sorting are #24,
// refresh is #26, and the full project report (`project.read`) is #25.

import { useEffect, useState } from 'react';
import type { OperationOutput, ProjectSummary } from '@tc-admin/shared/schema';
import { callOperation } from './api/client';
import { canOpen, coverageLabel, formatLabel, hashRef, healthLabel, projectHash, typeLabel } from './portfolio-labels';

type PortfolioList = OperationOutput<'portfolio.list'>;

interface Props {
  /** Shows a failure; a `session_expired` failure also ends the signed-in view. */
  onFailure: (failure: unknown) => void;
}

export function Portfolio({ onFailure }: Props) {
  const [portfolio, setPortfolio] = useState<PortfolioList | null>(null);
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    callOperation('portfolio.list', {}).then(setPortfolio, onFailure);
  }, [onFailure]);

  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  if (!portfolio) return <p>Loading your projects…</p>;

  const projects = portfolio.organizations.flatMap(group => group.projects);
  const wanted = hashRef(hash);
  const open = wanted && projects.find(project => project.ref.owner === wanted.owner && project.ref.repo === wanted.repo && canOpen(project));
  if (open) return <ProjectView project={open} />;

  if (projects.length === 0) {
    return <p>You have no projects you can write to on this Door43 host.</p>;
  }
  return (
    <>
      {wanted && <p role="alert">That project is not one you can open here. Choose a project from the list.</p>}
      {portfolio.organizations.map(group => (
        <section key={group.name} className="owner">
          <h2>{group.name}</h2>
          <ul className="projects">
            {group.projects.map(project => (
              <ProjectRow key={project.ref.id} project={project} />
            ))}
          </ul>
        </section>
      ))}
      <p className="freshness">Read from Door43 at {new Date(portfolio.freshness.read_at).toLocaleTimeString()}.</p>
    </>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const coverage = coverageLabel(project);
  return (
    <li className={canOpen(project) ? 'project' : 'project unsupported'}>
      <div>
        <strong>{project.title}</strong> <span className="muted">{project.ref.repo}</span>
        <div className="facts">
          {[typeLabel(project.project_type), formatLabel(project.metadata_format), project.language.title || project.language.code, coverage]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {canOpen(project) ? (
          <div className="facts">Health: {healthLabel(project.health.state)}</div>
        ) : (
          <div className="reason">
            <span className="badge">Unsupported</span> {project.editability.reason}
          </div>
        )}
      </div>
      {canOpen(project) && (
        <a className="button" href={projectHash(project)}>
          Open project
        </a>
      )}
    </li>
  );
}

function ProjectView({ project }: { project: ProjectSummary }) {
  const { coverage } = project;
  return (
    <section>
      <p>
        <a href="#">All projects</a>
      </p>
      <h2>{project.title}</h2>
      <p className="muted">
        {project.ref.owner}/{project.ref.repo} ·{' '}
        <a href={project.ref.url} target="_blank" rel="noreferrer">
          View on Door43
        </a>
      </p>
      <dl className="report">
        <dt>Project type</dt>
        <dd>{typeLabel(project.project_type)}</dd>
        <dt>Language</dt>
        <dd>{[project.language.title, project.language.code].filter(Boolean).join(' · ') || 'Not stated'}</dd>
        <dt>Coverage</dt>
        <dd>{coverageLabel(project)}</dd>
        <dt>Health</dt>
        <dd>{healthLabel(project.health.state)}</dd>
      </dl>
      {coverage.units.length > 0 && (
        <ul className="units" aria-label="Books and stories in scope">
          {coverage.units.map(unit => (
            <li key={unit.id} className={unit.present ? 'present' : 'absent'}>
              {unit.id.toUpperCase()} <span className="muted">{unit.present ? 'present' : 'not present'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
