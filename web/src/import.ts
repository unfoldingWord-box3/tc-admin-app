// The import screen's logic (#81, product spec §8 "Import from an existing
// repository") as pure functions. The manager finds an owner (`owner.search`:
// their own organizations first, any owner by partial name), picks one of its
// Bible or Open Bible Stories repositories (`source.search`) at its latest
// content or its last release, picks all or some of its books or stories, and
// reviews `import.plan`'s answer, the plan of record, before `import.apply`
// writes exactly that plan. Every rule is the Worker's; these functions only
// word the choices and the plan, say what still blocks the confirmation, and
// read a refusal.

import type { OperationOutput } from '@tc-admin/shared/schema';
import { formatLabel, typeLabel } from './portfolio-labels';
import { overwriteKey, unitLabel, unitNoun } from './upload';
import type { UploadType } from './upload';

export type ImportPlan = OperationOutput<'import.plan'>;
export type ImportReceipt = OperationOutput<'import.apply'>;
export type ImportedFile = ImportPlan['preview']['files'][number];
export type SourceRelationship = ImportPlan['preview']['metadata_diff']['relationships'][number];
export type OwnerSearch = OperationOutput<'owner.search'>;
export type Account = OwnerSearch['own'][number];
export type SourceSearch = OperationOutput<'source.search'>;
export type Source = SourceSearch['sources'][number];
/** Which content of a source is offered: its default branch (`latest`) or its last full release (`prod`), product spec §8 step 3. */
export type Stage = Source['stage'];

/** The action that opens the import, in glossary words: "Import books" or "Import stories". */
export const importAction = (type: UploadType): string => `Import ${unitNoun(type, 2)}`;

/** The confirm button names the write: "Import 3 books", "Import 1 story". */
export const importConfirmLabel = (type: UploadType, count: number): string => `Import ${count} ${unitNoun(type, count)}`;

export const STAGE_LABELS: Readonly<Record<Stage, string>> = { latest: 'Latest content', prod: 'Last release' };
export const STAGE_HINTS: Readonly<Record<Stage, string>> = {
  latest: 'The default branch as it is now, released or not.',
  prod: 'The last full release only. A repository that was never released is not offered.',
};

/**
 * The owners to offer: the account's own organizations first and always, then every other owner the catalog matched,
 * once each by login (an organization of the account that the search also matched is listed once, among the own).
 */
