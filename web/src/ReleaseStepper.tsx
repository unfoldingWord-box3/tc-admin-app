// The release stepper (product spec §10, #41): one operation per step, nothing
// written before the manager prepares the snapshot, and the preparation shown
// as Door43 and the Worker report it. Health is text, never color alone (H4);
// a warning asks for the manager's confirmation (H2, Q6); a project edited
// during preparation restarts from the selection with the fixed message (R5);
// an unreleased preparation can be discarded after a confirmation (Q14).
// When it opens, the project's preparations still under way are listed
// (`preparation.list`), each to continue or discard before planning anew, and
// a preparation's own address (`#/<owner>/<repo>/release/<version>`) opens it
// directly, so a reload or a new sign-in lands back on it (#125). The
// preparation this page made is held from its receipt, never from the list,
// which Workers KV keeps eventually.

import { useCallback, useEffect, useRef, useState } from 'react';
import { HEALTH_POLL } from '@tc-admin/shared/schema';
import type { Preparation, ProjectSummary, SelectionState } from '@tc-admin/shared/schema';
import { ApiError, callOperation, failureMessage } from './api/client';
import { WRITE_LABELS } from './create-project';
import { HealthFindings, door43Origin } from './HealthFindings';
import { findingsGate } from './health-findings';
import { healthLabel, projectHash, releaseHash, releaseTagHash } from './portfolio-labels';
import { activePreparations, activeSummary, preparationHash, refusedFor, withAnswer } from './preparations';
import {
  GROUP_LABELS,
  RESTART_MESSAGE,
  SELECTION_LABELS,
  SELECTION_MEANINGS,
  STATE_LABELS,
  STEPS,
  canDiscard,
  canPrepare,
  counts,
  discardOnly,
  releaseGate,
  removalsOf,
  selectionOf,
  selectionToSend,
  spellVersion,
  statesFor,
  stepOf,
  storySummary,
  versionToSend,
} from './release-stepper';
import type { ReleasePlan, Selection } from './release-stepper';

interface Props {
  project: ProjectSummary;
  /** The preparation the address names (`#/<owner>/<repo>/release/<version>`), opened in place of a new plan. */
  preparationId?: string | null;
  /** A session Door43 no longer accepts: the shell reads the situation again. */
  onFailure: (failure: unknown) => void;
}

const expired = (failure: unknown) => failure instanceof ApiError && failure.error.code === 'session_expired';
const codeOf = (failure: unknown) => (failure instanceof ApiError ? failure.error.code : null);

/**
 * Keyed by the project and the preparation the address named, so another one mounts a fresh stepper in the same render: no plan,
 * offer, confirmation, or discard of the last project is offered under this one's name, and no late answer for it is shown (#125).
 */
export function ReleaseStepper(props: Props) {
  const { owner, repo } = props.project.ref;
  return <Stepper key={`${owner}/${repo}/${props.preparationId ?? ''}`} {...props} />;
}

