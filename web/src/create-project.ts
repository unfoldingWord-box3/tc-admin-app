// The creation wizard's logic, pure so it can be tested without a browser
// (product spec §6, #28): the owner it starts with, the form and its defaults,
// the plan input it sends, which field a failure belongs to (X2), the
// language search over `language.list` (Q20), the words for the translation
// details and the writes, and the retry of a first commit when the setup is
// incomplete (#31, Q29). The Worker owns every rule; what is
// mirrored here is for feedback before a plan is asked for (invariants.md).

import {
  TEXT_TRANSLATION_AUDIENCES,
  TEXT_TRANSLATION_FLAVOR_DEFAULTS,
  TEXT_TRANSLATION_PROJECT_TYPES,
  TEXT_TRANSLATION_TYPES,
} from '@tc-admin/shared/schema';
import type { OperationErrorShape, OperationInput, OperationOutput, ProjectSummary, WriteKind } from '@tc-admin/shared/schema';

export type Language = OperationOutput<'language.list'>['languages'][number];
export type CreatableType = 'bible' | 'obs';
export type TestamentScope = 'nt' | 'ot' | 'full';
/** The translation details with every field chosen, as the form holds them. */
export interface TranslationDetails {
  projectType: (typeof TEXT_TRANSLATION_PROJECT_TYPES)[number];
  translationType: (typeof TEXT_TRANSLATION_TYPES)[number];
  audience: (typeof TEXT_TRANSLATION_AUDIENCES)[number];
}
type Organizations = OperationOutput<'portfolio.list'>['organizations'];

/** The wizard's address, so a reload or the back button keeps it; one segment, so it is never a project's (`#/<owner>/<repo>`). */
export const CREATE_HASH = '#/new';

/** An owner the wizard offers: one `owner.list` returned, which is one the account may create a project in (E43). */
export type Owner = OperationOutput<'owner.list'>['owners'][number];

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The owner a wizard starts with: the only one offered, when there is only one; else none, so the manager chooses. */
export function initialOwner(owners: readonly Owner[]): string {
  return owners.length === 1 ? owners[0]!.login : '';
}

export interface Form {
  owner: string;
  project_type: CreatableType;
  title: string;
  abbreviation: string;
  language: Language | null;
  testament_scope: TestamentScope | null;
  details: TranslationDetails;
}

/** An Open Bible Stories project is abbreviated OBS unless the manager says otherwise (#82); a Bible's abbreviation is the manager's. */
export const ABBREVIATION_DEFAULTS: Readonly<Record<CreatableType, string>> = { bible: '', obs: 'OBS' };

export function newForm(owner: string): Form {
  return { owner, project_type: 'bible', title: '', abbreviation: '', language: null, testament_scope: null, details: { ...TEXT_TRANSLATION_FLAVOR_DEFAULTS } };
}

/** The form after a change of project type: the abbreviation default follows unless the manager wrote one, and Open Bible Stories has no testament scope (Q25). */
export function withProjectType(form: Form, type: CreatableType): Form {
  const untouched = form.abbreviation.trim() === '' || form.abbreviation.trim().toLowerCase() === ABBREVIATION_DEFAULTS[form.project_type].toLowerCase();
  return {
    ...form,
    project_type: type,
    abbreviation: untouched ? ABBREVIATION_DEFAULTS[type] : form.abbreviation,
    testament_scope: type === 'obs' ? null : form.testament_scope,
  };
}

/** The repository name the Worker will derive, `<language>_<abbreviation>` in lowercase (product spec §6), shown as the manager types; `null` until both are given. */
export function repositoryNameOf(form: Pick<Form, 'language' | 'abbreviation'>): string | null {
  const abbreviation = form.abbreviation.trim();
  if (!form.language || !abbreviation) return null;
  return `${form.language.code.toLowerCase()}_${abbreviation.toLowerCase()}`;
}

export type Field = 'owner' | 'project_type' | 'title' | 'abbreviation' | 'language' | 'testament_scope' | 'details';
export type FieldErrors = Partial<Record<Field, string>>;

