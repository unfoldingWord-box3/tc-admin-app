// The upload screen (#76, product spec §8): the manager chooses files, several
// files, or a folder, or drops them; the screen asks `upload.plan` and shows its
// answer before anything is written (ADR 0011): each file with the book or
// story it was identified as, every file held back under Unknown files with a
// choice of its book or story or to leave it out, each overwrite with its diff
// and its own confirmation, the ingredient entries the commit adds or
// replaces, the plan's warnings, and one final summary whose button names the
// write. A choice or a file left out plans again, so what is shown is always
// the plan of record; the confirmation sends that plan's id with the same
// files and confirmations (`applyUpload`), and the receipt goes to the caller.
// A failure is shown in place with the catalog's message and the way forward
// (X2); an apply is never sent twice by itself (X1).

import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { ProjectSummary } from '@tc-admin/shared/schema';
import { ApiError, callOperation, failureMessage } from './api/client';
import {
  addAction,
  applyUpload,
  canConfirm,
  choiceLabel,
  chooseHint,
  confirmBlockers,
  confirmLabel,
  confirmationOf,
  diffCounts,
  diffLines,
  heldBackFiles,
  heldBackHint,
  identifiedFiles,
  mergeChosen,
  overwriteKey,
  problemFiles,
  unidentifiedMessage,
  unitChoices,
  unitLabel,
  unitNoun,
  unitOf,
  uploadName,
  uploadSummary,
  wayForward,
  wayForwardText,
  withConfirmation,
  withoutFile,
} from './upload';
import type { ChosenFile, Confirmations, PlannedFile, UploadPlan, UploadProblem, UploadReceipt, UploadType, Unit } from './upload';

interface Props {
  project: Pick<ProjectSummary, 'ref' | 'title'>;
  type: UploadType;
  /** The apply's receipt, with the count and noun of what it added ("Added 3 books"). */
  onUploaded: (receipt: UploadReceipt, added: string) => void;
  onCancel: () => void;
  /** Given, a session Door43 no longer accepts goes to it; otherwise it is shown here. */
  onFailure?: ((failure: unknown) => void) | undefined;
}

/** The plan of record, with exactly the files and confirmations it was made from: the apply sends these. */
interface Planned {
  plan: UploadPlan;
  files: ChosenFile[];
  confirmations: Confirmations;
}

type Busy = 'reading' | 'planning' | 'applying';
interface Picked {
  name: string;
  file: Blob;
}

export const time = (iso: string) => new Date(iso).toLocaleTimeString();
export const bytes = (size: number) => `${size.toLocaleString()} ${size === 1 ? 'byte' : 'bytes'}`;

/** The files a drop carries: a dropped folder's files by their paths inside it, where the browser offers its entries. */
async function droppedFiles(data: DataTransfer): Promise<Picked[]> {
  // The entries are taken while the drop is being handled; the browser empties the transfer after it.
  const entries = Array.from(data.items ?? [])
    .map(item => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) return Array.from(data.files ?? []).map(file => ({ name: uploadName(file), file }));
  const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));
  const children = (entry: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const reader = entry.createReader();
      const all: FileSystemEntry[] = [];
      // A directory reader answers in batches until an empty one.
      const next = () => reader.readEntries(batch => (batch.length === 0 ? resolve(all) : (all.push(...batch), next())), reject);
      next();
    });
  const walk = async (entry: FileSystemEntry): Promise<Picked[]> => {
    if (entry.isFile) return [{ name: entry.fullPath.replace(/^\/+/, ''), file: await fileOf(entry as FileSystemFileEntry) }];
    if (entry.isDirectory) return (await Promise.all((await children(entry as FileSystemDirectoryEntry)).map(walk))).flat();
    return [];
  };
  return (await Promise.all(entries.map(walk))).flat();
}