function Stepper({ project, preparationId = null, onFailure }: Props) {
  const { owner, repo } = project.ref;
  const [plan, setPlan] = useState<ReleasePlan | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [version, setVersion] = useState('');
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [notes, setNotes] = useState('');
  const [prerelease, setPrerelease] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [restart, setRestart] = useState(false);
  const [written, setWritten] = useState<string[]>([]);
  // The project's preparations still under way when the stepper opened (`preparation.list`); `null` until read.
  const [offers, setOffers] = useState<Preparation[] | null>(null);
  const [offersProblem, setOffersProblem] = useState<string | null>(null);
  const [confirmingOffer, setConfirmingOffer] = useState<string | null>(null);
  // The preparation a `preparation_active` refusal named, to continue.
  const [refused, setRefused] = useState<string | null>(null);
  const initialId = useRef(preparationId);
  // Bumped by every discard, re-plan, and write: a `preparation.read` that answers after one is stale and is not shown.
  const generation = useRef(0);

  const fail = useCallback(
    (failure: unknown) => {
      if (expired(failure)) return onFailure(failure);
      if (codeOf(failure) === 'source_changed') {
        setRestart(true);
        setProblem(RESTART_MESSAGE);
        return;
      }
      setProblem(failureMessage(failure));
    },
    [onFailure],
  );

  // Step 1: the plan, which writes nothing (ADR 0011). State changes only once Door43 has answered.
  // A notice, such as why the plan was read again, stays up once the new plan is shown.
  // A plan that answers after a later action started (Continue, a discard, a write) is stale and is not shown: it must not
  // clear the preparation that action opened, nor move the address off it (#125).
  const readPlan = useCallback(
    (notice: string | null = null) => {
      const ticket = generation.current;
      return callOperation('release.plan', { owner, repo }).then(
        planned => {
          if (ticket !== generation.current) return;
          generation.current += 1;
          setPlan(planned);
          setSelection(selectionOf(planned));
          setVersion(planned.preview.version.proposed);
          setNotes(planned.preview.notes_draft);
          setPreparation(null);
          setPrerelease(false);
          setAcknowledged(false);
          setWritten([]);
          setRestart(false);
          setProblem(notice);
        },
        (failure: unknown) => {
          if (ticket === generation.current) fail(failure);
        },
      );
    },
    [owner, repo, fail],
  );

  // The preparations already under way, from the store by project; a failure to read them leaves planning anew as it is.
  const readOffers = useCallback(
    () =>
      callOperation('preparation.list', { owner, repo }).then(
        listed => {
          setOffers(activePreparations(listed.preparations));
          setOffersProblem(null);
        },
        (failure: unknown) => {
          if (expired(failure)) return onFailure(failure);
          setOffersProblem(failureMessage(failure));
        },
      ),
    [owner, repo, onFailure],
  );

  // Continue a preparation this page did not make: read it live (R5, H1) and land on its step. One discarded or not found plans anew.
  const open = useCallback(
    async (id: string) => {
      generation.current += 1;
      const ticket = generation.current;
      setBusy('Opening the preparation…');
      setProblem(null);
      setRefused(null);
      setConfirmingOffer(null);
      try {
        const current = await callOperation('preparation.read', { owner, repo, preparation_id: id });
        if (ticket !== generation.current) return;
        // The new plan is awaited, so the buttons stay disabled until it is shown.
        if (current.state === 'discarded') {
          await readPlan(`The preparation of version ${id} was discarded. Prepare a new release below.`);
          return;
        }
        setPreparation(current);
        setNotes(current.notes.confirmed ?? current.notes.draft);
        setVersion(current.version.confirmed ?? current.version.proposed);
        setPrerelease(false);
        setAcknowledged(false);
        setWritten([]);
        setRestart(current.state === 'restart_required');
        setProblem(current.state === 'restart_required' ? RESTART_MESSAGE : null);
      } catch (failure) {
        if (ticket !== generation.current) return;
        if (expired(failure)) return onFailure(failure);
        await readPlan(failureMessage(failure));
      } finally {
        setBusy(null);
      }
    },
    [owner, repo, onFailure, readPlan],
  );

  useEffect(() => {
    void readOffers();
    if (initialId.current) void open(initialId.current);
    else void readPlan();
  }, [readOffers, open, readPlan]);

  // The address follows the preparation, so a reload lands back on it; without one it is the stepper's.
  useEffect(() => {
    if (!preparation && !plan) return;
    const target = preparation && preparation.state !== 'discarded' ? preparationHash(project, preparation.id) : releaseHash(project);
    if (window.location.hash !== target) window.history.replaceState(null, '', target);
  }, [preparation, plan, project]);

  // A preparation listed when the stepper opened, discarded from there after the inline confirmation.
  const discardOffer = async (id: string) => {
    setBusy('Discarding the preparation…');
    setProblem(null);
    setConfirmingOffer(null);
    try {
      const receipt = await callOperation('preparation.discard', { owner, repo, preparation_id: id });
      setOffers(current => activePreparations(withAnswer(current ?? [], receipt.result)));
      if (refused === id) setRefused(null);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(null);
    }
  };

  // R5: the preparation a source change invalidated is discarded first, so its temporary branch does not block the next one; if the discard fails, the preparation stays and Start again can be tried again.
  const startAgain = async () => {
    generation.current += 1;
    if (preparation && canDiscard(preparation)) {
      setBusy('Discarding the preparation…');
      setProblem(null);
      try {
        const receipt = await callOperation('preparation.discard', { owner, repo, preparation_id: preparation.id });
        setOffers(current => (current ? activePreparations(withAnswer(current, receipt.result)) : current));
      } catch (failure) {
        fail(failure);
        setRestart(true);
        return;
      } finally {
        setBusy(null);
      }
    }
    setPlan(null);
    setPreparation(null);
    setRestart(false);
    setProblem(null);
    void readPlan();
  };

  // Step 3: the health of the temporary branch, read every HEALTH_POLL.interval_ms for HEALTH_POLL.window_ms after the push, then on refresh.
  const read = useCallback(
    async (id: string) => {
      const ticket = generation.current;
      try {
        const current = await callOperation('preparation.read', { owner, repo, preparation_id: id });
        if (ticket !== generation.current) return null;
        setPreparation(current);
        // A health read again may carry other warnings: the acknowledgement is asked for again (H2).
        setAcknowledged(false);
        if (current.state === 'restart_required') {
          setRestart(true);
          setProblem(RESTART_MESSAGE);
        }
        return current;
      } catch (failure) {
        if (ticket === generation.current) fail(failure);
        return null;
      }
    },
    [owner, repo, fail],
  );

  useEffect(() => {
    if (!preparation || preparation.state !== 'health_checking') return;
    const pushedAt = preparation.history.find(entry => entry.to === 'health_checking')?.at;
    // No push time, or one that does not parse, counts as the window elapsed: Refresh stays.
    const since = pushedAt ? Date.now() - new Date(pushedAt).getTime() : Number.NaN;
    if (!(since <= HEALTH_POLL.window_ms)) return;
    const timer = window.setTimeout(() => void read(preparation.id), HEALTH_POLL.interval_ms);
    return () => window.clearTimeout(timer);
  }, [preparation, read]);

  // Step 2: the snapshot, the first write.
  const prepare = async () => {
    if (!plan) return;
    setBusy('Preparing the snapshot on Door43…');
    setProblem(null);
    setRefused(null);
    generation.current += 1;
    try {
      const receipt = await callOperation('release.prepare', { owner, repo, plan_id: plan.id, selection: selectionToSend(project.project_type, selection), unknown_included: [], version: versionToSend(version, plan.preview.version.proposed) });
      setWritten(receipt.wrote.map(write => `${WRITE_LABELS[write.kind]} ${write.target}`));
      setPreparation(receipt.result);
      setAcknowledged(false);
      setNotes(receipt.result.notes.draft);
      setVersion(receipt.result.version.confirmed ?? receipt.result.version.proposed);
    } catch (failure) {
      if (codeOf(failure) === 'plan_expired') {
        setProblem('The plan expired. The selection is read again.');
        setPlan(null);
        void readPlan('The plan expired. The selection was read again: check it before preparing.');
      } else {
        // The refusal names the preparation already under way, to continue it (#125).
        setRefused(failure instanceof ApiError ? refusedFor(failure.error) : null);
        fail(failure);
      }
    } finally {
      setBusy(null);
    }
  };

  // Steps 4 to 7: notes, version, pre-release, the release.
  const create = async () => {
    if (!preparation) return;
    setBusy('Creating the release on Door43…');
    setProblem(null);
    generation.current += 1;
    try {
      const receipt = await callOperation('release.create', { owner, repo, preparation_id: preparation.id, version: spellVersion(version), notes, prerelease, acknowledge_warnings: acknowledged });
      setWritten(current => [...current, ...receipt.wrote.map(write => `${WRITE_LABELS[write.kind]} ${write.target}`), ...receipt.warnings.map(warning => warning.message)]);
      setPreparation(receipt.result);
    } catch (failure) {
      if (codeOf(failure) === 'release_outcome_unknown' || codeOf(failure) === 'release_failed' || codeOf(failure) === 'release_exists') void read(preparation.id);
      fail(failure);
    } finally {
      setBusy(null);
    }
  };

  // Step 8: promotion, one edit of the pre-release flag (R8).
  const promote = async () => {
    if (!preparation?.release) return;
    setBusy('Promoting the pre-release…');
    setProblem(null);
    generation.current += 1;
    const id = preparation.id;
    const tag = preparation.release.tag;
    try {
      const receipt = await callOperation('release.promote', { owner, repo, tag });
      setPreparation(current => (current?.id === id && current.release?.tag === tag ?{ ...current, state: 'full_release', release: receipt.result } : current));
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!preparation) return;
    setBusy('Discarding the preparation…');
    setProblem(null);
    setConfirmingDiscard(false);
    generation.current += 1;
    try {
      const receipt = await callOperation('preparation.discard', { owner, repo, preparation_id: preparation.id });
      setOffers(current => (current ? activePreparations(withAnswer(current, receipt.result)) : current));
      await readPlan();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(null);
    }
  };

  const step = stepOf(preparation);
  const stepIndex = STEPS.indexOf(step);
  const books = plan?.preview.books ?? [];
  const removals = removalsOf(books, selection);
  const tally = counts(books, selection);
  const stories = storySummary(books);
  const gate = preparation ? releaseGate(preparation) : 'blocked';

  return (
    <section className="stepper">
      <p>
        <a href={projectHash(project)}>{project.title}</a> · <a href="#">All projects</a>
      </p>
      <h2>Release {project.title}</h2>
      <ol className="steps" aria-label="Release steps">
        {STEPS.map((name, index) => (
          <li key={name} className={index === stepIndex ? 'current' : index < stepIndex ? 'done' : ''} aria-current={index === stepIndex ? 'step' : undefined}>
            {name}
          </li>
        ))}
      </ol>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      {/* The refusal's own way in, only when the preparations listed below do not already offer it. */}
      {refused && !preparation && !(offers ?? []).some(offer => offer.id === refused) && (
        <p className="actions">
          <span>Version {refused} is being prepared.</span>
          <button type="button" onClick={() => void open(refused)} disabled={busy !== null}>
            Continue the preparation
          </button>
        </p>
      )}
      {!preparation && !restart && offers && offers.length > 0 && (
        <section aria-label="Release preparations under way">
          {offers.map(offer => (
            <div key={offer.id} className="actions">
              <span>{activeSummary(offer)}</span>
              <button type="button" onClick={() => void open(offer.id)} disabled={busy !== null}>
                Continue the preparation
              </button>
              {confirmingOffer === offer.id ? (
                <>
                  <span>Discard this preparation? The temporary branch is deleted; the default branch is untouched.</span>
                  <button type="button" onClick={() => void discardOffer(offer.id)} disabled={busy !== null}>
                    Discard the preparation
                  </button>
                  <button type="button" className="secondary" onClick={() => setConfirmingOffer(null)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="secondary" onClick={() => setConfirmingOffer(offer.id)} disabled={busy !== null}>
                  Discard the preparation
                </button>
              )}
            </div>
          ))}
          <p className="muted">Or prepare a new release below.</p>
        </section>
      )}
      {offersProblem && !preparation && <p className="muted">The preparations already under way could not be read: {offersProblem}</p>}
      {restart && (
        <p className="actions">
          <button type="button" onClick={() => void startAgain()} disabled={busy !== null}>
            Start again from the selection
          </button>
        </p>
      )}
      {busy && <p className="muted">{busy}</p>}
      {!plan && !preparation && !problem && !busy && <p className="muted">Comparing the default branch with the last release…</p>}

      {step === 'Select books' && plan && !restart && (
        <>
          {project.project_type === 'obs' ? (
            <>
              <p>An Open Bible Stories release takes the whole default branch: every story, no selection.</p>
              <p className="derived">
                {plan.preview.version.baseline_tag ? `Compared with the last full release, ${plan.preview.version.baseline_tag}.` : 'No release yet.'} {stories.count}
              </p>
              {stories.removed && <p role="status">{stories.removed}</p>}
            </>
          ) : (
            <>
              <p className="derived">
                {plan.preview.version.baseline_tag ? `Compared with the last full release, ${plan.preview.version.baseline_tag}.` : 'No release yet: every book is included.'}{' '}
                {tally.include} included · {tally.carry_forward} carried forward · {tally.leave_out} left out
              </p>
              <table className="files selection">
                <thead>
                  <tr>
                    <th scope="col">Book</th>
                    <th scope="col">Since the last release</th>
                    <th scope="col">In this release</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map(book => (
                    <tr key={book.id}>
                      <th scope="row">{book.id.toUpperCase()}</th>
                      <td>{GROUP_LABELS[book.group]}</td>
                      <td>
                        {statesFor(book).map(state => (
                          <label key={state} className="choice inline">
                            <input type="radio" name={`selection-${book.id}`} value={state} checked={(selection[book.id] ?? book.selection) === state} onChange={() => setSelection(current => ({ ...current, [book.id]: state as SelectionState }))} />{' '}
                            {SELECTION_LABELS[state]}
                          </label>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="report meanings">
                {(['include', 'carry_forward', 'leave_out'] as const).map(state => (
                  <div key={state}>
                    <dt>{SELECTION_LABELS[state]}</dt>
                    <dd>{SELECTION_MEANINGS[state]}</dd>
                  </div>
                ))}
              </dl>
              {removals.length > 0 && (
                <p role="status">
                  Removed from this release onward: {removals.map(id => id.toUpperCase()).join(', ')}. Earlier releases keep them. The version must then increase its first number.
                </p>
              )}
              {plan.preview.administrative.length > 0 && <p className="muted">Taken from the default branch with every release: {plan.preview.administrative.join(', ')}.</p>}
            </>
          )}
          <label className="field" htmlFor="release-version">
            Version
            <input id="release-version" value={version} onChange={event => setVersion(event.target.value)} />
          </label>
          <p className="derived">Calculated: {plan.preview.version.proposed}. The version must be after {plan.preview.version.baseline_tag ?? 'none'} and can be edited.</p>
          <p className="muted">Nothing is written until the snapshot is prepared: then a branch {`temp-tca-release/<version>`} and its commits, never the default branch.</p>
          <div className="actions">
            <button type="button" onClick={() => void prepare()} disabled={busy !== null || !canPrepare(books, selection)}>
              Prepare the snapshot
            </button>
            {!canPrepare(books, selection) && <span className="field-error">A release needs at least one book included or carried forward.</span>}
          </div>
        </>
      )}

      {preparation && step !== 'Select books' && (
        <>
          <dl className="report">
            <dt>Preparation</dt>
            <dd>
              {STATE_LABELS[preparation.state]} · version {preparation.version.confirmed ?? preparation.version.proposed}
            </dd>
            <dt>Snapshot</dt>
            <dd>
              {preparation.snapshot ? (
                <>
                  branch <code>{preparation.snapshot.branch}</code> at <code>{preparation.snapshot.commit_sha.slice(0, 10)}</code>
                </>
              ) : (
                'not prepared'
              )}
            </dd>
            <dt>Health</dt>
            <dd>
              {healthLabel(preparation.health.state)}
              {preparation.health.checked_at && <span className="muted"> · read {new Date(preparation.health.checked_at).toLocaleTimeString()}</span>}
            </dd>
          </dl>
          {written.length > 0 && <p className="muted">Written: {written.join(' · ')}</p>}
          {preparation.snapshot && preparation.snapshot.files.length > 0 && (
            <details>
              <summary>{preparation.snapshot.files.length} files in the snapshot</summary>
              <table className="files">
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">From</th>
                  </tr>
                </thead>
                <tbody>
                  {preparation.snapshot.files.map(file => (
                    <tr key={file.path}>
                      <td>{file.path}</td>
                      <td>{file.source === 'tag' ? 'the previous release' : 'the default branch'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <HealthFindings issues={preparation.health.issues} gate={findingsGate(preparation)} origin={door43Origin(project.ref.url)}>
            {preparation.state === 'health_blocked' && (
              <button type="button" className="secondary" onClick={() => void read(preparation.id)} disabled={busy !== null}>
                Check again
              </button>
            )}
          </HealthFindings>
          {gate === 'checking' && (
            <p className="actions">
              <span>Door43 is checking the snapshot. This usually takes a few seconds.</span>
              <button type="button" className="secondary" onClick={() => void read(preparation.id)} disabled={busy !== null}>
                Refresh
              </button>
            </p>
          )}
          {preparation.state === 'retryable_failure' && preparation.last_error && <p className="field-error">{preparation.last_error.message}</p>}
          {discardOnly(preparation) && <p>This preparation cannot be released: discard it, then prepare the snapshot again.</p>}

          {(gate === 'ready' || gate === 'acknowledge') && (
            <form
              className="create"
              onSubmit={event => {
                event.preventDefault();
                void create();
              }}
            >
              <label className="field" htmlFor="release-notes">
                Release notes
                <textarea id="release-notes" rows={8} value={notes} onChange={event => setNotes(event.target.value)} required />
              </label>
              <label className="field" htmlFor="release-version-final">
                Version
                <input id="release-version-final" value={version} onChange={event => setVersion(event.target.value)} required />
              </label>
              <label className="choice">
                <input type="checkbox" checked={prerelease} onChange={event => setPrerelease(event.target.checked)} /> Create as a pre-release, to promote later
              </label>
              {gate === 'acknowledge' && (
                <label className="choice">
                  <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I have read the health check warnings above and want to release anyway
                </label>
              )}
              <div className="actions">
                <button type="submit" disabled={busy !== null || !notes.trim() || !version.trim() || (gate === 'acknowledge' && !acknowledged)}>
                  {preparation.state === 'retryable_failure' ? 'Try the release again' : prerelease ? 'Create the pre-release' : 'Create the release'}
                </button>
              </div>
            </form>
          )}

          {step === 'Released' && preparation.release && (
            <>
              <p role="status">
                {preparation.state === 'pre_release' ? 'Pre-release' : 'Release'} {preparation.release.tag} is on Door43:{' '}
                <a href={preparation.release.url} target="_blank" rel="noreferrer">
                  open it
                </a>
                . Its page here, to come back to later: <a href={releaseTagHash(project, preparation.release.tag)}>{preparation.release.tag}</a>.
              </p>
              {preparation.state === 'pre_release' && (
                <div className="actions">
                  <button type="button" onClick={() => void promote()} disabled={busy !== null}>
                    Promote to a full release
                  </button>
                  <span className="muted">Promotion changes the pre-release flag only: not the version, not the contents.</span>
                </div>
              )}
            </>
          )}

          {canDiscard(preparation) && (
            <div className="actions discard">
              {confirmingDiscard ? (
                <>
                  <span>Discard this preparation? The temporary branch is deleted; the default branch is untouched.</span>
                  <button type="button" onClick={() => void discard()} disabled={busy !== null}>
                    Discard the preparation
                  </button>
                  <button type="button" className="secondary" onClick={() => setConfirmingDiscard(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="secondary" onClick={() => setConfirmingDiscard(true)} disabled={busy !== null}>
                  Discard the preparation
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