/**
 * Why a tag is not one the Scripture Burrito schema accepts, in the manager's words
 * (decided 6 October 2026 by Rich, Q30): the schema takes language tags as BCP 47
 * defines them, and Door43's list has tags with a part over eight characters
 * (`xdy-x-dayaklaur`), an empty part (`iba-x-`, `-x-`), or a space. The Worker owns
 * the rule (`worker/src/model/language.ts`); this names the cause for the label.
 */
export function tagProblem(code: string): string {
  if (/\s/.test(code)) return 'it contains a space';
  const parts = code.split('-');
  if (parts.some(part => part === '')) return 'it has an empty part';
  const long = parts.find(part => part.length > 8);
  if (long) return `its part "${long}" is ${long.length} characters long, and a language tag allows at most 8 in each part`;
  return 'it is not in the form the standard allows';
}

/** The label for a language whose tag the schema refuses: the tag, why, and that no project can be created in it yet (Q30). */
export const tagRefused = (code: string) => `The tag ${code} is not a language tag Scripture Burrito accepts (BCP 47): ${tagProblem(code)}. A project cannot be created in this language yet.`;

/** What the form still lacks, in the Worker's own words where it has them, so the manager hears one message for one lack. */
export function missing(form: Form): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.owner) errors.owner = 'Choose an owner.';
  if (!form.title.trim()) errors.title = 'Give the project a title.';
  if (!form.abbreviation.trim()) errors.abbreviation = 'Give the project an abbreviation, such as ULT.';
  if (!form.language) errors.language = 'Choose a language from the list.';
  else if (!form.language.tag_accepted) errors.language = tagRefused(form.language.code);
  if (form.project_type === 'bible' && !form.testament_scope) errors.testament_scope = 'Choose a testament scope for a Bible project.';
  return errors;
}

/** The input of `project.create.plan` for the form: a Bible carries its testament scope and translation details, Open Bible Stories neither. */
export function planInput(form: Form & { language: Language }): OperationInput<'project.create.plan'> {
  const bible = form.project_type === 'bible';
  return {
    owner: form.owner,
    project_type: form.project_type,
    title: form.title.trim(),
    abbreviation: form.abbreviation.trim(),
    language: { code: form.language.code, title: form.language.title, direction: form.language.direction },
    testament_scope: bible ? form.testament_scope : null,
    flavor: bible ? { ...form.details } : null,
    license: 'cc-by-sa-4.0',
  };
}

const FIELD_OF_PATH: Readonly<Record<string, Field>> = {
  owner: 'owner',
  project_type: 'project_type',
  title: 'title',
  abbreviation: 'abbreviation',
  language: 'language',
  'language.code': 'language',
  'language.title': 'language',
  'language.direction': 'language',
  testament_scope: 'testament_scope',
  flavor: 'details',
  'flavor.projectType': 'details',
  'flavor.translationType': 'details',
  'flavor.audience': 'details',
};

/**
 * The field a failure belongs to, with its message, so it is shown in place (X2):
 * a `validation_failed` names its fields in `details.fields`; `name_taken` is
 * answered by changing the abbreviation (or the owner); `permission_denied` from
 * a plan means the owner allows no creation (A2). Anything else is `null`: not a
 * field's, and shown for the whole form.
 */
export function fieldErrors(error: OperationErrorShape): FieldErrors | null {
  if (error.code === 'name_taken') return { abbreviation: error.message };
  if (error.code === 'permission_denied') return { owner: error.message };
  if (error.code !== 'validation_failed') return null;
  const fields = Array.isArray(error.details.fields) ? (error.details.fields as { path?: unknown; message?: unknown }[]) : [];
  const errors: FieldErrors = {};
  for (const entry of fields) {
    const field = typeof entry.path === 'string' ? FIELD_OF_PATH[entry.path] : undefined;
    if (field && errors[field] === undefined) errors[field] = typeof entry.message === 'string' && entry.message ? entry.message : error.message;
  }
  return Object.keys(errors).length ? errors : null;
}

/** How well a language answers a query: an exact tag, a tag or name that starts with it, a name or alternate name that contains it; `null` when it does not. */
function rank(language: Language, query: string): number | null {
  const code = language.code.toLowerCase();
  if (code === query) return 0;
  const names = [language.title, language.english].filter(Boolean).map(name => name.toLowerCase());
  if (code.startsWith(query) || names.some(name => name.startsWith(query))) return 1;
  if (code.includes(query) || names.some(name => name.includes(query)) || language.alternates.some(name => name.toLowerCase().includes(query))) return 2;
  return null;
}

