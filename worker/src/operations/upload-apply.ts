// `upload.apply` (operations.md §4, #75): the commit `upload.plan` listed,
// made once. The plan stored what it computed from the files, never their
// bytes, so the manager's client sends the same files again, and the apply
// commits only bytes whose size and md5 the plan holds (decided 8 October 2026
// by Rich, Q33). In this order, and all before any write: the batch's names,
// modes, and sizes (W6), as the plan checked them; the account; the receipt
// already stored for this plan id, answered as it is (§1 rule 6); the plan,
// made by this account for this project and not expired; no file held back
// (`unidentified_file`); the confirmations, when sent, the plan's own; every
// file the plan lists sent again with the plan's bytes and no other file.
// Then the planned commit as `planned-commit.ts` makes it: the push permission
// read again (A2) and the project still editable (W2); the default branch's
// head still the commit the plan is bound to (R5), and its tree still holding
// each blob the plan replaces; one `POST /contents` on the default branch with
// every identified file and the plan's `metadata.json` (W5), as the signed-in
// manager (A3), sent once (X1), with the attempt recorded before and its
// outcome after.

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import type { CreatableProjectType, Unit } from '../model/burrito';
import { gitBlobSha } from '../model/git-blob';
import { md5 } from '../model/md5';
import { confirmFile } from '../model/upload';
import { checkUpload, normalizeUploadName } from '../model/upload-paths';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { applyPlannedCommit, loadPlan, plannedMetadata, storedReceipt } from './planned-commit';
import type { CommitOutcome, PlannedCommitFile, WithOutcome } from './planned-commit';
import type { PlannedUpload, UploadPlanPayload } from './upload-plan';

export type UploadReceipt = OperationOutput<'upload.apply'>;

/** What became of the commit an attempt sent (X1); the shared record, named for this operation's tests. */
export type UploadCommitOutcome = CommitOutcome;

/** The plan's payload as the apply keeps it: as `upload.plan` stored it, with what became of the last commit sent. */
export type UploadApplyPayload = WithOutcome<UploadPlanPayload>;

const quoted = (name: string) => JSON.stringify(name);
const unitKey = (unit: Unit) => ('book' in unit ? `book:${unit.book}` : `story:${unit.story}`);
const unitLabel = (unit: Unit) => ('book' in unit ? unit.book.toUpperCase() : `story ${unit.story}`);

/** A file the plan held back has no book or story, and nothing is written until a plan made with the manager's choice lists it (S5, W6). */
function refuseHeldBack(files: readonly PlannedUpload[]): void {
  const held = files.filter(file => file.identified === null || file.path === null);
  if (held.length === 0) return;
  throw new CatalogError('unidentified_file', {
    values: { 'file name': held[0]!.name },
    details: { files: held.map(file => ({ name: file.name, reason: 'unidentified' })) },
  });
}

/**
 * The confirmations, when the client sends them, are exactly the ones the plan was
 * made with: the same files, each confirmed as the same book or story. Anything
 * else is a choice the plan did not show, which the apply never writes (§1 rule 3);
 * the manager plans again with it (built behind, #75).
 */
function checkConfirmations(sent: Readonly<Record<string, Unit>> | undefined, files: readonly PlannedUpload[], type: CreatableProjectType): void {
  if (sent === undefined) return;
  const planned = new Map(files.flatMap(file => (file.confirmed && file.identified ? [[file.name, file.identified] as const] : [])));
  const fields: { path: string; message: string }[] = [];
  const matched = new Set<string>();
  for (const [key, unit] of Object.entries(sent)) {
    const name = normalizeUploadName(key);
    const expected = name.ok ? planned.get(name.path) : undefined;
    const given = name.ok ? confirmFile({ name: name.path, bytes: new Uint8Array() }, unit, type).identified : null;
    if (!name.ok || !expected || !given || unitKey(given) !== unitKey(expected) || matched.has(name.path)) {
      fields.push({ path: `confirmations.${key}`, message: `${quoted(key)} is not a confirmation the plan was made with` });
      continue;
    }
    matched.add(name.path);
  }
  for (const name of planned.keys()) {
    if (!matched.has(name)) fields.push({ path: 'confirmations', message: `${quoted(name)} was confirmed when the plan was made, and is not confirmed here` });
  }
  if (fields.length === 0) return;
  throw new CatalogError('validation_failed', {
    message: `${fields.map(field => `${field.path}: ${field.message}`).join('; ')}. Plan the upload again with these confirmations.`,
    details: { fields, reason: 'confirmations_differ' },
  });
}

