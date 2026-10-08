// `import.apply` (operations.md §4, #80): the commit `import.plan` listed,
// made once. The plan stored what it computed from the source's archive,
// never the bytes, so the apply reads the source's Scripture Burrito archive
// again by the ref the plan recorded (a release tag, or the default branch's
// head commit) and commits only bytes whose size and md5 the plan holds; a
// source file that is no longer what the plan showed is `source_changed`, and
// an archive Door43 cannot serve `source_unavailable`. The source is read and
// never written (W2). In this order, and all before any write: the account;
// the receipt already stored for this plan id, answered as it is (§1 rule 6);
// the plan, made by this account for this project and not expired; the
// source's archive and every planned file's bytes. Then the planned commit as
// `planned-commit.ts` makes it: the push permission read again (A2) and the
// project still editable (W2); the default branch's head still the commit the
// plan is bound to (R5), and its tree still holding each blob the plan
// replaces; one `POST /contents` on the project's default branch with every
// imported file and the plan's `metadata.json` (W5), as the signed-in manager
// (A3), sent once (X1), with the attempt recorded before and its outcome after.

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readArchive } from '../door43/archive';
import type { Archive } from '../door43/archive';
import type { Door43Client } from '../door43/api';
import { readAccount } from '../door43/auth';
import type { CreatableProjectType, Unit } from '../model/burrito';
import { gitBlobSha } from '../model/git-blob';
import { md5 } from '../model/md5';
import type { OperationContext } from './context';
import { signedIn } from './context';
import type { ImportPlanPayload } from './import-plan';
import { applyPlannedCommit, loadPlan, plannedMetadata, storedReceipt } from './planned-commit';
import type { PlannedCommitFile, WithOutcome } from './planned-commit';

export type ImportReceipt = OperationOutput<'import.apply'>;

/** The plan's payload as the apply keeps it: as `import.plan` stored it, with what became of the last commit sent. */
export type ImportApplyPayload = WithOutcome<ImportPlanPayload>;

const unitLabel = (unit: Unit) => ('book' in unit ? unit.book.toUpperCase() : `story ${unit.story}`);

/** The source's archive at the ref the plan recorded, or `source_unavailable` for any failure of Door43 to serve it. */
async function sourceArchive(client: Door43Client, source: ImportPlanPayload['source']): Promise<Archive> {
  try {
    return await readArchive(client, source.owner, source.repo, source.archive_ref);
  } catch (error) {
    if (error instanceof CatalogError && (error.code === 'not_found' || error.code === 'door43_unavailable')) {
      throw new CatalogError('source_unavailable', { details: { source: { owner: source.owner, repo: source.repo, revision: source.revision, ref: source.archive_ref }, ...error.details }, cause: error });
    }
    throw error;
  }
}

/**
 * The plan's files with their bytes read again from the source's archive, each
 * the size and md5 the plan holds (else `source_changed`: the source is not what
 * the plan showed, and the manager plans again), with the blob id Door43 will
 * list for it (E19). One file is inflated at a time (Q22).
 */
async function plannedFiles(client: Door43Client, payload: ImportPlanPayload): Promise<PlannedCommitFile[]> {
  const archive = await sourceArchive(client, payload.source);
  const where = { owner: payload.owner, repo: payload.repo, source: { owner: payload.source.owner, repo: payload.source.repo, revision: payload.source.revision, ref: payload.source.archive_ref } };
  const files: PlannedCommitFile[] = [];
  for (const file of payload.files) {
    let content: Uint8Array;
    try {
      content = await archive.bytes(file.source_path);
    } catch (error) {
      if (error instanceof CatalogError && error.code === 'not_found') {
        throw new CatalogError('source_changed', { variant: 'source', details: { ...where, path: file.source_path, reason: 'the source no longer holds the file the plan took' } });
      }
      if (error instanceof CatalogError && error.code === 'door43_unavailable') {
        throw new CatalogError('source_unavailable', { details: { ...where, path: file.source_path, ...error.details }, cause: error });
      }
      throw error;
    }
    if (content.length !== file.size || md5(content) !== file.md5) {
      throw new CatalogError('source_changed', { variant: 'source', details: { ...where, path: file.source_path, reason: 'the source file is not the one the plan showed' } });
    }
    files.push({ path: file.path, content, sha: await gitBlobSha(content), replaces_sha: file.replaces_sha, unit: file.identified });
  }
  return files;
}

/** The commit's message, from the plan's files (the bytes fetched are for the contents body only): the books or stories imported, the source and its revision, and the writer. */
function commitMessage(files: readonly { identified: Unit }[], payload: ImportPlanPayload, type: CreatableProjectType, context: OperationContext): string {
  const units = files.map(file => unitLabel(file.identified));
  const what = units.length <= 6 ? units.join(', ') : `${units.length} ${type === 'bible' ? 'books' : 'stories'}`;
  const from = `${payload.source.owner}/${payload.source.repo}@${payload.source.revision}`;
  return `Import ${what} from ${from}\n\nThe imported files and metadata.json, with the source relationship, written by ${context.application.name} ${context.application.version}.`;
}

export async function importApply(input: ParsedInput<'import.apply'>, context: OperationContext): Promise<ImportReceipt> {
  const client = signedIn(context);
  const { account } = await readAccount(client);

  // The same plan applied again answers the same receipt and writes nothing (§1 rule 6), for the project it was made for only.
  const done = await storedReceipt(context, 'import.apply', input, account.login);
  if (done) return done;

  const loaded = await loadPlan<ImportPlanPayload>(context, 'import.plan', input, account.login);
  const { payload } = loaded;
  // The bytes before any read of the project, as an upload's are checked first: the source's archive, read and never written (W2).
  // A commit whose outcome is unknown is never sent again (X1), so its bytes are not needed: the blob ids its attempt recorded
  // before the write decide whether the branch holds it, and the source need not still be served.
  const files = loaded.unknown && loaded.sent ? [] : await plannedFiles(client, payload);
  const metadata = await plannedMetadata(payload, 'import.plan');

  return applyPlannedCommit({ operation: 'import.apply', input, account: account.login, loaded, files, metadata, message: commitMessage(payload.files, payload, payload.project_type, context) }, context);
}
