// The upload screen's logic (#76, product spec §8) as pure functions, and the
// one call to `upload.apply`. The screen shows `upload.plan`'s answer, the plan
// of record, and confirms exactly that plan: the same files, the same bytes,
// the same confirmations. Every rule is the Worker's; these functions only
// word the plan, say what still blocks the confirmation, and read a refusal.

import { IDEMPOTENCY_HEADER, OPERATIONS, catalogMessage } from '@tc-admin/shared/schema';
import type { OperationDefinition, OperationErrorShape, OperationOutput, RepoRef } from '@tc-admin/shared/schema';
import { multipartBody, operationPath, sendOperation } from './api/client';
import type { Fetch } from './api/client';

export type UploadPlan = OperationOutput<'upload.plan'>;
export type UploadReceipt = OperationOutput<'upload.apply'>;
export type PlannedFile = UploadPlan['preview']['files'][number];
export type MetadataEntryChange = UploadPlan['preview']['metadata_diff']['ingredients'][number];
/** A book or a story, as the plan and the confirmations name it. */
export type Unit = { book: string } | { story: string };
/** The manager's choice of book or story for a file, by the file's name. */
export type Confirmations = Readonly<Record<string, Unit>>;
/** The project types that take uploads: a Bible takes USFM books, Open Bible Stories markdown stories (product spec §8). */
export type UploadType = 'bible' | 'obs';

/** A file the manager chose: its name as the upload sends it and the bytes read once, so the apply resends exactly what was planned (Q33). */
export interface ChosenFile {
  name: string;
  content: Uint8Array;
}

/**
 * The units a held-back file may be named as: the 66 books by their lowercase USFM codes in canonical order, and the
 * 50 stories. A copy of the Worker's list (`worker/src/model/books.ts`), which `web/` may not import; the Worker
 * decides whether a confirmation names a unit.
 */
export const BOOKS: readonly string[] = [
  'gen', 'exo', 'lev', 'num', 'deu', 'jos', 'jdg', 'rut', '1sa', '2sa', '1ki', '2ki', '1ch', '2ch',
  'ezr', 'neh', 'est', 'job', 'psa', 'pro', 'ecc', 'sng', 'isa', 'jer', 'lam', 'ezk', 'dan', 'hos',
  'jol', 'amo', 'oba', 'jon', 'mic', 'nam', 'hab', 'zep', 'hag', 'zec', 'mal',
  'mat', 'mrk', 'luk', 'jhn', 'act', 'rom', '1co', '2co', 'gal', 'eph', 'php', 'col', '1th', '2th',
  '1ti', '2ti', 'tit', 'phm', 'heb', 'jas', '1pe', '2pe', '1jn', '2jn', '3jn', 'jud', 'rev',
];
export const STORIES: readonly string[] = Array.from({ length: 50 }, (_, index) => String(index + 1).padStart(2, '0'));

/** The project types that take uploads; any other project has no "Add books" action. */
export const uploadTypeOf = (projectType: string): UploadType | null => (projectType === 'bible' || projectType === 'obs' ? projectType : null);

/** The unit ids a held-back file may be named as, for the project type. */
export const unitChoices = (type: UploadType): readonly string[] => (type === 'bible' ? BOOKS : STORIES);
export const unitOf = (type: UploadType, id: string): Unit => (type === 'bible' ? { book: id } : { story: id });
export const unitId = (unit: Unit): string => ('book' in unit ? unit.book : unit.story);
/** A unit in the interface: a book by its code in capitals, as the project view lists it; a story by its number. */
export const unitLabel = (unit: Unit): string => ('book' in unit ? unit.book.toUpperCase() : `Story ${unit.story}`);
export const choiceLabel = (type: UploadType, id: string): string => unitLabel(unitOf(type, id));

const NOUNS: Readonly<Record<UploadType, readonly [string, string]>> = { bible: ['book', 'books'], obs: ['story', 'stories'] };
export const unitNoun = (type: UploadType, count: number): string => NOUNS[type][count === 1 ? 0 : 1];

/** The action that opens the upload, in glossary words: "Add books" or "Add stories". */
export const addAction = (type: UploadType): string => `Add ${NOUNS[type][1]}`;

/** The confirm button names the write: "Add 3 books", "Add 1 story". */
export const confirmLabel = (type: UploadType, count: number): string => `Add ${count} ${unitNoun(type, count)}`;