/**
 * The languages for a query, by tag, native name, English name, and alternate names
 * (Q20): an exact tag first, then the owner's own languages, then the better match,
 * each group in Door43's order. With no query, the owner's languages alone. A language
 * whose tag the schema refuses is listed too, so the wizard can say why it cannot be
 * chosen (Q30).
 */
export function searchLanguages(languages: readonly Language[], query: string, ownerLanguages: readonly string[] | null, limit = 20): Language[] {
  const wanted = query.trim().toLowerCase();
  const own = new Set((ownerLanguages ?? []).map(code => code.toLowerCase()));
  if (!wanted) return languages.filter(language => own.has(language.code.toLowerCase())).slice(0, limit);
  return languages
    .flatMap((language, index) => {
      const score = rank(language, wanted);
      return score === null ? [] : [{ language, key: [score === 0 ? 0 : 1, own.has(language.code.toLowerCase()) ? 0 : 1, score, index] }];
    })
    .sort((a, b) => a.key[0]! - b.key[0]! || a.key[1]! - b.key[1]! || a.key[2]! - b.key[2]! || a.key[3]! - b.key[3]!)
    .slice(0, limit)
    .map(entry => entry.language);
}

/** A language as one line: native name, English name when it differs, tag, and the direction when it is right to left. */
export function languageLabel(language: Language): string {
  const parts = [language.title];
  if (language.english && language.english !== language.title) parts.push(language.english);
  parts.push(language.code);
  if (language.direction === 'rtl') parts.push('right to left');
  return parts.join(' · ');
}

export const TESTAMENT_SCOPE_LABELS: Readonly<Record<TestamentScope, string>> = {
  nt: 'New Testament (27 books)',
  ot: 'Old Testament (39 books)',
  full: 'Old and New Testament (66 books)',
};

/** The translation details (CONTEXT.md): the field names in glossary words, never "project type", which is Bible or Open Bible Stories. */
export const DETAIL_LABELS: Readonly<Record<keyof TranslationDetails, string>> = {
  projectType: 'Kind of project',
  translationType: 'Translation type',
  audience: 'Audience',
};

/** The values each detail may take, the schema's enumerations in the schema's order. */
export const DETAIL_OPTIONS: { readonly [Key in keyof TranslationDetails]: readonly TranslationDetails[Key][] } = {
  projectType: TEXT_TRANSLATION_PROJECT_TYPES,
  translationType: TEXT_TRANSLATION_TYPES,
  audience: TEXT_TRANSLATION_AUDIENCES,
};

/** The schema's values in plain words; the value itself is shown beside, since it is what the metadata carries. */
export const DETAIL_VALUE_LABELS: { readonly [Key in keyof TranslationDetails]: Readonly<Record<TranslationDetails[Key], string>> } = {
  projectType: {
    standard: 'Standard',
    daughter: 'Daughter translation',
    studyBible: 'Study Bible',
    studyBibleAdditions: 'Study Bible additions',
    backTranslation: 'Back translation',
    auxiliary: 'Auxiliary',
    transliterationManual: 'Transliteration, manual',
    transliterationWithEncoder: 'Transliteration, with an encoder',
  },
  translationType: {
    firstTranslation: 'First translation',
    newTranslation: 'New translation',
    revision: 'Revision',
    studyOrHelpMaterial: 'Study or help material',
  },
  audience: {
    basic: 'Basic',
    common: 'Common',
    'common-literary': 'Common and literary',
    literary: 'Literary',
    liturgical: 'Liturgical',
    children: 'Children',
  },
};

/** The one license this version offers (Q20). */
export const LICENSE_LABEL = 'CC BY-SA 4.0';

/** A plan's `would_write` entry in words: what kind of Door43 write, and where. */
export const WRITE_LABELS: Readonly<Record<WriteKind, string>> = { repo: 'Repository', branch: 'Branch', commit: 'Commit', tag: 'Tag', release: 'Release' };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

const isListed = (organizations: Organizations, created: ProjectSummary) =>
  organizations.some(group => group.projects.some(project => sameLogin(project.ref.owner, created.ref.owner) && project.ref.repo === created.ref.repo));

