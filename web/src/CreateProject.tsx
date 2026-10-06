// The creation wizard (product spec §6, #28): one form, the plan to review,
// the creation. Every rule is the Worker's. The form asks `project.create.plan`
// and shows its preview and `would_write` before anything is written (ADR
// 0011), then `project.create.apply` with the plan id, and shows the receipt.
// A failure a field answers for is shown at that field (X2); a session Door43
// no longer accepts goes to the shell. The owners come from `owner.search`
// once it is built, and until then, when the Worker answers
// `unknown_operation` for it (Q26), from the account and the organizations of
// the loaded portfolio (decided 6 October 2026 by Rich); `project.create.plan`
// decides the creation right (A2). The language field searches
// `language.list` in the browser (Q20); a language whose tag the schema
// refuses is shown and cannot be chosen (Q30). The project type is asked once,
// right after the owner (W3). The Bible's translation details are shown with
// the defaults preselected (Q4); Open Bible Stories has no testament scope and
// is abbreviated OBS unless the manager says otherwise (#82).

import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { OperationOutput, ProjectReport } from '@tc-admin/shared/schema';
import { ApiError, callOperation, failureMessage } from './api/client';
import {
  DETAIL_LABELS,
  DETAIL_OPTIONS,
  DETAIL_VALUE_LABELS,
  LICENSE_LABEL,
  TESTAMENT_SCOPE_LABELS,
  WRITE_LABELS,
  fieldErrors,
  languageLabel,
  missing,
  newForm,
  ownersFromPortfolio,
  ownersFromSearch,
  planInput,
  repositoryNameOf,
  searchLanguages,
  tagRefused,
  withProjectType,
} from './create-project';
import type { CreatableType, Field, FieldErrors, Form, Language, Owner, TestamentScope, TranslationDetails } from './create-project';
import { projectHash, typeLabel } from './portfolio-labels';
import { ProjectView } from './ProjectView';

type Plan = OperationOutput<'project.create.plan'>;
type Receipt = OperationOutput<'project.create.apply'>;
type LanguageList = OperationOutput<'language.list'>;

interface Props {
  account: { login: string; name: string };
  /** The loaded portfolio's owner groups, the owners offered until `owner.search` is built. */
  organizations: readonly { name: string }[];
  onCreated: (project: ProjectReport) => void;
  /** A session Door43 no longer accepts, which ends the signed-in view. */
  onFailure: (failure: unknown) => void;
}

const TYPES: readonly CreatableType[] = ['bible', 'obs'];
const SCOPES: readonly TestamentScope[] = ['nt', 'ot', 'full'];
const time = (iso: string) => new Date(iso).toLocaleTimeString();

/** The errors without one field's, once the manager has changed it. */
function without(errors: FieldErrors, field: Field): FieldErrors {
  const rest = { ...errors };
  delete rest[field];
  return rest;
}