/** What the screen asks for, by project type. */
export const chooseHint = (type: UploadType): string =>
  type === 'bible'
    ? 'Choose USFM files, one per book. Each book is identified from the \\id line in its header, checked against the file name.'
    : 'Choose story files, one markdown file per story, named by its number: 01.md or 1.md for story 1.';

/** Why a file may have been held back, by project type: the plan says only that it identified nothing (product spec §8). */
export function heldBackHint(type: UploadType, name: string): string {
  const lower = name.toLowerCase();
  if (type === 'bible') {
    return lower.endsWith('.usfm')
      ? 'Its \\id line and its file name do not name one and the same book.'
      : 'It is not a USFM file. A Bible project takes one USFM file per book.';
  }
  return lower.endsWith('.md')
    ? 'Its file name is not a story number from 1 to 50.'
    : 'It is not a markdown story file. An Open Bible Stories project takes one markdown file per story.';
}

/** The catalog's message for a held-back file, with its name: the `unidentified_file` text, as `upload.apply` would refuse it. */
export const unidentifiedMessage = (name: string): string => catalogMessage('unidentified_file', undefined, { 'file name': name });

/** A file's name with `.` segments dropped, as the plan returns it (`./a.usfm` is `a.usfm`). */
export const planName = (name: string): string =>
  name
    .split('/')
    .filter(segment => segment !== '.')
    .join('/');
export const sameFile = (a: string, b: string): boolean => planName(a) === planName(b);

/** The files chosen so far with more added: a file of the same name is replaced by the newer one, in its place. */
export function mergeChosen(current: readonly ChosenFile[], added: readonly ChosenFile[]): ChosenFile[] {
  const merged = [...current];
  for (const file of added) {
    const at = merged.findIndex(existing => sameFile(existing.name, file.name));
    if (at >= 0) merged[at] = file;
    else merged.push(file);
  }
  return merged;
}

/** The files without one, and the confirmations without its: a confirmation that names no file of the batch is refused (operations.md `upload.plan`). */
export function withoutFile(files: readonly ChosenFile[], confirmations: Confirmations, name: string): { files: ChosenFile[]; confirmations: Record<string, Unit> } {
  return {
    files: files.filter(file => !sameFile(file.name, name)),
    confirmations: Object.fromEntries(Object.entries(confirmations).filter(([key]) => !sameFile(key, name))),
  };
}

/** The confirmations with one file's choice set, or cleared when `unit` is `null`. */
export function withConfirmation(confirmations: Confirmations, name: string, unit: Unit | null): Record<string, Unit> {
  const rest = Object.fromEntries(Object.entries(confirmations).filter(([key]) => !sameFile(key, name)));
  return unit ? { ...rest, [name]: unit } : rest;
}

export const confirmationOf = (confirmations: Confirmations, name: string): Unit | null =>
  Object.entries(confirmations).find(([key]) => sameFile(key, name))?.[1] ?? null;

/**
 * The key of one overwrite's confirmation: the default branch commit the plan is bound to, the file, the path it
 * replaces, its bytes, and its diff. A new plan that replaces the same path with the same bytes against the same
 * branch commit keeps the manager's confirmation; any change to what is replaced, including a branch that moved while
 * no text diff could show how, asks for it again.
 */
export const overwriteKey = (plan: Pick<UploadPlan, 'bound_to'>, file: PlannedFile): string =>
  [plan.bound_to.default_branch_sha, file.name, file.path ?? '', file.md5, file.diff ?? '\u0000'].join('\n');

export const identifiedFiles = (plan: UploadPlan): PlannedFile[] => plan.preview.files.filter(file => file.identified !== null);
export const heldBackFiles = (plan: UploadPlan): PlannedFile[] => plan.preview.files.filter(file => file.identified === null);
export const overwrites = (plan: UploadPlan): PlannedFile[] => identifiedFiles(plan).filter(file => file.overwrite);