/**
 * The bytes of each file the plan lists, sent again (Q33): every file the plan
 * lists is present under its name, with the size and md5 the plan holds, and no
 * file the plan does not list is sent. Every file at fault is named at once.
 */
function sentAgain(received: readonly { name: string; content: Uint8Array }[], files: readonly PlannedUpload[]): Map<string, Uint8Array> {
  const byName = new Map(received.map(file => [file.name, file.content]));
  const planned = new Set(files.map(file => file.name));
  const problems: { name: string; reason: 'missing' | 'content_differs' | 'not_planned'; path: string; message: string }[] = [];
  for (const file of files) {
    const bytes = byName.get(file.name);
    if (!bytes) {
      problems.push({ name: file.name, reason: 'missing', path: 'files', message: `${quoted(file.name)}: the plan lists it, and it was not sent again` });
    } else if (bytes.length !== file.size || md5(bytes) !== file.md5) {
      const index = received.findIndex(sent => sent.name === file.name);
      problems.push({ name: file.name, reason: 'content_differs', path: `files.${index}.content`, message: `${quoted(file.name)}: the bytes are not the ones the plan was made from` });
    }
  }
  received.forEach((file, index) => {
    if (!planned.has(file.name)) problems.push({ name: file.name, reason: 'not_planned', path: `files.${index}.name`, message: `${quoted(file.name)}: the plan does not list it` });
  });
  if (problems.length > 0) {
    const fields = problems.map(({ path, message }) => ({ path, message }));
    throw new CatalogError('validation_failed', {
      message: `${fields.map(field => `${field.path}: ${field.message}`).join('; ')}. Plan the upload again with the files to commit.`,
      details: { fields, files: problems.map(({ name, reason }) => ({ name, reason })) },
    });
  }
  return byName;
}

/** The plan's files with the bytes sent again, each with the blob id Door43 will list for it (E19, E45). */
async function plannedFiles(payload: UploadPlanPayload, bytes: ReadonlyMap<string, Uint8Array>): Promise<PlannedCommitFile[]> {
  return Promise.all(
    payload.files.map(async file => {
      const content = bytes.get(file.name)!;
      return { path: file.path!, content, sha: await gitBlobSha(content), replaces_sha: file.replaces_sha, unit: file.identified };
    }),
  );
}

/** The commit's message: the books or stories, as the plan identified them, and the writer. */
function commitMessage(files: readonly PlannedCommitFile[], type: CreatableProjectType, context: OperationContext): string {
  const units = files.flatMap(file => (file.unit ? [unitLabel(file.unit)] : []));
  const subject = units.length <= 6 ? `Upload ${units.join(', ')}` : `Upload ${units.length} ${type === 'bible' ? 'books' : 'stories'}`;
  return `${subject}\n\nThe uploaded files and metadata.json, written by ${context.application.name} ${context.application.version}.`;
}

export async function uploadApply(input: ParsedInput<'upload.apply'>, context: OperationContext): Promise<UploadReceipt> {
  const client = signedIn(context);
  // W6 first, as the plan checked it: the names as repository-relative paths, the modes, and the sizes of the bytes received.
  const checked = checkUpload(input.files.map(file => ({ name: file.name, size: file.content.length, mode: file.mode, content: file.content })));
  if (!checked.ok) throw checked.error;
  const { account } = await readAccount(client);

  // The same plan applied again answers the same receipt and writes nothing (§1 rule 6), for the project it was made for only.
  const done = await storedReceipt(context, 'upload.apply', input, account.login);
  if (done) return done;

  const loaded = await loadPlan<UploadPlanPayload>(context, 'upload.plan', input, account.login);
  const { payload } = loaded;
  refuseHeldBack(payload.files);
  checkConfirmations(input.confirmations, payload.files, payload.project_type);
  const files = await plannedFiles(payload, sentAgain(checked.files, payload.files));
  const metadata = await plannedMetadata(payload, 'upload.plan');

  return applyPlannedCommit({ operation: 'upload.apply', input, account: account.login, loaded, files, metadata, message: commitMessage(files, payload.project_type, context) }, context);
}
