// One project's report, from the portfolio's summary (`#/<owner>/<repo>`) or
// the report the creation receipt carries. Health is text, never color alone
// (H4), and unknown coverage reads as unknown (H3). The full project report
// (`project.read`) is #25. Opened from the portfolio, it lists the project's
// release preparations (`preparation.list`, #125): each under way with a link
// into the stepper at it and the discard, each released with a link to its
// release. "Add books" (or "Add stories") opens the upload screen in its
// place (#76); the upload's receipt carries the project report, which then
// replaces the one shown.

import type { Preparation, ProjectReport, ProjectSummary } from '@tc-admin/shared/schema';
import { useEffect, useState } from 'react';
import { ApiError, callOperation, failureMessage } from './api/client';
import { WRITE_LABELS } from './create-project';
import { coverageLabel, healthLabel, releaseHash, releaseTagHash, typeLabel } from './portfolio-labels';
import { isActive, preparationLink, preparationVersion, withAnswer } from './preparations';
import { STATE_LABELS, canDiscard } from './release-stepper';
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
      <h3>Release preparations</h3>
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

export function ProjectView({ project: given, onFailure }: Props) {
  const [tag, setTag] = useState('');
  const [uploading, setUploading] = useState(false);
  // The last upload's receipt and what it added: its project report replaces the one this view was given (#76).
  const [uploaded, setUploaded] = useState<{ receipt: UploadReceipt; added: string } | null>(null);
  const project: ProjectSummary | ProjectReport = uploaded?.receipt.result ?? given;
  const { coverage } = project;
  const type = uploadTypeOf(project.project_type);

  if (uploading && type) {
    return (
      <UploadScreen
        project={project}
        type={type}
        onFailure={onFailure}
        onCancel={() => setUploading(false)}
        onUploaded={(receipt, added) => {
          setUploaded({ receipt, added });
          setUploading(false);
        }}
      />
    );
  }

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
          <button type="button" onClick={() => setUploading(true)}>
            {addAction(type)}
          </button>
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
          <input id="release-tag" value={tag} onChange={event => setTag(event.target.value)} placeholder="v1.3.0" />
        </label>
        <button type="submit" className="secondary" disabled={!tag.trim()}>
          Open the release
        </button>
      </form>
      {/* Keyed by the project: another project mounts a fresh list in the same render, so none of the last project's rows, confirmation, or discard is offered under this one's name before its own list has arrived (#125). */}
      {onFailure && <Preparations key={`${project.ref.owner}/${project.ref.repo}`} project={project} onFailure={onFailure} />}
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