/** What still stands between the plan and its confirmation; empty when the manager may confirm. */
export function confirmBlockers(plan: UploadPlan, type: UploadType, confirmedOverwrites: ReadonlySet<string>): string[] {
  const blockers: string[] = [];
  const held = heldBackFiles(plan);
  if (held.length > 0)
    blockers.push(
      held.length === 1
        ? `${held[0]!.name} is held back: choose its ${unitNoun(type, 1)} or leave the file out.`
        : `${held.length} files are held back: choose the ${unitNoun(type, 1)} for each or leave it out.`,
    );
  const unconfirmed = overwrites(plan).filter(file => !confirmedOverwrites.has(overwriteKey(plan, file)));
  if (unconfirmed.length > 0)
    blockers.push(unconfirmed.length === 1 ? `Confirm that ${unconfirmed[0]!.path} is replaced.` : `Confirm each of the ${unconfirmed.length} files that are replaced.`);
  if (identifiedFiles(plan).length === 0 || plan.would_write.length === 0) blockers.push(`No file is identified as a ${unitNoun(type, 1)} yet, so nothing would be written.`);
  return blockers;
}

export const canConfirm = (plan: UploadPlan, type: UploadType, confirmedOverwrites: ReadonlySet<string>): boolean => confirmBlockers(plan, type, confirmedOverwrites).length === 0;

const list = (files: readonly PlannedFile[]) => files.map(file => unitLabel(file.identified!)).join(', ');

