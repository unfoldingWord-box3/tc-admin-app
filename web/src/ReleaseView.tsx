// One release of a project by its tag (S7, R8): `release.lookup` says whether
// Door43 has it and which commit it targets; a pre-release can be promoted
// here with one edit of its flag, whether or not the page that created it is
// still open. Nothing else is written from this page.

import { useEffect, useState } from 'react';
import type { OperationOutput, ProjectSummary } from '@tc-admin/shared/schema';
import { ApiError, callOperation, failureMessage } from './api/client';
import { projectHash, releaseHash } from './portfolio-labels';

type Lookup = OperationOutput<'release.lookup'>;

interface Props {
  project: ProjectSummary;
  tag: string;
  onFailure: (failure: unknown) => void;
}

export function ReleaseView({ project, tag, onFailure }: Props) {
  const { owner, repo } = project.ref;
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [promoted, setPromoted] = useState<string[]>([]);

  const read = () =>
    callOperation('release.lookup', { owner, repo, tag }).then(
      found => {
        setLookup(found);
        setProblem(null);
      },
      (failure: unknown) => (failure instanceof ApiError && failure.error.code === 'session_expired' ? onFailure(failure) : setProblem(failureMessage(failure))),
    );

  useEffect(() => {
    void callOperation('release.lookup', { owner, repo, tag }).then(
      found => setLookup(found),
      (failure: unknown) => (failure instanceof ApiError && failure.error.code === 'session_expired' ? onFailure(failure) : setProblem(failureMessage(failure))),
    );
  }, [owner, repo, tag, onFailure]);

  const promote = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const receipt = await callOperation('release.promote', { owner, repo, tag });
      setPromoted(receipt.wrote.map(write => `${write.kind} ${write.target}`));
      setLookup({ found: true, release: { ...receipt.result, target_sha: lookup?.release?.target_sha ?? '' } });
    } catch (failure) {
      if (failure instanceof ApiError && failure.error.code === 'session_expired') onFailure(failure);
      else {
        setProblem(failureMessage(failure));
        // Door43 may have applied an edit whose answer was lost: the release is read again, and the button stays
        // disabled until that read settles, so nothing is sent twice (X1).
        await read();
      }
    } finally {
      setBusy(false);
    }
  };

  const release = lookup?.release ?? null;
  return (
    <section>
      <p>
        <a href={projectHash(project)}>{project.title}</a> · <a href={releaseHash(project)}>Prepare a release</a> · <a href="#">All projects</a>
      </p>
      <h2>
        Release {tag} of {project.title}
      </h2>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {!lookup && !problem && <p className="muted">Looking the release up on Door43…</p>}
      {lookup && !release && <p role="status">Door43 has no release under the tag {tag} for this project.</p>}
      {release && (
        <>
          <dl className="report">
            <dt>Tag</dt>
            <dd>{release.tag}</dd>
            <dt>Status</dt>
            <dd>{release.prerelease ? 'Pre-release' : 'Full release'}</dd>
            <dt>Commit</dt>
            <dd>
              <code>{release.target_sha ? release.target_sha.slice(0, 10) : 'not named'}</code>
            </dd>
            <dt>On Door43</dt>
            <dd>
              <a href={release.url} target="_blank" rel="noreferrer">
                {release.url}
              </a>
            </dd>
          </dl>
          {promoted.length > 0 && <p className="muted">Written: {promoted.join(' · ')}</p>}
          {release.prerelease && (
            <div className="actions">
              <button type="button" onClick={() => void promote()} disabled={busy}>
                Promote to a full release
              </button>
              <span className="muted">Promotion changes the pre-release flag only: not the version, not the contents.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