export function UploadScreen({ project, type, onUploaded, onCancel, onFailure }: Props) {
  const { owner, repo } = project.ref;
  const [chosen, setChosen] = useState<ChosenFile[]>([]);
  const [confirmations, setConfirmations] = useState<Confirmations>({});
  const [planned, setPlanned] = useState<Planned | null>(null);
  // The overwrites the manager confirmed, by `overwriteKey`: a later plan that replaces the same file the same way keeps them.
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<Busy | null>(null);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  // The plan an apply was sent for and did not succeed: it is not sent again (X1); a new plan is.
  const [spent, setSpent] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Bumped by every plan, apply, and accepted choice of files: an answer for an earlier one is stale and is not shown.
  const ticket = useRef(0);
  // The batch as last set, read by a choice whose files finish reading after another choice changed it.
  const batch = useRef<{ files: ChosenFile[]; confirmations: Confirmations }>({ files: [], confirmations: {} });
  // Choices of files still being read: the batch is planned when the last of them is read.
  const reading = useRef(0);
  // An apply in flight: no choice of files is accepted until it is answered.
  const applyingNow = useRef(false);

  const show = (failure: unknown, during: UploadProblem['during'], sent: readonly string[]) => {
    if (failure instanceof ApiError && failure.error.code === 'session_expired' && onFailure) return onFailure(failure);
    const error = failure instanceof ApiError ? failure.error : null;
    setProblem({ code: error?.code ?? 'door43_unavailable', message: failureMessage(failure), files: error ? problemFiles(error, sent) : [], during });
  };

  /** Plans the files with the confirmations; the answer becomes the plan of record, or the failure is shown in its place. */
  const plan = async (files: ChosenFile[], nextConfirmations: Confirmations) => {
    const mine = ++ticket.current;
    batch.current = { files, confirmations: nextConfirmations };
    setChosen(files);
    setConfirmations(nextConfirmations);
    setProblem(null);
    if (files.length === 0) {
      setPlanned(null);
      setBusy(null);
      return;
    }
    setBusy('planning');
    try {
      const answer = await callOperation('upload.plan', {
        owner,
        repo,
        files: files.map(file => ({ name: file.name, content: file.content })),
        ...(Object.keys(nextConfirmations).length > 0 ? { confirmations: { ...nextConfirmations } } : {}),
      });
      if (mine !== ticket.current) return;
      setPlanned({ plan: answer, files, confirmations: nextConfirmations });
      setSpent(null);
    } catch (failure) {
      if (mine !== ticket.current) return;
      setPlanned(null);
      show(
        failure,
        'plan',
        files.map(file => file.name),
      );
    } finally {
      if (mine === ticket.current) setBusy(null);
    }
  };

  /**
   * Adds the files of one choice or drop to the batch. Accepting it makes any plan still in flight stale and keeps the
   * confirmation locked until the batch, with every overlapping choice's files merged into it, has a plan of record.
   */
  const add = async (source: readonly Picked[] | Promise<readonly Picked[]>) => {
    if (applyingNow.current || (Array.isArray(source) && source.length === 0)) return;
    ++ticket.current;
    reading.current += 1;
    setReadProblem(null);
    setBusy('reading');
    const read: ChosenFile[] = [];
    try {
      for (const { name, file } of await source) {
        try {
          read.push({ name, content: new Uint8Array(await file.arrayBuffer()) });
        } catch {
          setReadProblem(`This browser could not read ${name}. Choose it again.`);
        }
      }
    } catch {
      setReadProblem('This browser could not read the dropped files. Choose them with the buttons instead.');
    }
    reading.current -= 1;
    const files = read.length > 0 ? mergeChosen(batch.current.files, read) : batch.current.files;
    if (read.length > 0) {
      batch.current = { files, confirmations: batch.current.confirmations };
      setChosen(files);
    }
    if (reading.current > 0) return;
    // The last choice read plans the whole batch; a plan an earlier choice made stale is asked again.
    if (files.length === 0) return setBusy(null);
    await plan(files, batch.current.confirmations);
  };

  const leaveOut = (name: string) => {
    const next = withoutFile(chosen, confirmations, name);
    void plan(next.files, next.confirmations);
  };
  const leaveOutAll = (names: readonly string[]) => {
    let next = { files: chosen, confirmations: { ...confirmations } };
    for (const name of names) next = withoutFile(next.files, next.confirmations, name);
    void plan(next.files, next.confirmations);
  };
  const choose = (name: string, unit: Unit | null) => void plan(chosen, withConfirmation(confirmations, name, unit));

  const confirm = async () => {
    if (!planned || busy || !canConfirm(planned.plan, type, confirmed) || spent === planned.plan.id) return;
    const mine = ++ticket.current;
    const added = `Added ${identifiedFiles(planned.plan).length} ${unitNoun(type, identifiedFiles(planned.plan).length)}`;
    applyingNow.current = true;
    setBusy('applying');
    setProblem(null);
    try {
      const receipt = await applyUpload({ owner, repo }, planned.plan.id, planned.files, planned.confirmations);
      // A commit that landed always shows its receipt.
      onUploaded(receipt, added);
    } catch (failure) {
      if (mine !== ticket.current) return;
      setSpent(planned.plan.id);
      show(
        failure,
        'apply',
        planned.files.map(file => file.name),
      );
    } finally {
      applyingNow.current = false;
      if (mine === ticket.current) setBusy(null);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy === 'applying') return;
    // Accepted now, while the drop is handled, so the confirmation is locked while its folder is walked.
    void add(droppedFiles(event.dataTransfer));
  };

  const applying = busy === 'applying';
  const current = planned?.plan ?? null;
  return (
    <section className="upload" aria-label={addAction(type)}>
      <p>
        <button type="button" className="secondary" onClick={onCancel} disabled={applying}>
          Back to the project
        </button>
      </p>
      <h1>
        {addAction(type)} · {project.title}
      </h1>
      <p>{chooseHint(type)} Nothing is written to Door43 until you confirm the plan below.</p>
      <div
        className={dragging ? 'dropzone dragging' : 'dropzone'}
        onDragOver={event => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="dropzone"
      >
        <p>Drop files or a folder here, or</p>
        <div className="actions">
          <label className="button">
            Choose files
            <input
              type="file"
              multiple
              className="visually-hidden"
              disabled={applying}
              onChange={event => {
                const input = event.currentTarget;
                const picked = Array.from(input.files ?? []).map(file => ({ name: uploadName(file), file }));
                input.value = '';
                void add(picked);
              }}
            />
          </label>
          <label className="button secondary">
            Choose a folder
            <input
              type="file"
              multiple
              className="visually-hidden"
              disabled={applying}
              // A folder chooser: React has no property for it, so the attribute is set on the element.
              ref={input => input?.setAttribute('webkitdirectory', '')}
              onChange={event => {
                const input = event.currentTarget;
                const picked = Array.from(input.files ?? []).map(file => ({ name: uploadName(file), file }));
                input.value = '';
                void add(picked);
              }}
            />
          </label>
        </div>
      </div>
      {readProblem && (
        <p className="field-error" role="alert">
          {readProblem}
        </p>
      )}
      {busy === 'reading' && <p className="muted" role="status">Reading the files…</p>}
      {busy === 'planning' && <p className="muted" role="status">Planning the upload…</p>}
      {problem && (
        <ProblemNotice
          problem={problem}
          busy={busy !== null}
          onLeaveOut={leaveOut}
          onPlanAgain={() => void plan(chosen, confirmations)}
          onBack={onCancel}
        />
      )}
      {!current && chosen.length > 0 && busy !== 'planning' && (
        <ChosenList type={type} files={chosen} confirmations={confirmations} problem={problem} busy={busy !== null} onLeaveOut={leaveOut} onClear={name => choose(name, null)} />
      )}
      {current && planned && (
        <PlanReview
          plan={current}
          type={type}
          confirmations={planned.confirmations}
          confirmed={confirmed}
          busy={busy}
          spent={spent === current.id}
          onConfirmOverwrite={(file, on) =>
            setConfirmed(previous => {
              const next = new Set(previous);
              if (on) next.add(overwriteKey(current, file));
              else next.delete(overwriteKey(current, file));
              return next;
            })
          }
          onChoose={choose}
          onLeaveOut={leaveOut}
          onLeaveOutAll={leaveOutAll}
          onConfirm={() => void confirm()}
          onCancel={onCancel}
        />
      )}
    </section>
  );
}

/** A failure in place: the catalog's message, each file a refusal names with its own message, and the way forward. */
function ProblemNotice({
  problem,
  busy,
  onLeaveOut,
  onPlanAgain,
  onBack,
}: {
  problem: UploadProblem;
  busy: boolean;
  onLeaveOut: (name: string) => void;
  onPlanAgain: () => void;
  onBack: () => void;
}) {
  const forward = wayForward(problem.code, problem.during);
  return (
    <div className="upload-problem" role="alert" data-code={problem.code}>
      {problem.files.length > 0 ? (
        <>
          <p>
            <strong>{problem.files.length === 1 ? 'This file cannot be uploaded:' : `These ${problem.files.length} files cannot be uploaded:`}</strong>
          </p>
          <ul>
            {problem.files.map(file => (
              <li key={file.name} className="actions">
                <span>{file.message}</span>
                <button type="button" className="secondary" disabled={busy} onClick={() => onLeaveOut(file.name)}>
                  Leave out {file.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          <strong>{problem.message}</strong>
        </p>
      )}
      <p>{wayForwardText(problem)}</p>
      {(forward === 'plan_again' || forward === 'try_again') && (
        <button type="button" onClick={onPlanAgain} disabled={busy}>
          {forward === 'plan_again' ? 'Plan again' : 'Try again'}
        </button>
      )}
      {forward === 'back' && (
        <button type="button" className="secondary" onClick={onBack}>
          Back to the project
        </button>
      )}
    </div>
  );
}

/** The files chosen, while there is no plan of record for them: each can be left out, and a choice of book or story cleared. */
function ChosenList({
  type,
  files,
  confirmations,
  problem,
  busy,
  onLeaveOut,
  onClear,
}: {
  type: UploadType;
  files: readonly ChosenFile[];
  confirmations: Confirmations;
  problem: UploadProblem | null;
  busy: boolean;
  onLeaveOut: (name: string) => void;
  onClear: (name: string) => void;
}) {
  return (
    <>
      <h2>Files chosen</h2>
      <ul className="upload-files" aria-label="Files chosen">
        {files.map(file => {
          const unit = confirmationOf(confirmations, file.name);
          const refused = problem?.files.some(entry => entry.name === file.name);
          return (
            <li key={file.name} className="upload-file">
              <div className="actions">
                <code>{file.name}</code>
                <span className="muted">{bytes(file.content.length)}</span>
                {refused && <span className="badge">Refused</span>}
                {unit && (
                  <>
                    <span>
                      Chosen as {unitLabel(unit)}
                    </span>
                    <button type="button" className="secondary" disabled={busy} onClick={() => onClear(file.name)}>
                      Clear the {unitNoun(type, 1)} chosen
                    </button>
                  </>
                )}
                <button type="button" className="secondary" disabled={busy} onClick={() => onLeaveOut(file.name)}>
                  Leave out {file.name}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

interface ReviewProps {
  plan: UploadPlan;
  type: UploadType;
  confirmations: Confirmations;
  confirmed: ReadonlySet<string>;
  busy: Busy | null;
  /** An apply of this plan was sent and did not succeed: it is not offered again. */
  spent: boolean;
  onConfirmOverwrite: (file: PlannedFile, on: boolean) => void;
  onChoose: (name: string, unit: Unit | null) => void;
  onLeaveOut: (name: string) => void;
  onLeaveOutAll: (names: readonly string[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The plan of record: the identified files, the unknown files held back, the ingredient entries, the warnings, and the summary. */
function PlanReview({ plan, type, confirmations, confirmed, busy, spent, onConfirmOverwrite, onChoose, onLeaveOut, onLeaveOutAll, onConfirm, onCancel }: ReviewProps) {
  const identified = identifiedFiles(plan);
  const held = heldBackFiles(plan);
  const blockers = confirmBlockers(plan, type, confirmed);
  const locked = busy !== null;
  const entries = plan.preview.metadata_diff.ingredients;
  return (
    <div className="upload-review">
      <h2>Review before adding</h2>
      <p className="muted">Nothing has been written to Door43 yet. This is exactly what confirming will write. The plan is valid until {time(plan.expires_at)}.</p>

      {plan.warnings.length > 0 && (
        <ul className="findings" aria-label="Warnings">
          {plan.warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="finding" data-severity="warning">
              <p className="finding-head">
                <span className="severity-badge">Warning</span>
                <span>{warning.message}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      <h3>{identified.length === 1 ? `1 ${unitNoun(type, 1)}` : `${identified.length} ${unitNoun(type, identified.length)}`}</h3>
      {identified.length === 0 && <p className="muted">No file is identified as a {unitNoun(type, 1)} yet.</p>}
      <ul className="upload-files" aria-label="Identified files">
        {identified.map(file => {
          const chosen = confirmationOf(confirmations, file.name);
          return (
            <li key={file.name} className="upload-file">
              <div className="actions">
                <strong>{unitLabel(file.identified!)}</strong>
                <span>
                  <code>{file.name}</code> to <code>{file.path}</code>
                </span>
                <span className="muted">{bytes(file.size)}</span>
                <span className="badge">{file.overwrite ? 'Replaces a file' : 'New'}</span>
                {chosen && <span className="badge">Chosen by you</span>}
                {chosen && (
                  <button type="button" className="secondary" disabled={locked} onClick={() => onChoose(file.name, null)}>
                    Clear the {unitNoun(type, 1)} chosen
                  </button>
                )}
                <button type="button" className="secondary" disabled={locked} onClick={() => onLeaveOut(file.name)}>
                  Leave out {file.name}
                </button>
              </div>
              {file.overwrite && (
                <Overwrite
                  file={file}
                  entry={entries.find(change => change.path === file.path) ?? null}
                  checked={confirmed.has(overwriteKey(plan, file))}
                  disabled={locked}
                  onChange={on => onConfirmOverwrite(file, on)}
                />
              )}
            </li>
          );
        })}
      </ul>

      {held.length > 0 && (
        <section aria-label="Unknown files">
          <h3>Unknown files</h3>
          <p>
            Held back: nothing is written for {held.length === 1 ? 'this file' : 'these files'} until you choose a {unitNoun(type, 1)} for each, or leave it out.
          </p>
          <ul className="findings">
            {held.map(file => (
              <li key={file.name} className="finding" data-severity="warning">
                <p className="finding-head">
                  <span className="severity-badge">Held back</span>
                  <code>{file.name}</code>
                  <span className="muted">{bytes(file.size)}</span>
                </p>
                <p>{unidentifiedMessage(file.name)}</p>
                <p className="muted">{heldBackHint(type, file.name)}</p>
                <div className="actions">
                  <label className="field">
                    {type === 'bible' ? 'Book' : 'Story'} for {file.name}{' '}
                    <select value="" disabled={locked} onChange={event => event.target.value && onChoose(file.name, unitOf(type, event.target.value))}>
                      <option value="">Choose a {unitNoun(type, 1)}…</option>
                      {unitChoices(type).map(id => (
                        <option key={id} value={id}>
                          {choiceLabel(type, id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="secondary" disabled={locked} onClick={() => onLeaveOut(file.name)}>
                    Leave out {file.name}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {held.length > 1 && (
            <p className="actions">
              <button type="button" className="secondary" disabled={locked} onClick={() => onLeaveOutAll(held.map(file => file.name))}>
                Leave out all {held.length} unknown files
              </button>
            </p>
          )}
        </section>
      )}

      <h3>Ingredient entries in metadata.json</h3>
      {entries.length === 0 ? (
        <p className="muted">No ingredient entry changes.</p>
      ) : (
        <table className="files" aria-label="Ingredient entries">
          <thead>
            <tr>
              <th>Path</th>
              <th>Change</th>
              <th>Size</th>
              <th>md5</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(change => (
              <tr key={change.path}>
                <td>
                  <code>{change.path}</code>
                </td>
                <td>{change.before ? 'Entry updated' : 'Entry added'}</td>
                <td>
                  {change.before && sizeOf(change.before) !== null ? `${bytes(sizeOf(change.before)!)} to ` : ''}
                  {sizeOf(change.after) !== null ? bytes(sizeOf(change.after)!) : 'Not stated'}
                </td>
                <td>
                  <code>{md5Of(change.after) ?? 'Not stated'}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="upload-summary">
        <h3>Summary</h3>
        <p>{uploadSummary(plan, type)}</p>
        {blockers.length > 0 && (
          <ul aria-label="Before you can confirm">
            {blockers.map(blocker => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        {spent && <p className="muted">This plan was sent once and is not sent again. Plan again to continue.</p>}
        <div className="actions">
          <button type="button" onClick={onConfirm} disabled={blockers.length > 0 || locked || spent}>
            {busy === 'applying' ? `Adding ${identified.length} ${unitNoun(type, identified.length)}…` : identified.length > 0 ? confirmLabel(type, identified.length) : addAction(type)}
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={busy === 'applying'}>
            Back to the project
          </button>
        </div>
      </div>
    </div>
  );
}

export const sizeOf = (entry: Readonly<Record<string, unknown>>): number | null => (typeof entry.size === 'number' ? entry.size : null);
export const md5Of = (entry: Readonly<Record<string, unknown>>): string | null => {
  const checksum = entry.checksum;
  return checksum && typeof checksum === 'object' && typeof (checksum as { md5?: unknown }).md5 === 'string' ? (checksum as { md5: string }).md5 : null;
};

/** One overwrite: the clear warning, its diff (or why there is none, with the old and new size and checksum), and its own confirmation. Shared with the import screen (#81). */
export function Overwrite({
  file,
  entry,
  replacement,
  checked,
  disabled,
  onChange,
}: {
  file: PlannedFile;
  /** What replaces the file, in words; an upload's own file name when not given. An import names the book and its source (#161). */
  replacement?: string;
  entry: { before: Readonly<Record<string, unknown>> | null; after: Readonly<Record<string, unknown>> } | null;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const lines = file.diff ? diffLines(file.diff) : [];
  return (
    <div className="overwrite finding" data-severity="warning">
      <p className="finding-head">
        <span className="severity-badge">Replaces</span>
        <strong>
          {file.path} on the default branch is replaced by {replacement ?? file.name}.
        </strong>
      </p>
      {file.diff === '' && <p>Its content is the same as the file on the default branch: nothing in it changes.</p>}
      {file.diff === null && (
        <>
          <p>No text diff is available for this file. Its size and checksum, before and after:</p>
          <dl className="report">
            <dt>Before</dt>
            <dd>{entry?.before ? `${sizeOf(entry.before) !== null ? bytes(sizeOf(entry.before)!) : 'size not stated'} · md5 ${md5Of(entry.before) ?? 'not stated'}` : 'Not listed in metadata.json'}</dd>
            <dt>After</dt>
            <dd>
              {bytes(file.size)} · md5 {file.md5}
            </dd>
          </dl>
        </>
      )}
      {lines.length > 0 && (
        <>
          <p className="muted">{diffCounts(lines)}. Lines marked + are added and lines marked − are removed.</p>
          <pre className="diff" aria-label={`Changes to ${file.path}`}>
            {lines.map((line, index) => (
              <span key={index} className={`diff-line diff-${line.kind}`}>
                <span className="diff-sign" aria-hidden="true">
                  {line.sign}
                </span>
                <span className="visually-hidden">{line.word}: </span>
                {line.text}
                {'\n'}
              </span>
            ))}
          </pre>
        </>
      )}
      <label className="choice">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /> Replace {file.path} with {replacement ?? file.name}
      </label>
    </div>
  );
}