export function ownerChoices(answer: OwnerSearch): { own: Account[]; matches: Account[] } {
  const seen = new Set(answer.own.map(account => account.login.toLowerCase()));
  const matches = answer.matches.filter(account => {
    const key = account.login.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { own: answer.own, matches };
}

/** An owner in the interface: its display name, with its login when the two differ. */
export const ownerLabel = (account: Account): string => (account.name && account.name !== account.login ? `${account.name} (${account.login})` : account.login);

/** A source's revision in words: its release tag, or its default branch. */
export const revisionLabel = (source: Pick<Source, 'revision'>): string => ('tag' in source.revision ? `release ${source.revision.tag}` : `branch ${source.revision.branch}`);

/** The revision `import.plan` is asked for: the tag or the branch name, as `source.search` offered it. */
export const revisionOf = (source: Pick<Source, 'revision'>): string => ('tag' in source.revision ? source.revision.tag : source.revision.branch);

/** What a source is: its type and format, whether it was ever released, and the revision offered; so the manager can tell a Resource Container from a Scripture Burrito and an unreleased repository from a released one (Q25). */
export function sourceFacts(source: Source): string[] {
  return [typeLabel(source.project_type), formatLabel(source.metadata_format), source.released ? 'Released' : 'Never released', revisionLabel(source)];
}

/** Whether the source is of the project's type: a Bible project imports from a Bible repository, an Open Bible Stories project from an Open Bible Stories one; the plan refuses a mismatch, so the screen says so before any plan. */
export const sourceMatches = (source: Pick<Source, 'project_type'>, type: UploadType): boolean => source.project_type === type;

export const mismatchText = (source: Pick<Source, 'project_type'>, type: UploadType): string =>
  `${typeLabel(source.project_type) === 'Open Bible Stories' ? 'An' : 'A'} ${typeLabel(source.project_type)} repository cannot be imported into ${type === 'obs' ? 'an' : 'a'} ${typeLabel(type)} project.`;

/** A book or story the source itemizes, as offered for choosing. */
export type Offered = NonNullable<Source['books']>[number];

/** The label of an offered unit: the book's code in capitals with its title, or the story's number. */
export const offeredLabel = (type: UploadType, unit: Offered): string => {
  const id = unitLabel(type === 'bible' ? { book: unit.id } : { story: unit.id });
  return unit.title && unit.title.toLowerCase() !== unit.id.toLowerCase() ? `${id} · ${unit.title}` : id;
};

/**
 * The `units` `import.plan` takes. The Worker's contract: `all` is every book or story the source's archive holds
 * at its Scripture Burrito path, which may be more than the catalog itemizes (`source.search`'s `books`, E35); a list
 * is exactly those ids. So `all` is sent only when Door43 itemizes nothing and the archive is the only list there is,
 * and otherwise the chosen ids are sent, every one of them checked or not, so the plan never grows past the
 * checkboxes (bench round 1 on #137). An empty choice is no plan.
 */
export function unitsInput(source: Pick<Source, 'books'>, chosen: ReadonlySet<string>): ImportPlanUnits | null {
  if (source.books === null) return 'all';
  if (chosen.size === 0) return null;
  return source.books.map(unit => unit.id).filter(id => chosen.has(id));
}
export type ImportPlanUnits = 'all' | string[];

/** What the units chooser says when the source itemizes nothing: the plan reads the archive (E35, E36). */
export const notItemizedText = (type: UploadType): string =>
  `Door43 does not list this repository's ${unitNoun(type, 2)}. Every ${unitNoun(type, 1)} its archive holds is imported.`;

export const importedFiles = (plan: ImportPlan): ImportedFile[] => plan.preview.files;
export const overwrites = (plan: ImportPlan): ImportedFile[] => plan.preview.files.filter(file => file.overwrite);

/** What still stands between the plan and its confirmation; empty when the manager may confirm. */
export function importBlockers(plan: ImportPlan, confirmedOverwrites: ReadonlySet<string>): string[] {
  const blockers: string[] = [];
  const unconfirmed = overwrites(plan).filter(file => !confirmedOverwrites.has(overwriteKey(plan, file)));
  if (unconfirmed.length > 0)
    blockers.push(unconfirmed.length === 1 ? `Confirm that ${unconfirmed[0]!.path} is replaced.` : `Confirm each of the ${unconfirmed.length} files that are replaced.`);
  if (plan.preview.files.length === 0 || plan.would_write.length === 0) blockers.push('Nothing would be written.');
  return blockers;
}

export const canConfirmImport = (plan: ImportPlan, confirmedOverwrites: ReadonlySet<string>): boolean => importBlockers(plan, confirmedOverwrites).length === 0;

/** The units of the files, by name; a file the plan did not identify, which the Worker never lists for an import, is named by its path rather than thrown on. */
const list = (files: readonly ImportedFile[]) => files.map(file => (file.identified ? unitLabel(file.identified) : file.name)).join(', ');

/** The source relationship the commit records, in words: "Source recorded: bahtraku/id_tb1 at 1974." */
export function relationshipText(plan: ImportPlan): string {
  const { source } = plan.preview;
  const added = plan.preview.metadata_diff.relationships[0];
  const at = added ? added.revision : source.revision;
  return added ? `Source recorded in metadata.json: ${source.owner}/${source.repo} at ${at}.` : `Source already recorded in metadata.json: ${source.owner}/${source.repo} at ${at}.`;
}

/** The one final operation summary: what the commit adds and replaces, its metadata entries, the source, and where it is written. */
export function importSummary(plan: ImportPlan, type: UploadType): string {
  const files = plan.preview.files;
  const added = files.filter(file => !file.overwrite);
  const replaced = files.filter(file => file.overwrite);
  const entries = plan.preview.metadata_diff.ingredients.length;
  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} new ${unitNoun(type, added.length)} (${list(added)})`);
  if (replaced.length > 0) parts.push(`${replaced.length} ${unitNoun(type, replaced.length)} replaced (${list(replaced)})`);
  parts.push(`${entries} ingredient ${entries === 1 ? 'entry' : 'entries'} in metadata.json`);
  parts.push(`from ${plan.preview.source.owner}/${plan.preview.source.repo} at ${plan.preview.source.revision}`);
  const target = plan.would_write.find(write => write.kind === 'commit')?.target;
  return `${target ? `One commit to ${target}` : 'One commit'}: ${parts.join(' · ')}.`;
}

/** A failure as the screen shows it: the catalog's code and message, and during which step. */
export interface ImportProblem {
  code: string;
  message: string;
  during: 'owners' | 'sources' | 'plan' | 'apply';
}

/** What the screen offers after a failure. */
export type ImportWayForward = 'choose_again' | 'plan_again' | 'back' | 'try_again';

export function importWayForward(code: string, during: ImportProblem['during']): ImportWayForward {
  if (code === 'not_editable' || code === 'permission_denied') return 'back';
  // An apply refused or unanswered, whatever the code, is never sent again (X1): a new plan reads what Door43 and the source now hold.
  if (during === 'apply' || code === 'plan_expired' || code === 'source_changed') return 'plan_again';
  if (code === 'validation_failed' || code === 'not_found') return 'choose_again';
  return 'try_again';
}

/** The way forward in words, beside the catalog's message. */
export function importWayForwardText(problem: Pick<ImportProblem, 'code' | 'during'>): string {
  switch (problem.code) {
    case 'validation_failed':
      return problem.during === 'apply' ? 'Nothing was written. Plan again to review the import as things are now.' : 'Nothing was written. Choose the source or its books again.';
    case 'not_found':
      return problem.during === 'apply' ? 'Nothing was written. Plan again to review the import as things are now.' : 'Nothing was written. The source repository was not found: choose another.';
    case 'source_unavailable':
      return problem.during === 'apply'
        ? 'Nothing was written. Door43 could not serve the source\'s archive; plan again in a moment to review the import as things are now.'
        : 'Nothing was written. Door43 could not serve the source\'s archive; try again in a moment.';
    case 'source_changed':
      return problem.during === 'apply'
        ? 'Nothing was written. The project or the source changed after this plan was made. Plan again to review the import as things are now.'
        : 'Plan again to review the import against the default branch as it is now.';
    case 'plan_expired':
      return 'Nothing was written. Plan again to review the same import.';
    case 'not_editable':
    case 'permission_denied':
      return 'Nothing was written. Go back to the project.';
    default:
      return problem.during === 'apply'
        ? 'tC Admin does not send the import again by itself. Plan again to see what the project and the source now hold before you confirm.'
        : 'Nothing was written. Try again.';
  }
}