/** The one final operation summary: what the commit adds and replaces, its metadata entries, and where it is written. */
export function uploadSummary(plan: UploadPlan, type: UploadType): string {
  const files = identifiedFiles(plan);
  const added = files.filter(file => !file.overwrite);
  const replaced = files.filter(file => file.overwrite);
  const entries = plan.preview.metadata_diff.ingredients.length;
  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} new ${unitNoun(type, added.length)} (${list(added)})`);
  if (replaced.length > 0) parts.push(`${replaced.length} ${unitNoun(type, replaced.length)} replaced (${list(replaced)})`);
  parts.push(`${entries} ingredient ${entries === 1 ? 'entry' : 'entries'} in metadata.json`);
  const target = plan.would_write.find(write => write.kind === 'commit')?.target;
  return `${target ? `One commit to ${target}` : 'One commit'}: ${parts.join(' · ')}.`;
}

export type DiffLineKind = 'file' | 'hunk' | 'added' | 'removed' | 'context' | 'note';
export interface DiffLine {
  kind: DiffLineKind;
  /** The sign shown in the margin: `+`, `−`, or nothing. */
  sign: string;
  /** The word a screen reader hears for the line, so a line's kind is never color alone. */
  word: string;
  text: string;
}

/** A unified diff's lines, each classified: the file headers, a hunk's range, an added, removed, or unchanged line, a "no newline" note. */
export function diffLines(diff: string): DiffLine[] {
  if (diff === '') return [];
  const lines = diff.endsWith('\n') ? diff.slice(0, -1).split('\n') : diff.split('\n');
  // The `--- a/` and `+++ b/` headers come before the first hunk; after it, a line that starts `---` is a removed `--` line.
  let inHunk = false;
  return lines.map((line): DiffLine => {
    if (!inHunk && (line.startsWith('+++ ') || line.startsWith('--- '))) return { kind: 'file', sign: '', word: 'File', text: line };
    if (line.startsWith('@@')) {
      inHunk = true;
      return { kind: 'hunk', sign: '', word: 'Lines', text: line };
    }
    if (line.startsWith('+')) return { kind: 'added', sign: '+', word: 'Added', text: line.slice(1) };
    if (line.startsWith('-')) return { kind: 'removed', sign: '−', word: 'Removed', text: line.slice(1) };
    if (line.startsWith('\\')) return { kind: 'note', sign: '', word: 'Note', text: line.slice(1).trim() };
    return { kind: 'context', sign: '', word: 'Unchanged', text: line.startsWith(' ') ? line.slice(1) : line };
  });
}

/** How many lines a diff adds and removes, in words. */
export function diffCounts(lines: readonly DiffLine[]): string {
  const added = lines.filter(line => line.kind === 'added').length;
  const removed = lines.filter(line => line.kind === 'removed').length;
  return `${added} ${added === 1 ? 'line' : 'lines'} added · ${removed} removed`;
}

/** A failure as the screen shows it: the catalog's code and message, and, for `validation_failed`, each file at fault with its own message. */
export interface UploadProblem {
  code: string;
  message: string;
  /** Files the refusal names, each with the message for it, in the batch's order. */
  files: { name: string; message: string }[];
  during: 'plan' | 'apply';
}

/**
 * The files a `validation_failed` names (`details.files`, `{ name, reason }`), each with its field message from
 * `details.fields` (`files.<i>.name`, the index in the batch as sent), else its reason. A failure that names no file
 * names none here.
 */
export function problemFiles(error: Pick<OperationErrorShape, 'code' | 'details'>, sent: readonly string[]): { name: string; message: string }[] {
  if (error.code !== 'validation_failed') return [];
  const files = Array.isArray(error.details.files) ? (error.details.files as { name?: unknown; reason?: unknown }[]) : [];
  const fields = Array.isArray(error.details.fields) ? (error.details.fields as { path?: unknown; message?: unknown }[]) : [];
  const byName = new Map<string, string>();
  for (const field of fields) {
    const index = typeof field.path === 'string' ? /^files\.(\d+)\./.exec(field.path)?.[1] : undefined;
    const name = index === undefined ? undefined : sent[Number(index)];
    if (name !== undefined && typeof field.message === 'string' && !byName.has(name)) byName.set(name, field.message);
  }
  const named: { name: string; message: string }[] = [];
  for (const file of files) {
    if (typeof file.name !== 'string' || named.some(entry => sameFile(entry.name, file.name as string))) continue;
    const sentName = sent.find(name => sameFile(name, file.name as string)) ?? file.name;
    const reason = typeof file.reason === 'string' ? file.reason.replace(/_/g, ' ') : 'refused';
    named.push({ name: sentName, message: byName.get(sentName) ?? `${file.name}: ${reason}` });
  }
  for (const [name, message] of byName) if (!named.some(entry => entry.name === name)) named.push({ name, message });
  return named;
}

/** What the screen offers after a failure. */
export type WayForward = 'leave_out' | 'plan_again' | 'back' | 'try_again';

export function wayForward(code: string, during: 'plan' | 'apply'): WayForward {
  if (code === 'validation_failed') return 'leave_out';
  if (code === 'not_editable' || code === 'permission_denied' || code === 'not_found') return 'back';
  // An apply refused or unanswered is never sent again (X1): a new plan reads what Door43 now holds.
  if (during === 'apply' || code === 'plan_expired' || code === 'source_changed' || code === 'unidentified_file') return 'plan_again';
  return 'try_again';
}

/** The way forward in words, beside the catalog's message. */
export function wayForwardText(problem: Pick<UploadProblem, 'code' | 'during' | 'files'>): string {
  switch (problem.code) {
    case 'validation_failed':
      return problem.files.length > 0 ? 'Leave out each file named here, or choose other files, and the upload is planned again.' : 'Change the files chosen, and the upload is planned again.';
    case 'unidentified_file':
      return 'Plan again, then choose the book or story for each held-back file or leave it out.';
    case 'source_changed':
      return 'The default branch changed after this plan was made, and nothing was written. Plan again to review the upload against the branch as it is now.';
    case 'plan_expired':
      return 'Nothing was written. Plan again to review the same files.';
    case 'not_editable':
    case 'permission_denied':
    case 'not_found':
      return 'Nothing was written. Go back to the project.';
    default:
      return problem.during === 'apply'
        ? 'tC Admin does not send the upload again by itself. Plan again to see what the default branch now holds before you confirm.'
        : 'Nothing was written. Try again.';
  }
}

/** A file's name as the upload sends it: its path inside a chosen or dropped folder, else its own name. */
export const uploadName = (file: { name: string; webkitRelativePath?: string }): string => file.webkitRelativePath || file.name;

/**
 * `upload.apply` (#75): the plan id, the same files again with the same bytes, and the confirmations, as one
 * `multipart/form-data` body with the plan id as the idempotency key. This is the one place the web client sends the
 * apply, to align with the schema #75 settles (Q33): the parts are `plan_id`, then `files.<i>.name` and
 * `files.<i>.content` for each file in the order the plan received them, then `confirmations` as JSON.
 */
export function applyUpload(ref: RepoRef, planId: string, files: readonly ChosenFile[], confirmations: Confirmations, fetcher?: Fetch): Promise<UploadReceipt> {
  const route = (OPERATIONS['upload.apply'] as OperationDefinition).route!;
  const body = multipartBody({ plan_id: planId, files: files.map(file => ({ name: file.name, content: file.content })), confirmations });
  return sendOperation('upload.apply', operationPath('upload.apply', ref), { method: route.method, headers: { accept: 'application/json', [IDEMPOTENCY_HEADER]: planId }, body }, fetcher);
}
