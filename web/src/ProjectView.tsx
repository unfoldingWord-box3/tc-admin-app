// One project's report, from the portfolio's summary (`#/<owner>/<repo>`) or
// the report the creation receipt carries. Health is text, never color alone
// (H4), and unknown coverage reads as unknown (H3). Once the full report is
// read, the findings of the default branch and of the latest full release are
// listed (#146, `ProjectHealth`). The full project report
// (`project.read`) is #25. Opened from the portfolio, it lists the project's
// release preparations (`preparation.list`, #125): each under way with a link
// into the stepper at it and the discard, each released with a link to its
// release. "Add books" (or "Add stories") opens the upload screen in its
// place (#76), and "Import books" (or "Import stories") the import screen
// (#81); either receipt carries the project report, which then replaces the
// one shown.

import type { Preparation, ProjectReport, ProjectSummary } from '@tc-admin/shared/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, callOperation, failureMessage } from './api/client';
import { WRITE_LABELS } from './create-project';
import { freshnessLabel } from './freshness';
import { ProjectHealth } from './ProjectHealth';
import { withKnownClassification } from './known-report';
import { useNow } from './use-now';
import { coverageLabel, healthLabel, releaseHash, releaseTagHash, typeLabel } from './portfolio-labels';
import { isActive, preparationLink, preparationVersion, withAnswer } from './preparations';
import { STATE_LABELS, canDiscard } from './release-stepper';
import { ImportScreen } from './ImportScreen';
import { importAction } from './import';
import { UploadScreen } from './UploadScreen';
import { addAction, uploadTypeOf } from './upload';
import type { UploadReceipt } from './upload';

interface Props {
  project: ProjectSummary;
  /** Given, the project's preparations are listed; a session Door43 no longer accepts goes to the shell. */
  onFailure?: (failure: unknown) => void;
}

const expired = (failure: unknown) => failure instanceof ApiError && failure.error.code === 'session_expired';

