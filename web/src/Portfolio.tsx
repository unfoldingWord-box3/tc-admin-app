// The portfolio (`portfolio.list`): the projects the manager can write,
// grouped by owner. By default only Scripture Burrito Bible and Open Bible
// Stories projects are listed, which Door43 filters quickly for an account
// with many repositories; "Show all projects" adds every unsupported writable
// repository with its reason (ADR 0014). An editable project opens; an
// unsupported one does not (P1). The open project is named in the address
// (`#/<owner>/<repo>`) so a reload keeps it, and `#/new` is the creation
// wizard (#28); a project it creates is listed at once, since
// Door43's catalog lists a new repository a few seconds later (E28, S1).
// A project the Worker refuses for permission from any view leaves the list
// at once (A2, #14), and its address says why; a reload reads the portfolio
// from Door43 again. "Refresh" reads the portfolio from Door43 again, and its
// age is labeled (P3, #26). Filters by organization, language, project type,
// and health, and the order within each owner group, apply in the browser over
// the list already read (#24).

import { useEffect, useRef, useState } from 'react';
import { catalogMessage } from '@tc-admin/shared/schema';
import type { HealthState, OperationOutput, ProjectSummary, ProjectType } from '@tc-admin/shared/schema';
import { ApiError, callOperation, failureMessage } from './api/client';
import { CreateProject } from './CreateProject';
import { CREATE_HASH, retireCreated, withCreated } from './create-project';
import { ProjectView } from './ProjectView';
import { ReleaseStepper } from './ReleaseStepper';
import { ReleaseView } from './ReleaseView';
import { freshnessLabel } from './freshness';
import { useNow } from './use-now';
import { SORT_LABELS, applyView, filterChoices, filtered, goneChoice, goneLabel, rememberView, rememberedView } from './portfolio-view';
import type { PortfolioView, SortOrder } from './portfolio-view';
import { ageLabel } from './freshness';
import { canOpen, coverageLabel, formatLabel, hashRef, healthLabel, projectHash, typeLabel } from './portfolio-labels';
import { onPermissionDenied, projectKey, withoutRevoked } from './revoked';

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
  // A refresh asked for and not yet answered: the list stays, labeled with its age, until the new one arrives (P3, #26).
  const [refreshing, setRefreshing] = useState(false);
  // A read again that failed while a list was shown: the list stays, and this says it was read earlier (P3, #26).
  const [readProblem, setReadProblem] = useState<string | null>(null);
  // The `show` whose list is on screen, if any.
  const listed = useRef<Show | null>(null);
  const now = useNow();
  // The filters and the order (#24); the order is remembered by this browser, the filters are not.
  const [view, setView] = useState<PortfolioView>(rememberedView);
  const changeView = (patch: Partial<PortfolioView>) =>
    setView(previous => {
      const next = { ...previous, ...patch };
      rememberView(next);
      return next;
    });
  // The projects the Worker refused for permission since this portfolio was opened: dropped from the list (A2, #14).
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());

  useEffect(
    () =>
      onPermissionDenied(project =>
        setRevoked(previous => {
          const key = projectKey(project);
          return previous.has(key) ? previous : new Set([...previous, key]);
        }),
      ),
    [],
  );

  useEffect(() => {
    let current = true;
    callOperation('portfolio.list', { show }).then(
      portfolio => {
        if (!current) return;
        listed.current = show;
        setRefreshing(false);
        setReadProblem(null);
        setResult({ show, portfolio });
        setCreated(previous => retireCreated(portfolio.organizations, previous));
      },
      failure => {
        if (!current) return;
        setRefreshing(false);
        const expired = failure instanceof ApiError && failure.error.code === 'session_expired';
        if (listed.current === show && !expired) setReadProblem(`${failureMessage(failure)} What is shown was read earlier.`);
        else onFailure(failure);
      },
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
  const organizations = withoutRevoked(withCreated(portfolio?.organizations ?? [], created, account.login), revoked);
  const projects = organizations.flatMap(group => group.projects);
  // The list as filtered and ordered; an address still opens any listed project, filtered out or not.
  const shown = applyView(organizations, view);
  const shownCount = shown.reduce((count, group) => count + group.projects.length, 0);
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
      {portfolio && wanted && revoked.has(projectKey(wanted)) && (
        <p role="alert">
          {catalogMessage('permission_denied')} {wanted.owner}/{wanted.repo} is no longer listed. Reload the page to read your projects from Door43 again.
        </p>
      )}
      {portfolio && wanted && !revoked.has(projectKey(wanted)) && <p role="alert">That project is not one you can open here. Choose a project from the list.</p>}
      {portfolio && projects.length === 0 && (
        <p>
          {show === 'all'
            ? 'You have no projects you can write to on this Door43 host.'
            : 'You have no Bible or Open Bible Stories projects in Scripture Burrito that you can write to on this Door43 host. Show all projects to see the others.'}
        </p>
      )}
      {portfolio && projects.length > 0 && <ViewControls groups={organizations} view={view} onChange={changeView} shown={shownCount} total={projects.length} />}
      {portfolio && projects.length > 0 && shownCount === 0 && (
        <p>
          No project matches these filters.{' '}
          <button type="button" className="secondary" onClick={() => changeView({ organization: null, language: null, project_type: null, health: null })}>
            Clear the filters
          </button>
        </p>
      )}
      {portfolio &&
        shown.map(group => (
          <section key={group.name} className="owner">
            <h2>{group.name}</h2>
            <ul className="projects">
              {group.projects.map(project => (
                <ProjectRow key={project.ref.id} project={project} now={now} />
              ))}
            </ul>
          </section>
        ))}
      {portfolio && (
        <p className="freshness actions">
          <span>{freshnessLabel(portfolio.freshness, now)}</span>
          <button
            type="button"
            className="secondary"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              setReadProblem(null);
              setReads(count => count + 1);
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </p>
      )}
      {portfolio && readProblem && (
        <p className="field-error" role="alert">
          {readProblem}
        </p>
      )}
    </>
  );
}

function ProjectRow({ project, now }: { project: ProjectSummary; now: number }) {
  const coverage = coverageLabel(project);
  const changed = project.last_activity_at ? `changed ${ageLabel(project.last_activity_at, now)}` : null;
  return (
    <li className={canOpen(project) ? 'project' : 'project unsupported'}>
      <div>
        <strong>{project.title}</strong> <span className="muted">{project.ref.repo}</span>
        <div className="facts">
          {[typeLabel(project.project_type), formatLabel(project.metadata_format), project.language.title || project.language.code, coverage, changed]
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

const ALL = '';

/** The filters and the order: each filter offers only what the list holds, and "All" clears it. */
function ViewControls({ groups, view, onChange, shown, total }: { groups: readonly { name: string; projects: ProjectSummary[] }[]; view: PortfolioView; onChange: (patch: Partial<PortfolioView>) => void; shown: number; total: number }) {
  const choices = filterChoices(groups);
  // A filter whose value a refresh took out of the list keeps showing it, marked, so the selector says what the list is filtered by.
  const gone = {
    organization: goneChoice(choices.organizations, view.organization),
    language: goneChoice(
      choices.languages.map(language => language.code),
      view.language,
    ),
    project_type: goneChoice(choices.project_types, view.project_type),
    health: goneChoice(choices.health, view.health),
  };
  return (
    <div className="toolbar filters" role="group" aria-label="Filter and order the projects">
      <label className="field">
        Organization
        <select value={view.organization ?? ALL} onChange={event => onChange({ organization: event.target.value || null })}>
          <option value={ALL}>All</option>
          {choices.organizations.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {gone.organization && <option value={gone.organization}>{goneLabel(gone.organization)}</option>}
        </select>
      </label>
      <label className="field">
        Language
        <select value={view.language ?? ALL} onChange={event => onChange({ language: event.target.value || null })}>
          <option value={ALL}>All</option>
          {choices.languages.map(language => (
            <option key={language.code} value={language.code}>
              {language.title === language.code ? language.code : `${language.title} (${language.code})`}
            </option>
          ))}
          {gone.language && <option value={gone.language}>{goneLabel(gone.language)}</option>}
        </select>
      </label>
      <label className="field">
        Project type
        <select value={view.project_type ?? ALL} onChange={event => onChange({ project_type: (event.target.value || null) as ProjectType | null })}>
          <option value={ALL}>All</option>
          {choices.project_types.map(type => (
            <option key={type} value={type}>
              {typeLabel(type)}
            </option>
          ))}
          {gone.project_type && <option value={gone.project_type}>{goneLabel(typeLabel(gone.project_type))}</option>}
        </select>
      </label>
      <label className="field">
        Health
        <select value={view.health ?? ALL} onChange={event => onChange({ health: (event.target.value || null) as HealthState | null })}>
          <option value={ALL}>All</option>
          {choices.health.map(state => (
            <option key={state} value={state}>
              {healthLabel(state)}
            </option>
          ))}
          {gone.health && <option value={gone.health}>{goneLabel(healthLabel(gone.health))}</option>}
        </select>
      </label>
      <label className="field">
        Order within each owner
        <select value={view.sort} onChange={event => onChange({ sort: event.target.value as SortOrder })}>
          {(Object.keys(SORT_LABELS) as SortOrder[]).map(order => (
            <option key={order} value={order}>
              {SORT_LABELS[order]}
            </option>
          ))}
        </select>
      </label>
      <span className="muted" role="status">
        {filtered(view) ? `Showing ${shown} of ${total} projects` : `${total} ${total === 1 ? 'project' : 'projects'}`}
      </span>
    </div>
  );
}