export function CreateProject({ account, organizations, onCreated, onFailure }: Props) {
  const ids = { title: useId(), abbreviation: useId(), language: useId() };
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [form, setForm] = useState<Form>(() => newForm(''));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [languages, setLanguages] = useState<{ owner: string; list: LanguageList } | null>(null);
  const [query, setQuery] = useState('');
  // The plan with the form it was asked for: the review describes what the plan writes, even when the form changed while it was prepared.
  const [planned, setPlanned] = useState<{ plan: Plan; form: Form } | null>(null);
  const plan = planned?.plan ?? null;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);

  // A session Door43 no longer accepts is the shell's to report; every other failure is this form's.
  const expired = useCallback(
    (failure: unknown) => {
      const over = failure instanceof ApiError && failure.error.code === 'session_expired';
      if (over) onFailure(failure);
      return over;
    },
    [onFailure],
  );

  // The owners: `owner.search`'s own list, or, while the Worker has no such operation, the portfolio's. One owner is no choice.
  // Nothing is read again once the project is created, though the portfolio read behind it changes the organizations.
  useEffect(() => {
    if (receipt) return;
    let current = true;
    const offer = (offered: Owner[]) => {
      if (!current) return;
      setOwners(offered);
      if (offered.length === 1) setForm(previous => (previous.owner ? previous : { ...previous, owner: offered[0]!.login }));
    };
    callOperation('owner.search', { q: null }).then(
      result => offer(ownersFromSearch(result.own, account)),
      (failure: unknown) => {
        if (!current) return;
        if (failure instanceof ApiError && failure.error.code === 'unknown_operation') offer(ownersFromPortfolio(organizations, account));
        else if (!expired(failure)) setProblem(failureMessage(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [account, organizations, expired, attempt, receipt]);

  // The languages, once the owners are known (so a lone owner is already chosen), with the owner's own first.
  const ownersKnown = owners !== null;
  useEffect(() => {
    if (!ownersKnown || receipt) return;
    let current = true;
    callOperation('language.list', { owner: form.owner || null }).then(
      list => current && setLanguages({ owner: form.owner, list }),
      (failure: unknown) => current && !expired(failure) && setProblem(failureMessage(failure)),
    );
    return () => {
      current = false;
    };
  }, [ownersKnown, form.owner, expired, attempt, receipt]);

  const update = (patch: Partial<Form>, field?: Field) => {
    setForm(previous => ({ ...previous, ...patch }));
    if (field) setErrors(previous => without(previous, field));
  };
  const chooseLanguage = (language: Language) => {
    update({ language }, 'language');
    setQuery('');
  };

  const fieldsOf = (failure: unknown) => (failure instanceof ApiError ? fieldErrors(failure.error) : null);

  const review = async (event: FormEvent) => {
    event.preventDefault();
    const lacking = missing(form);
    setErrors(lacking);
    if (Object.keys(lacking).length > 0 || !form.language) return;
    setBusy(true);
    setProblem(null);
    try {
      const submitted = form;
      setPlanned({ plan: await callOperation('project.create.plan', planInput({ ...submitted, language: form.language })), form: submitted });
    } catch (failure) {
      if (!expired(failure)) {
        const fields = fieldsOf(failure);
        if (fields) setErrors(fields);
        else setProblem(failureMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!plan) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await callOperation('project.create.apply', { plan_id: plan.id });
      setReceipt(result);
      onCreated(result.result);
    } catch (failure) {
      if (!expired(failure)) {
        const fields = fieldsOf(failure);
        // The owner's right or the name changed since the plan: back to the form, at the field (A2).
        if (fields) {
          setErrors(fields);
          setPlanned(null);
        } else setProblem(failureMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  if (receipt) {
    const incomplete = receipt.result.setup.state === 'incomplete';
    return (
      <section>
        <h2>{incomplete ? 'Setup incomplete' : 'Project created'}</h2>
        {receipt.warnings.map(warning => (
          <p role="alert" key={warning.code}>
            {warning.message}
          </p>
        ))}
        <p>
          {incomplete
            ? 'The repository exists on Door43 without its first commit. tC Admin cannot retry the commit yet, so the project shows as setup incomplete.'
            : 'Door43 has the repository and its first commit. It can take Door43 a few seconds to list the new project.'}
        </p>
        <p className="muted">Written: {receipt.wrote.map(write => `${WRITE_LABELS[write.kind]} ${write.target}`).join(' · ')}</p>
        <ProjectView project={receipt.result} />
        <p className="actions">
          <a className="button" href={projectHash(receipt.result)}>
            Open the project
          </a>
        </p>
      </section>
    );
  }

  if (planned) {
    const { plan, form: submitted } = planned;
    return (
      <section>
        <p>
          <a href="#">All projects</a>
        </p>
        <h2>Review before creating</h2>
        <p>Nothing has been written to Door43 yet. This is exactly what creating the project will write.</p>
        {problem && <p role="alert">{problem}</p>}
        <dl className="report">
          <dt>Owner</dt>
          <dd>{submitted.owner}</dd>
          <dt>Repository name</dt>
          <dd>
            <code>{plan.preview.repo_name}</code>
          </dd>
          <dt>Project type</dt>
          <dd>{typeLabel(submitted.project_type)}</dd>
          <dt>Plan valid until</dt>
          <dd>{time(plan.expires_at)}</dd>
        </dl>
        <h3>Door43 writes</h3>
        <ul className="writes">
          {plan.would_write.map(write => (
            <li key={`${write.kind}:${write.target}`}>
              {WRITE_LABELS[write.kind]} <code>{write.target}</code>
            </li>
          ))}
        </ul>
        <h3>Files</h3>
        <table className="files">
          <thead>
            <tr>
              <th>Path</th>
              <th>Size</th>
              <th>md5</th>
            </tr>
          </thead>
          <tbody>
            {plan.preview.files.map(file => (
              <tr key={file.path}>
                <td>
                  <code>{file.path}</code>
                </td>
                <td>{file.size.toLocaleString()} bytes</td>
                <td>
                  <code>{file.md5}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>metadata.json</h3>
        <pre className="metadata">{JSON.stringify(plan.preview.metadata_json, null, 2)}</pre>
        {plan.warnings.map(warning => (
          <p role="alert" key={warning.code}>
            {warning.message}
          </p>
        ))}
        <div className="actions">
          <button type="button" onClick={() => void create()} disabled={busy}>
            {busy ? 'Creating the project…' : 'Create the project'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setPlanned(null);
              setProblem(null);
            }}
          >
            Change the details
          </button>
        </div>
      </section>
    );
  }

  const matches = languages ? searchLanguages(languages.list.languages, query, languages.list.owner_languages) : [];
  const bible = form.project_type === 'bible';
  const fieldError = (field: Field) =>
    errors[field] && (
      <p className="field-error" role="alert">
        {errors[field]}
      </p>
    );

  return (
    <form className="create" onSubmit={event => void review(event)}>
      <p>
        <a href="#">All projects</a>
      </p>
      <h2>Create a project</h2>
      <p>A new Scripture Burrito project on Door43. Nothing is written until you have reviewed what will be written.</p>
      {problem && (
        <p role="alert">
          {problem}{' '}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setProblem(null);
              setAttempt(count => count + 1);
            }}
          >
            Try again
          </button>
        </p>
      )}

      <fieldset>
        <legend>Owner</legend>
        {!owners && <p className="muted">Loading your organizations…</p>}
        {owners?.map(owner => (
          <label className="choice" key={owner.login}>
            <input type="radio" name="owner" value={owner.login} checked={form.owner === owner.login} onChange={() => update({ owner: owner.login }, 'owner')} />{' '}
            {owner.kind === 'account' ? `Your account · ${owner.login}` : owner.name === owner.login ? owner.login : `${owner.name} · ${owner.login}`}
          </label>
        ))}
        {fieldError('owner')}
      </fieldset>

      <fieldset>
        <legend>Project type</legend>
        <p className="muted">Chosen once: a project's type cannot be changed later.</p>
        {TYPES.map(type => (
          <label className="choice" key={type}>
            <input type="radio" name="project_type" value={type} checked={form.project_type === type} onChange={() => setForm(previous => withProjectType(previous, type))} />{' '}
            {typeLabel(type)}
          </label>
        ))}
        {fieldError('project_type')}
      </fieldset>

      <fieldset>
        <legend>Name</legend>
        <label className="field" htmlFor={ids.title}>
          Project title
        </label>
        <input id={ids.title} type="text" value={form.title} onChange={event => update({ title: event.target.value }, 'title')} placeholder="The name of the Bible or story collection" />
        {fieldError('title')}
        <label className="field" htmlFor={ids.abbreviation}>
          Abbreviation
        </label>
        <input id={ids.abbreviation} type="text" value={form.abbreviation} onChange={event => update({ abbreviation: event.target.value }, 'abbreviation')} placeholder="Such as ULT" />
        {fieldError('abbreviation')}
        <p className="derived">
          Repository name: <code>{repositoryNameOf(form) ?? '<language>_<abbreviation>'}</code>, from the language and the abbreviation in lowercase.
        </p>
      </fieldset>

      <fieldset>
        <legend>Target language</legend>
        {form.language ? (
          <p className="chosen">
            {languageLabel(form.language)}
            <button type="button" className="secondary" onClick={() => update({ language: null })}>
              Change the language
            </button>
          </p>
        ) : (
          <>
            <label className="field" htmlFor={ids.language}>
              Search by name or tag
            </label>
            <input
              id={ids.language}
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              autoComplete="off"
              disabled={!languages}
              placeholder={languages ? 'Pendau, Bahasa Indonesia, ums…' : 'Loading languages…'}
            />
            {languages && !query.trim() && matches.length > 0 && <p className="derived">Languages {languages.owner} already has repositories in:</p>}
            {matches.length > 0 && (
              <ul className="languages" aria-label="Matching languages">
                {matches.map(language =>
                  language.tag_accepted ? (
                    <li key={language.code}>
                      <button type="button" onClick={() => chooseLanguage(language)}>
                        {languageLabel(language)}
                      </button>
                    </li>
                  ) : (
                    <li key={language.code} className="refused" aria-disabled="true">
                      {languageLabel(language)} <span className="muted">· {tagRefused(language.code)}</span>
                    </li>
                  ),
                )}
              </ul>
            )}
            {languages && query.trim() && matches.length === 0 && <p className="derived">No language matches.</p>}
            {languages && (
              <p className="freshness">
                {languages.list.languages.length.toLocaleString()} languages, read from Door43 at {time(languages.list.freshness.read_at)}.
              </p>
            )}
          </>
        )}
        {fieldError('language')}
      </fieldset>

      {bible && (
        <fieldset>
          <legend>Testament scope</legend>
          <p className="muted">Sets which books the project covers, and so what its coverage counts against.</p>
          {SCOPES.map(scope => (
            <label className="choice" key={scope}>
              <input type="radio" name="testament_scope" value={scope} checked={form.testament_scope === scope} onChange={() => update({ testament_scope: scope }, 'testament_scope')} />{' '}
              {TESTAMENT_SCOPE_LABELS[scope]}
            </label>
          ))}
          {fieldError('testament_scope')}
        </fieldset>
      )}

      {bible && (
        <fieldset>
          <legend>Translation details</legend>
          <p className="muted">What the project's Scripture Burrito metadata records about this translation. The usual values are preselected.</p>
          <DetailSelect field="projectType" value={form.details.projectType} onChange={projectType => update({ details: { ...form.details, projectType } }, 'details')} />
          <DetailSelect field="translationType" value={form.details.translationType} onChange={translationType => update({ details: { ...form.details, translationType } }, 'details')} />
          <DetailSelect field="audience" value={form.details.audience} onChange={audience => update({ details: { ...form.details, audience } }, 'details')} />
          {fieldError('details')}
        </fieldset>
      )}

      <fieldset>
        <legend>License</legend>
        <p>{LICENSE_LABEL}, the one license this version offers. Its text becomes the project's first file.</p>
      </fieldset>

      <div className="actions">
        <button type="submit" disabled={busy || !owners}>
          {busy ? 'Preparing the review…' : 'Review before creating'}
        </button>
        <a href="#">Back to all projects</a>
      </div>
    </form>
  );
}

/** One translation detail as a select of the values the schema enumerates, each in plain words with the value beside it. */
function DetailSelect<Key extends keyof TranslationDetails>({
  field,
  value,
  onChange,
}: {
  field: Key;
  value: TranslationDetails[Key];
  onChange: (value: TranslationDetails[Key]) => void;
}) {
  const options = DETAIL_OPTIONS[field];
  const labels = DETAIL_VALUE_LABELS[field];
  return (
    <label className="field">
      {DETAIL_LABELS[field]}
      <select value={value} onChange={event => onChange(event.target.value as TranslationDetails[Key])}>
        {options.map(option => (
          <option key={option} value={option}>
            {labels[option]} ({option})
          </option>
        ))}
      </select>
    </label>
  );
}