/** The project's release preparations, newest first, each to open; one under way can be discarded after a confirmation (Q14). */
function Preparations({ project, onFailure }: { project: ProjectSummary; onFailure: (failure: unknown) => void }) {
  const { owner, repo } = project.ref;
  const [preparations, setPreparations] = useState<Preparation[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    callOperation('preparation.list', { owner, repo }).then(
      listed => current && setPreparations(listed.preparations),
      (failure: unknown) => {
        if (!current) return;
        if (expired(failure)) onFailure(failure);
        else setProblem(failureMessage(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [owner, repo, onFailure]);

  const discard = async (id: string) => {
    setBusy(true);
    setProblem(null);
    setConfirming(null);
    try {
      const receipt = await callOperation('preparation.discard', { owner, repo, preparation_id: id });
      // The answer replaces the listed one: the list is not read again, since Workers KV lists eventually.
      setPreparations(current => withAnswer(current ?? [], receipt.result));
    } catch (failure) {
      if (expired(failure)) onFailure(failure);
      else setProblem(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const underWay = preparations?.some(isActive) ?? false;
  return (
    <section aria-label="Release preparations">
      <h2>Release preparations</h2>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {!preparations && !problem && <p className="muted">Reading the release preparations…</p>}
      {preparations && !underWay && <p className="muted">No release is being prepared.</p>}
      {preparations && preparations.length > 0 && (
        <ul aria-label="Release preparations of this project">
          {preparations.map(preparation => {
            const link = preparationLink(project, preparation);
            return (
              <li key={preparation.id} className="actions">
                <span>
                  Version {preparationVersion(preparation)} · {STATE_LABELS[preparation.state]}
                  {preparation.history.at(-1) && <span className="muted"> · last changed {new Date(preparation.history.at(-1)!.at).toLocaleString()}</span>}
                </span>
                {link && <a href={link}>{isActive(preparation) ? 'Continue the preparation' : 'Open the release'}</a>}
                {canDiscard(preparation) &&
                  (confirming === preparation.id ? (
                    <>
                      <span>Discard this preparation? The temporary branch is deleted; the default branch is untouched.</span>
                      <button type="button" onClick={() => void discard(preparation.id)} disabled={busy}>
                        Discard the preparation
                      </button>
                      <button type="button" className="secondary" onClick={() => setConfirming(null)}>
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button type="button" className="secondary" onClick={() => setConfirming(preparation.id)} disabled={busy}>
                      Discard the preparation
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      {preparations && <p className="muted">A preparation made a moment ago may not be listed yet.</p>}
    </section>
  );
}

/** Whether files can be added to the project now: a Bible or Open Bible Stories project that is editable, and whose setup is complete when the report says. */
function uploadable(project: ProjectSummary | ProjectReport): boolean {
  if (project.editability.state !== 'editable' || !uploadTypeOf(project.project_type)) return false;
  return !('setup' in project) || project.setup.state === 'complete';
}

/** The heading of the project's books or stories (#158). */
export const unitsHeading = (type: 'bible' | 'obs'): string => (type === 'bible' ? 'Books in this project' : 'Stories in this project');

export function ProjectView({ project: given, onFailure }: Props) {
  const { owner, repo } = given.ref;
  const [tag, setTag] = useState('');
  const [adding, setAdding] = useState<'upload' | 'import' | null>(null);
  // The last upload's or import's receipt and what it added: its project report replaces the one this view was given (#76, #81).
  const [uploaded, setUploaded] = useState<{ receipt: UploadReceipt; added: string } | null>(null);
  // The project as last read or written: the view's summary at first, then the full report `project.read` answers, a receipt's, or a refresh's (#26).
  const [current, setCurrent] = useState<ProjectSummary | ProjectReport>(given);
  const [reading, setReading] = useState<'read' | 'refresh' | null>('read');
  const [readProblem, setReadProblem] = useState<string | null>(null);
  // Door43's catalog had not read the project at the last read: the known classification was kept, and the view says so.
  const [catalogPending, setCatalogPending] = useState(false);
  // The project this view's state belongs to: another project given to the same view starts afresh, in this render, so nothing of the last one is shown under its name.
  const givenKey = `${owner.toLowerCase()}/${repo}`;
  const [shownFor, setShownFor] = useState({ key: givenKey, given });
  // Bumped when another project, or a newer report of the same one (a retried creation's receipt, #31), is given: it is read again, and an earlier read's answer is not shown.
  const [opened, setOpened] = useState(0);
  if (shownFor.given !== given) {
    if (shownFor.key !== givenKey) setUploaded(null);
    setShownFor({ key: givenKey, given });
    setOpened(count => count + 1);
    setCurrent(given);
    setReading('read');
    setReadProblem(null);
    setCatalogPending(false);
  }
  // Bumped by every read and write: an answer for an earlier one, or for another project, is stale and is not shown.
  const ticket = useRef(0);
  // The report shown, for a read's answer to compare with what the view already knew.
  const shownRef = useRef<ProjectSummary | ProjectReport>(current);
  useEffect(() => {
    shownRef.current = current;
  }, [current]);
  const now = useNow();
  const project = current;
  const { coverage } = project;
  const type = uploadTypeOf(project.project_type);

  /**
   * The full report, read live (`project.read` on opening, `project.refresh` on request), settled for the read `mine`
   * only; a failure keeps what is shown and says so.
   */
  const settle = useCallback(
    (mine: number) => ({
      report: (report: ProjectReport) => {
        if (mine !== ticket.current) return;
        // A read made before Door43's catalog has read the project keeps the classification the view already knew (E28, E45).
        const merged = withKnownClassification(shownRef.current, report);
        setCurrent(merged.report);
        setCatalogPending(merged.catalogPending);
        setReading(null);
      },
      failure: (failure: unknown) => {
        if (mine !== ticket.current) return;
        setReading(null);
        if (expired(failure) && onFailure) onFailure(failure);
        else setReadProblem(`${failureMessage(failure)} What is shown was read earlier.`);
      },
    }),
    [onFailure],
  );
  useEffect(() => {
    const handlers = settle(++ticket.current);
    callOperation('project.read', { owner, repo }).then(handlers.report, handlers.failure);
  }, [owner, repo, settle, opened]);
  const refresh = () => {
    const handlers = settle(++ticket.current);
    setReading('refresh');
    setReadProblem(null);
    callOperation('project.refresh', { owner, repo }).then(handlers.report, handlers.failure);
  };

  const done = (receipt: UploadReceipt, added: string) => {
    ++ticket.current;
    setReading(null);
    // The receipt's report is newer than any read that failed before it.
    setReadProblem(null);
    setUploaded({ receipt, added });
    setCurrent(receipt.result);
    setAdding(null);
  };
  if (adding === 'upload' && type) {
    return <UploadScreen project={project} type={type} onFailure={onFailure} onCancel={() => setAdding(null)} onUploaded={done} />;
  }
  if (adding === 'import' && type) {
    return <ImportScreen project={project} type={type} onFailure={onFailure} onCancel={() => setAdding(null)} onImported={done} />;
  }

  return (
    <section>
      <p>
        <a href="#">All projects</a>
      </p>
      <h1>{project.title}</h1>
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
        <dd>
          {healthLabel(project.health.state)}
          {project.health.issue_count !== null && project.health.issue_count > 0 && ` · ${project.health.issue_count} ${project.health.issue_count === 1 ? 'finding' : 'findings'}`}
          {project.health.ref && <span className="muted"> · on {project.health.ref}</span>}
        </dd>
        {'latest_full_release' in project && (
          <>
            <dt>Latest release</dt>
            <dd>
              {/* The latest full release opens on its own page, as a release opened by its tag does (#156). */}
              {project.latest_full_release ? (
                <>
                  <span>{project.latest_full_release.tag}</span> · <a href={releaseTagHash(project, project.latest_full_release.tag)}>Open the release</a>
                </>
              ) : (
                'None yet'
              )}
            </dd>
          </>
        )}
      </dl>
      <p className="freshness actions">
        <span>{'freshness' in project ? freshnessLabel(project.freshness, now) : 'Read with the portfolio.'}</span>
        <button type="button" className="secondary" onClick={refresh} disabled={reading !== null}>
          {reading === 'refresh' ? 'Refreshing…' : 'Refresh'}
        </button>
      </p>
      {reading === 'read' && <p className="muted" role="status">Reading the project from Door43…</p>}
      {'freshness' in project && 'latest_full_release' in project && (
        // Keyed by the project, so another project's view opens with its health check closed (#149). The key is unlike the
        // release preparations' beside it: two siblings with one key made React add a health section at every render.
        <ProjectHealth key={`health:${project.ref.owner}/${project.ref.repo}`} url={project.ref.url} defaultBranch={project.default_branch} health={project.health} release={project.latest_full_release} releaseHealth={project.release_health} />
      )}
      {catalogPending && (
        <p className="muted" role="status">
          Door43's catalog has not read this project's latest change yet; its type and coverage are shown as tC Admin wrote them. Refresh in a moment for Door43's reading.
        </p>
      )}
      {readProblem && (
        <p className="field-error" role="alert">
          {readProblem}
        </p>
      )}
      {uploaded && (
        <div className="upload-receipt" role="status">
          <p>
            <strong>{uploaded.added} in one commit.</strong>
          </p>
          {uploaded.receipt.wrote.map(write => (
            <p key={`${write.kind}:${write.target}`} className="muted">
              Written: {WRITE_LABELS[write.kind]} <code>{write.target}</code>
              {write.sha && (
                <>
                  {' '}
                  · <code>{write.sha.slice(0, 8)}</code>
                </>
              )}
            </p>
          ))}
          {uploaded.receipt.warnings.map((warning, index) => (
            <p key={`${warning.code}-${index}`}>{warning.message}</p>
          ))}
        </div>
      )}
      <p className="actions">
        {type && uploadable(project) && (
          <>
            <button type="button" onClick={() => setAdding('upload')}>
              {addAction(type)}
            </button>
            <button type="button" className="secondary" onClick={() => setAdding('import')}>
              {importAction(type)}
            </button>
          </>
        )}
        <a className="button" href={releaseHash(project)}>
          Prepare a release
        </a>
      </p>
      <form
        className="actions"
        onSubmit={event => {
          event.preventDefault();
          if (tag.trim()) window.location.assign(releaseTagHash(project, tag.trim()));
        }}
      >
        <label className="field" htmlFor="release-tag">
          A release by its tag, to see it or promote a pre-release
          {/* No remembered entries: a browser offered tags typed for other projects, none of them this one's (Rich, #161). */}
          <input id="release-tag" value={tag} onChange={event => setTag(event.target.value)} placeholder="v1.3.0" autoComplete="off" />
        </label>
        <button type="submit" className="secondary" disabled={!tag.trim()}>
          Open the release
        </button>
      </form>
      {/* Keyed by the project: another project mounts a fresh list in the same render, so none of the last project's rows, confirmation, or discard is offered under this one's name before its own list has arrived (#125). */}
      {onFailure && <Preparations key={`${project.ref.owner}/${project.ref.repo}`} project={project} onFailure={onFailure} />}
      {/* The project's books or stories, a section of their own after the preparations (#158); coverage Door43 does not itemize reads as unknown, never as none (H5). */}
      {type && (
        <section aria-label={unitsHeading(type)}>
          <h2>{unitsHeading(type)}</h2>
          {coverage.units.length > 0 ? (
            <ul className="units" aria-label={`${type === 'bible' ? 'Books' : 'Stories'} in scope`}>
              {coverage.units.map(unit => (
                <li key={unit.id} className={unit.present ? 'present' : 'absent'}>
                  {unit.id.toUpperCase()} <span className="muted">{unit.present ? 'present' : 'not present'}</span>
                </li>
              ))}
            </ul>
          ) : coverage.present === null ? (
            // Unknown only when Door43 gives no count: a catalog that lists ingredients but no book counts 0, which is known (bench round 1 on #159).
            <p className="muted">Door43's catalog does not list this project's {type === 'bible' ? 'books' : 'stories'}, so which are present is not known.</p>
          ) : (
            <p className="muted">No {type === 'bible' ? 'books' : 'stories'} are in this project yet.</p>
          )}
        </section>
      )}
    </section>
  );
}