/**
 * The project just created after a portfolio read: kept while Door43's catalog does
 * not list it yet, and retired once a read lists it, so a later read that leaves it
 * out (access removed, repository archived) is not overridden by the creation.
 */
export function retireCreated(organizations: Organizations, created: ProjectSummary | null): ProjectSummary | null {
  return created && isListed(organizations, created) ? null : created;
}

/**
 * The portfolio with a project just created shown in its owner's group, since
 * Door43's catalog lists a new repository a few seconds after it is created (E28,
 * E45), so the project appears in the portfolio at once (S1). A project the
 * portfolio already lists is not added twice; a new group for an organization goes
 * before the account's own, which the portfolio lists last.
 */
export function withCreated(organizations: Organizations, created: ProjectSummary | null, accountLogin: string): Organizations {
  if (!created || isListed(organizations, created)) return organizations;
  const group = organizations.find(entry => sameLogin(entry.name, created.ref.owner));
  if (group) {
    return organizations.map(entry => (entry === group ? { ...entry, projects: [...entry.projects, created].sort((a, b) => byName(a.ref.repo, b.ref.repo)) } : entry));
  }
  const added = { name: created.ref.owner, projects: [created] };
  const ownIndex = organizations.findIndex(entry => sameLogin(entry.name, accountLogin));
  if (sameLogin(created.ref.owner, accountLogin) || ownIndex < 0) return [...organizations, added];
  return [...organizations.slice(0, ownIndex), added, ...organizations.slice(ownIndex)];
}

type Receipt = OperationOutput<'project.create.apply'>;

/**
 * The input of `project.create.retry` for a receipt whose setup is incomplete
 * (W4, #31): its project and the plan the apply kept, which is also the retry's
 * idempotency key; `null` when the setup is complete or the receipt names no plan.
 */
export function retryInput(receipt: Receipt): OperationInput<'project.create.retry'> | null {
  if (receipt.result.setup.state !== 'incomplete' || !receipt.plan_id) return null;
  return { owner: receipt.result.ref.owner, repo: receipt.result.ref.repo, plan_id: receipt.plan_id };
}

/** The receipt's heading and what it means, in glossary words: Setup incomplete (product spec §6, §11) or created. */
export function receiptSummary(receipt: Receipt): { heading: string; text: string } {
  if (receipt.result.setup.state === 'incomplete') {
    return {
      heading: 'Setup incomplete',
      text: 'The repository exists on Door43, and its first commit failed or could not be confirmed. tC Admin does not delete the repository. Retrying reads the repository first, so a commit Door43 already made is not made twice.',
    };
  }
  return { heading: 'Project created', text: 'Door43 has the repository and its first commit. It can take Door43 a few seconds to list the new project.' };
}

/**
 * A failure after which Door43 may have done what was asked anyway (X1): no answer
 * arrived (Door43 unavailable, or the network), or the Worker failed unexpectedly.
 * After a creation that ended so, the repository may exist although the plan
 * does not know it (Q29).
 */
export function outcomeUnknown(error: OperationErrorShape | null): boolean {
  return error === null || error.code === 'door43_unavailable' || error.code === 'unexpected';
}

/**
 * What the wizard does with a failed `project.create.apply`: a taken name, after an
 * earlier apply of the same plan whose outcome is unknown, may be the repository
 * that apply created, so the retry is offered to reconcile it (decided 6 October
 * 2026 by Rich, Q29); a failure a field answers for goes back to the form; anything
 * else is shown on the review.
 */
export function applyFailure(error: OperationErrorShape | null, earlierUnknown: boolean): 'reconcile' | 'field' | 'problem' {
  if (error?.code === 'name_taken' && earlierUnknown) return 'reconcile';
  if (error && fieldErrors(error)) return 'field';
  return 'problem';
}

/** Why the retry is offered for a taken name (Q29), and what it checks before it writes. */
export const reconcileText = (owner: string, repo: string) =>
  `Door43 did not answer when tC Admin asked it to create the repository, and a repository named ${repo} now exists in ${owner}. If this plan created it, retrying the first commit finishes the setup. tC Admin writes to it only if it is empty, belongs to ${owner}, and was created after this attempt.`;
