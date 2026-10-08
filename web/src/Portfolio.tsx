// The portfolio (`portfolio.list`): the projects the manager can write,
// grouped by owner. By default only Scripture Burrito Bible and Open Bible
// Stories projects are listed, which Door43 filters quickly for an account
// with many repositories; "Show all projects" adds every unsupported writable
// repository with its reason (ADR 0014). An editable project opens; an
// unsupported one does not (P1). The open project is named in the address
// (`#/<owner>/<repo>`) so a reload keeps it, and `#/new` is the creation
// wizard (#28); a project it creates is listed at once, since
// Door43's catalog lists a new repository a few seconds later (E28, S1).
// Filters and sorting are #24, refresh is #26, and the full project report
// (`project.read`) is #25.

import { useEffect, useState } from 'react';
import type { OperationOutput, ProjectSummary } from '@tc-admin/shared/schema';
import { callOperation } from './api/client';
import { CreateProject } from './CreateProject';
import { CREATE_HASH, retireCreated, withCreated } from './create-project';
import { ProjectView } from './ProjectView';
import { ReleaseStepper } from './ReleaseStepper';
import { ReleaseView } from './ReleaseView';
import { canOpen, coverageLabel, formatLabel, hashRef, healthLabel, projectHash, typeLabel } from './portfolio-labels';

type PortfolioList = OperationOutput<'portfolio.list'>;
type Show = 'supported' | 'all';

interface Props {
  account: { login: string; name: string };
  /** Shows a failure; a `session_expired` failure also ends the signed-in view. */
  onFailure: (failure: unknown) => void;
}

export function Portfolio({ account, onFailure }: Props) {
  const [show, setShow] = useState<Show>('supported');
  // The portfolio with the `show` it was read for; a different `show` is still loading.
  const [result, setResult] = useState<{ show: Show; portfolio: PortfolioList } | null>(null);
  const [hash, setHash] = useState(() => window.location.hash);
  // A project created in this view, listed until a read of Door43's catalog lists it (then retired, so a later read rules); a creation also reads the portfolio again.
  const [created, setCreated] = useState<ProjectSummary | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let current = true;
    callOperation('portfolio.list', { show }).then(
      portfolio => {
        if (!current) return;
        setResult({ show, portfolio });
        setCreated(previous => retireCreated(portfolio.organizations, previous));
      },
      failure => current && onFailure(failure),
    );
    return () => {
      current = false;
    };
  }, [show, onFailure, reads]);

  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const portfolio = result?.show === show ? result.portfolio : null;
  const organizations = withCreated(portfolio?.organizations ?? [], created, account.login);
  const projects = organizations.flatMap(group => group.projects);
  const wanted = hashRef(hash);
  const open = wanted && projects.find(project => project.ref.owner === wanted.owner && project.ref.repo === wanted.repo && canOpen(project));
  // Keyed by the release's identity: a change of tag mounts a fresh page, so no lookup, alert, or late answer of another release survives it.
  if (open && wanted.view === 'tag') return <ReleaseView key={`${open.ref.owner}/${open.ref.repo}/${wanted.tag}`} project={open} tag={wanted.tag} onFailure={onFailure} />;
  // The stepper, or the stepper at one preparation (#125): keyed by the preparation the address named when it opened, so another one opens fresh,
  // while the stepper's own address updates (which replace the address without a hashchange) keep it mounted.
  if (open && (wanted.view === 'release' || wanted.view === 'preparation')) {
    const preparation = wanted.view === 'preparation' ? wanted.preparation : null;
    return <ReleaseStepper key={`${open.ref.owner}/${open.ref.repo}/${preparation ?? ''}`} project={open} preparationId={preparation} onFailure={onFailure} />;
  }
  // Keyed by the project: another project mounts a fresh view, so no listed preparation, confirmation, or discard of the last one survives it (#125).
  if (open) return <ProjectView key={`${open.ref.owner}/${open.ref.repo}`} project={open} onFailure={onFailure} />;

  if (hash === CREATE_HASH) {
    if (!portfolio) return <p>Loading your projects…</p>;
    return (
      <CreateProject
        account={account.login}
        onCreated={project => {
          setCreated(project);
          setReads(count => count + 1);
        }}
        onFailure={onFailure}
      />
    );
  }

  return (
    <>
      <div className="toolbar">
        <label className="show-all">
          <input type="checkbox" checked={show === 'all'} onChange={event => setShow(event.target.checked ? 'all' : 'supported')} /> Show all projects,
          including unsupported ones
        </label>
        <a className="button" href={CREATE_HASH}>
          Create a project
        </a>
      </div>
      {!portfolio && <p>Loading your projects…</p>}
      {portfolio && wanted && <p role="alert">That project is not one you can open here. Choose a project from the list.</p>}
      {portfolio && projects.length === 0 && (
        <p>
          {show === 'all'
            ? 'You have no projects you can write to on this Door43 host.'
            : 'You have no Bible or Open Bible Stories projects in Scripture Burrito that you can write to on this Door43 host. Show all projects to see the others.'}
        </p>
      )}
      {portfolio &&
        organizations.map(group => (
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
