// The portfolio (`portfolio.list`): the projects the manager can write,
// grouped by owner. By default only Scripture Burrito Bible and Open Bible
// Stories projects are listed, which Door43 filters quickly for an account
// with many repositories; "Show all projects" adds every unsupported writable
// repository with its reason (ADR 0014). An editable project opens; an
// unsupported one does not (P1). The open project is named in the address
// (`#/<owner>/<repo>`) so a reload keeps it. Filters and sorting are #24,
// refresh is #26, and the full project report (`project.read`) is #25.

import { useEffect, useState } from 'react';
import type { OperationOutput, ProjectSummary } from '@tc-admin/shared/schema';
import { callOperation } from './api/client';
import { canOpen, coverageLabel, formatLabel, hashRef, healthLabel, projectHash, typeLabel } from './portfolio-labels';

type PortfolioList = OperationOutput<'portfolio.list'>;
type Show = 'supported' | 'all';

interface Props {
  /** Shows a failure; a `session_expired` failure also ends the signed-in view. */
  onFailure: (failure: unknown) => void;
}

export function Portfolio({ onFailure }: Props) {
  const [show, setShow] = useState<Show>('supported');
  // The portfolio with the `show` it was read for; a different `show` is still loading.
  const [result, setResult] = useState<{ show: Show; portfolio: PortfolioList } | null>(null);
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    let current = true;
    callOperation('portfolio.list', { show }).then(
      portfolio => current && setResult({ show, portfolio }),
      failure => current && onFailure(failure),
    );
    return () => {
      current = false;
    };
  }, [show, onFailure]);

  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const portfolio = result?.show === show ? result.portfolio : null;
  const projects = portfolio?.organizations.flatMap(group => group.projects) ?? [];
  const wanted = hashRef(hash);
  const open = wanted && projects.find(project => project.ref.owner === wanted.owner && project.ref.repo === wanted.repo && canOpen(project));
  if (open) return <ProjectView project={open} />;

  return (
    <>
      <label className="show-all">
        <input type="checkbox" checked={show === 'all'} onChange={event => setShow(event.target.checked ? 'all' : 'supported')} /> Show all projects,
        including unsupported ones
      </label>
      {!portfolio && <p>Loading your projects…</p>}
      {portfolio && wanted && <p role="alert">That project is not one you can open here. Choose a project from the list.</p>}
      {portfolio && projects.length === 0 && (
        <p>
          {show === 'all'
            ? 'You have no projects you can write to on this Door43 host.'
            : 'You have no Bible or Open Bible Stories projects in Scripture Burrito that you can write to on this Door43 host. Show all projects to see the others.'}
        </p>
      )}
      {portfolio?.organizations.map(group => (
        <section key={group.name} className="owner">
          <h2>{group.name}</h2>
          <ul className="projects">
            {group.projects.map(project => (
              <ProjectRow key={project.ref.id} project={project} />
            ))}
          </ul>
        </section>
      ))}
      {portfolio && <p className="freshness">Read from Door43 at {new Date(portfolio.freshness.read_at).toLocaleTimeString()}.</p>}
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
