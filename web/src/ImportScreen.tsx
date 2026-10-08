// The import screen (#81, product spec §8 "Import from an existing
// repository"): from the project view, the manager finds an owner (their own
// organizations listed before they type, any owner by partial name as they
// type, `owner.search`), picks one of its Bible or Open Bible Stories
// repositories at its latest content or its last release (`source.search`,
// each with its format and whether it was ever released; one of the other
// project type is shown and cannot be picked), picks all or some of its books
// or stories (or all, when Door43 itemizes none and the plan reads the
// archive), and reviews `import.plan`'s answer before anything is written
// (ADR 0011): each file with its book or story, each overwrite with its diff
// and its own confirmation, the ingredient entries, the source relationship,
// the plan's warnings, and one final summary whose button names the write.
// The confirmation sends that plan's id to `import.apply` once; the receipt
// goes to the caller. A failure is shown in place with the catalog's message
// and the way forward (X2); an apply is never sent twice by itself (X1).

import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '@tc-admin/shared/schema';
import { ApiError, callOperation, failureMessage } from './api/client';
import {
  STAGE_HINTS,
  STAGE_LABELS,
  canConfirmImport,
  importAction,
  importBlockers,
  importConfirmLabel,
  importSummary,
  importWayForward,
  importWayForwardText,
  mismatchText,
  notItemizedText,
  offeredLabel,
  ownerChoices,
  ownerLabel,
  relationshipText,
  revisionOf,
  sourceFacts,
  sourceMatches,
  unitsInput,
} from './import';
import type { Account, ImportPlan, ImportProblem, ImportReceipt, ImportedFile, Source, Stage } from './import';
import { Overwrite, bytes, md5Of, sizeOf, time } from './UploadScreen';
import { overwriteKey, unitLabel, unitNoun } from './upload';
import type { UploadType } from './upload';

interface Props {
  project: Pick<ProjectSummary, 'ref' | 'title'>;
  type: UploadType;
  /** The apply's receipt, with the count and noun of what it imported ("Imported 2 books"). */
  onImported: (receipt: ImportReceipt, added: string) => void;
  onCancel: () => void;
  /** Given, a session Door43 no longer accepts goes to it; otherwise it is shown here. */
  onFailure?: ((failure: unknown) => void) | undefined;
}

type Busy = 'owners' | 'sources' | 'planning' | 'applying';

/** The plan of record, with the choices it was made from. */
interface Planned {
  plan: ImportPlan;
  source: Source;
}

export function ImportScreen({ project, type, onImported, onCancel, onFailure }: Props) {
  const { owner, repo } = project.ref;
  const [query, setQuery] = useState('');
  const [owners, setOwners] = useState<{ own: Account[]; matches: Account[]; query: string } | null>(null);
  const [chosenOwner, setChosenOwner] = useState<Account | null>(null);
  const [stage, setStage] = useState<Stage>('latest');
  const [sources, setSources] = useState<{ owner: string; stage: Stage; list: Source[] } | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [chosenUnits, setChosenUnits] = useState<ReadonlySet<string>>(new Set());
  const [planned, setPlanned] = useState<Planned | null>(null);
  // The overwrites the manager confirmed, by `overwriteKey`: a later plan that replaces the same file the same way keeps them.
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<Busy | null>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  // The plan an apply was sent for and did not succeed: it is not sent again (X1); a new plan is.
  const [spent, setSpent] = useState<string | null>(null);
  // Bumped by every search, plan, and apply: an answer for an earlier one is stale and is not shown.
  const ticket = useRef(0);
  // Bumped by "Try again" after a failed owner or source search: the search runs again with the same input.
  const [attempt, setAttempt] = useState(0);

  const show = (failure: unknown, during: ImportProblem['during']) => {
    if (failure instanceof ApiError && failure.error.code === 'session_expired' && onFailure) return onFailure(failure);
    const error = failure instanceof ApiError ? failure.error : null;
    setProblem({ code: error?.code ?? 'door43_unavailable', message: failureMessage(failure), during });
  };

  // The owners: the account's own organizations before anything is typed, then the catalog's matches as the manager types.
  useEffect(() => {
    if (chosenOwner) return;
    const mine = ++ticket.current;
    const q = query.trim();
    const search = async () => {
      setBusy('owners');
      try {
        const answer = await callOperation('owner.search', { q: q || null });
        if (mine !== ticket.current) return;
        setOwners({ ...ownerChoices(answer), query: q });
        setProblem(null);
      } catch (failure) {
        if (mine !== ticket.current) return;
        show(failure, 'owners');
      } finally {
        if (mine === ticket.current) setBusy(null);
      }
    };
    // The organizations at once; a typed name after a pause, so a name is searched once, not once per keystroke.
    if (!q) {
      void search();
      return;
    }
    const handle = setTimeout(() => void search(), 300);
    return () => clearTimeout(handle);
    // `show` reads only props; the search is keyed by what is typed and whether an owner is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, chosenOwner, attempt]);

  // The chosen owner's sources at the stage.
  useEffect(() => {
    if (!chosenOwner) return;
    const mine = ++ticket.current;
    setSources(null);
    setBusy('sources');
    callOperation('source.search', { owner: chosenOwner.login, stage }).then(
      answer => {
        if (mine !== ticket.current) return;
        setSources({ owner: chosenOwner.login, stage, list: answer.sources });
        setProblem(null);
        setBusy(null);
      },
      (failure: unknown) => {
        if (mine !== ticket.current) return;
        show(failure, 'sources');
        setBusy(null);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenOwner, stage, attempt]);

  /** Repeats the failed owner or source search with the same input. */
  const searchAgain = () => {
    setProblem(null);
    setAttempt(previous => previous + 1);
  };

  /** Any change to the source or its chosen units retires the plan of record and drops a plan still being made, so Confirm is offered only for a plan of the current choices. */
  const retirePlan = () => {
    if (busy === 'applying') return;
    ++ticket.current;
    setPlanned(null);
    if (busy === 'planning') setBusy(null);
  };
  const chooseUnits = (next: (previous: ReadonlySet<string>) => ReadonlySet<string>) => {
    retirePlan();
    setChosenUnits(next);
  };

  const chooseOwner = (account: Account) => {
    setChosenOwner(account);
    setSource(null);
    setPlanned(null);
    setProblem(null);
  };
  const changeOwner = () => {
    ++ticket.current;
    setChosenOwner(null);
    setSources(null);
    setSource(null);
    setPlanned(null);
    setProblem(null);
    setBusy(null);
  };
  const chooseStage = (next: Stage) => {
    setStage(next);
    setSource(null);
    setPlanned(null);
  };
  const chooseSource = (next: Source) => {
    retirePlan();
    setSource(next);
    setChosenUnits(new Set(next.books?.map(unit => unit.id) ?? []));
    setProblem(null);
  };

  /** Plans the import of the chosen units from the source; the answer becomes the plan of record, or the failure is shown in its place. */
  const plan = async (from: Source, units: ReadonlySet<string>) => {
    const input = unitsInput(from, units);
    if (!input) return;
    const mine = ++ticket.current;
    setPlanned(null);
    setProblem(null);
    setBusy('planning');
    try {
      const answer = await callOperation('import.plan', { owner, repo, source: { owner: from.ref.owner, repo: from.ref.repo, revision: revisionOf(from) }, units: input });
      if (mine !== ticket.current) return;
      setPlanned({ plan: answer, source: from });
      setSpent(null);
    } catch (failure) {
      if (mine !== ticket.current) return;
      show(failure, 'plan');
    } finally {
      if (mine === ticket.current) setBusy(null);
    }
  };

  const confirm = async () => {
    if (!planned || busy || !canConfirmImport(planned.plan, confirmed) || spent === planned.plan.id) return;
    const mine = ++ticket.current;
    const count = planned.plan.preview.files.length;
    const added = `Imported ${count} ${unitNoun(type, count)}`;
    setBusy('applying');
    setProblem(null);
    try {
      const receipt = await callOperation('import.apply', { owner, repo, plan_id: planned.plan.id });
      // A commit that landed always shows its receipt.
      onImported(receipt, added);
    } catch (failure) {
      if (mine !== ticket.current) return;
      setSpent(planned.plan.id);
      show(failure, 'apply');
    } finally {
      if (mine === ticket.current) setBusy(null);
    }
  };

  const applying = busy === 'applying';
  const itemized = source?.books ?? null;
  const units = source ? unitsInput(source, chosenUnits) : null;
  return (
    <section className="upload" aria-label={importAction(type)}>
      <p>
        <button type="button" className="secondary" onClick={onCancel} disabled={applying}>
          Back to the project
        </button>
      </p>
      <h2>
        {importAction(type)} · {project.title}
      </h2>
      <p>
        {type === 'bible' ? 'Books' : 'Stories'} from any Door43 repository of this project's type, in any metadata format, through its Scripture Burrito archive. Nothing is written to Door43 until you
        confirm the plan below, and nothing is ever written to the repository imported from.
      </p>

      {problem && <ImportProblemNotice problem={problem} busy={busy !== null} onPlanAgain={() => source && void plan(source, chosenUnits)} onSearchAgain={searchAgain} onChooseAgain={changeOwner} onBack={onCancel} />}

      <fieldset disabled={applying}>
        <legend>Owner</legend>
        {chosenOwner ? (
          <p className="chosen">
            {ownerLabel(chosenOwner)}
            <button type="button" className="secondary" onClick={changeOwner}>
              Change the owner
            </button>
          </p>
        ) : (
          <>
            <label className="field" htmlFor="import-owner">
              Search owners by name
            </label>
            <input id="import-owner" type="text" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" placeholder="unfoldingWord, bahtraku…" />
            {busy === 'owners' && <p className="muted" role="status">Searching owners…</p>}
            {owners && (
              <>
                {owners.own.length > 0 && (
                  <>
                    <p className="derived">Your organizations:</p>
                    <ul className="languages" aria-label="Your organizations">
                      {owners.own.map(account => (
                        <li key={account.login}>
                          <button type="button" onClick={() => chooseOwner(account)}>
                            {ownerLabel(account)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {owners.query && owners.matches.length > 0 && (
                  <>
                    <p className="derived">Owners matching "{owners.query}":</p>
                    <ul className="languages" aria-label="Matching owners">
                      {owners.matches.map(account => (
                        <li key={account.login}>
                          <button type="button" onClick={() => chooseOwner(account)}>
                            {ownerLabel(account)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {owners.query && owners.matches.length === 0 && busy !== 'owners' && <p className="derived">No other owner matches "{owners.query}".</p>}
                {!owners.query && owners.own.length === 0 && <p className="derived">You belong to no organization. Type an owner's name to find one.</p>}
              </>
            )}
          </>
        )}
      </fieldset>

      {chosenOwner && (
        <fieldset disabled={applying}>
          <legend>Repository and content</legend>
          <div className="selection" role="radiogroup" aria-label="Which content">
            {(['latest', 'prod'] as const).map(option => (
              <label key={option} className="choice">
                <input type="radio" name="import-stage" value={option} checked={stage === option} onChange={() => chooseStage(option)} /> {STAGE_LABELS[option]}
                <span className="muted"> · {STAGE_HINTS[option]}</span>
              </label>
            ))}
          </div>
          {busy === 'sources' && <p className="muted" role="status">Reading the repositories of {chosenOwner.login}…</p>}
          {sources && sources.list.length === 0 && <p className="derived">{chosenOwner.login} has no Bible or Open Bible Stories repository at its {STAGE_LABELS[stage].toLowerCase()}.</p>}
          {sources && sources.list.length > 0 && (
            <ul className="languages" aria-label="Repositories">
              {sources.list.map(candidate => {
                const key = `${candidate.ref.owner}/${candidate.ref.repo}`;
                const matches = sourceMatches(candidate, type);
                const picked = source !== null && `${source.ref.owner}/${source.ref.repo}` === key;
                return (
                  <li key={key} className={matches ? undefined : 'refused'} aria-disabled={matches ? undefined : 'true'}>
                    {matches ? (
                      <button type="button" aria-pressed={picked} onClick={() => chooseSource(candidate)}>
                        {candidate.title} <code>{key}</code>
                      </button>
                    ) : (
                      <span>
                        {candidate.title} <code>{key}</code>
                      </span>
                    )}
                    <span className="muted"> · {sourceFacts(candidate).join(' · ')}</span>
                    {!matches && <span className="muted"> · {mismatchText(candidate, type)}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {sources && <p className="freshness">Read from Door43's catalog.</p>}
        </fieldset>
      )}

      {source && (
        <fieldset disabled={applying}>
          <legend>
            {type === 'bible' ? 'Books' : 'Stories'} of {source.ref.owner}/{source.ref.repo}
          </legend>
          {itemized === null ? (
            <p>{notItemizedText(type)}</p>
          ) : itemized.length === 0 ? (
            <p>Door43 lists no {unitNoun(type, 1)} in this repository at its {STAGE_LABELS[stage].toLowerCase()}.</p>
          ) : (
            <>
              <p className="actions">
                <button type="button" className="secondary" onClick={() => chooseUnits(() => new Set(itemized.map(unit => unit.id)))}>
                  Choose all {itemized.length}
                </button>
                <button type="button" className="secondary" onClick={() => chooseUnits(() => new Set())}>
                  Choose none
                </button>
              </p>
              <ul className="units" aria-label={`${type === 'bible' ? 'Books' : 'Stories'} to import`}>
                {itemized.map(unit => (
                  <li key={unit.id}>
                    <label className="choice">
                      <input
                        type="checkbox"
                        checked={chosenUnits.has(unit.id)}
                        onChange={event =>
                          chooseUnits(previous => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(unit.id);
                            else next.delete(unit.id);
                            return next;
                          })
                        }
                      />{' '}
                      {offeredLabel(type, unit)}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="actions">
            <button type="button" onClick={() => void plan(source, chosenUnits)} disabled={units === null || busy !== null || (itemized !== null && itemized.length === 0)}>
              {busy === 'planning' ? 'Planning the import…' : units === 'all' ? `Plan the import of all ${unitNoun(type, 2)}` : units ? `Plan the import of ${units.length} ${unitNoun(type, units.length)}` : 'Plan the import'}
            </button>
          </p>
        </fieldset>
      )}

      {planned && (
        <ImportReview
          plan={planned.plan}
          type={type}
          confirmed={confirmed}
          busy={busy}
          spent={spent === planned.plan.id}
          onConfirmOverwrite={(file, on) =>
            setConfirmed(previous => {
              const next = new Set(previous);
              if (on) next.add(overwriteKey(planned.plan, file));
              else next.delete(overwriteKey(planned.plan, file));
              return next;
            })
          }
          onConfirm={() => void confirm()}
          onCancel={onCancel}
        />
      )}
    </section>
  );
}

/** A failure in place: the catalog's message and the way forward. */
function ImportProblemNotice({
  problem,
  busy,
  onPlanAgain,
  onSearchAgain,
  onChooseAgain,
  onBack,
}: {
  problem: ImportProblem;
  busy: boolean;
  onPlanAgain: () => void;
  onSearchAgain: () => void;
  onChooseAgain: () => void;
  onBack: () => void;
}) {
  const forward = importWayForward(problem.code, problem.during);
  return (
    <div className="upload-problem" role="alert" data-code={problem.code}>
      <p>
        <strong>{problem.message}</strong>
      </p>
      <p>{importWayForwardText(problem)}</p>
      {forward === 'plan_again' && (
        <button type="button" onClick={onPlanAgain} disabled={busy}>
          Plan again
        </button>
      )}
      {forward === 'try_again' && (
        <button type="button" onClick={problem.during === 'plan' || problem.during === 'apply' ? onPlanAgain : onSearchAgain} disabled={busy}>
          Try again
        </button>
      )}
      {forward === 'choose_again' && (
        <button type="button" className="secondary" onClick={onChooseAgain} disabled={busy}>
          Choose the owner again
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

interface ReviewProps {
  plan: ImportPlan;
  type: UploadType;
  confirmed: ReadonlySet<string>;
  busy: Busy | null;
  /** An apply of this plan was sent and did not succeed: it is not offered again. */
  spent: boolean;
  onConfirmOverwrite: (file: ImportedFile, on: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The plan of record: the imported files, the ingredient entries, the source relationship, the warnings, and the summary. */
function ImportReview({ plan, type, confirmed, busy, spent, onConfirmOverwrite, onConfirm, onCancel }: ReviewProps) {
  const files = plan.preview.files;
  const blockers = importBlockers(plan, confirmed);
  const locked = busy !== null;
  const entries = plan.preview.metadata_diff.ingredients;
  return (
    <div className="upload-review">
      <h3>Review before importing</h3>
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

      <h4>{files.length === 1 ? `1 ${unitNoun(type, 1)}` : `${files.length} ${unitNoun(type, files.length)}`}</h4>
      <ul className="upload-files" aria-label="Imported files">
        {files.map(file => (
          <li key={file.name} className="upload-file">
            <div className="actions">
              <strong>{unitLabel(file.identified!)}</strong>
              <span>
                <code>{file.name}</code> from the source to <code>{file.path}</code>
              </span>
              <span className="muted">{bytes(file.size)}</span>
              <span className="badge">{file.overwrite ? 'Replaces a file' : 'New'}</span>
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
        ))}
      </ul>

      <h4>Ingredient entries in metadata.json</h4>
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

      <h4>Source relationship</h4>
      <p>{relationshipText(plan)}</p>
      {plan.preview.metadata_diff.relationships.map(relationship => (
        <p key={relationship.id} className="muted">
          <code>{relationship.id}</code> · {relationship.relationType} · {relationship.flavor} · revision <code>{relationship.revision}</code>
        </p>
      ))}

      <div className="upload-summary">
        <h4>Summary</h4>
        <p>{importSummary(plan, type)}</p>
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
            {busy === 'applying' ? `Importing ${files.length} ${unitNoun(type, files.length)}…` : importConfirmLabel(type, files.length)}
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={busy === 'applying'}>
            Back to the project
          </button>
        </div>
      </div>
    </div>
  );
}
