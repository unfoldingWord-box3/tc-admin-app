// `upload.apply` (operations.md §4, #75): the commit `upload.plan` listed,
// made once. The plan stored what it computed from the files, never their
// bytes, so the manager's client sends the same files again, and the apply
// commits only bytes whose size and md5 the plan holds (decided 8 October 2026
// by Rich, Q33). In this order, and all before any write: the batch's names,
// modes, and sizes (W6), as the plan checked them; the account; the receipt
// already stored for this plan id, answered as it is (§1 rule 6); the plan,
// made by this account for this project and not expired; no file held back
// (`unidentified_file`); the confirmations, when sent, the plan's own; every
// file the plan lists sent again with the plan's bytes and no other file; the
// push permission read again (A2) and the project still editable (W2); the
// default branch's head still the commit the plan is bound to (R5), and its
// tree still holding each blob the plan replaces. Then one `POST /contents` on
// the default branch with every identified file and the plan's
// `metadata.json` (W5), as the signed-in manager (A3), sent once (X1).
//
// What the plan cannot learn from a lost answer is recorded before the write:
// the attempt, in a key of its own, and after a refusal what became of it, on
// the plan and on the attempt, so either record keeps the refusal. A
// repeated apply of a plan whose commit's outcome is unknown never sends it
// again: it reads the branch, adopts the commit when the head holds every
// planned file blob for blob, and otherwise answers the outcome as still
// unknown, or `source_changed` when someone else moved the branch.

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput, ProjectReport } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import { readBranchHead } from '../door43/branches';
import type { BranchHead } from '../door43/branches';
import { projectCatalog, repositoryIdentity, repositoryRefs } from '../door43/catalog';
import { readPublishedRelease } from '../door43/releases';
import { readRepository, repositoryAccess } from '../door43/repos';
import type { Door43SearchRepository } from '../door43/repos';
import { readTree } from '../door43/trees';
import type { TreeFile } from '../door43/trees';
import { commitFiles } from '../door43/writes';
import type { Commit, CommitFile } from '../door43/writes';
import { FLAVOR_BY_TYPE, METADATA_PATH } from '../model/burrito';
import type { CreatableProjectType, Unit } from '../model/burrito';
import { parseMetadata } from '../model/burrito-reader';
import { gitBlobSha, holdsFiles } from '../model/git-blob';
import { md5 } from '../model/md5';
import { classifyProject, coverage, editability } from '../model/project';
import { confirmFile } from '../model/upload';
import { checkUpload, normalizeUploadName } from '../model/upload-paths';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { RECEIPT_SECONDS, SAME_KEY_WRITE_MS } from './plans';
import type { StoredAttempt, StoredPlan } from './plans';
import type { PlannedUpload, UploadPlanPayload } from './upload-plan';

export type UploadReceipt = OperationOutput<'upload.apply'>;

/** What became of the commit an attempt sent, recorded on the plan, and a refusal also on the attempt, for that attempt: `failed` when Door43 refused it, `unknown` when it may have made it (X1). */
export interface UploadCommitOutcome {
  outcome: 'failed' | 'unknown';
  door43_status: number | null;
  attempted_at: string;
}

/** The plan's payload as the apply keeps it: as `upload.plan` stored it, with what became of the last commit sent. */
export type UploadApplyPayload = UploadPlanPayload & { commit?: UploadCommitOutcome };

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const quoted = (name: string) => JSON.stringify(name);
const unitKey = (unit: Unit) => ('book' in unit ? `book:${unit.book}` : `story:${unit.story}`);
const unitLabel = (unit: Unit) => ('book' in unit ? unit.book.toUpperCase() : `story ${unit.story}`);
const expired = (stored: StoredPlan, now: Date) => new Date(stored.plan.expires_at).getTime() <= now.getTime();

const planExpired = (planId: string) => new CatalogError('plan_expired', { details: { plan_id: planId } });

/** A plan, or a receipt, made for another project than the one the request names. */
function anotherProject(owner: string, repo: string): CatalogError {
  return new CatalogError('validation_failed', {
    message: 'plan_id: the plan is for another project.',
    details: { fields: [{ path: 'plan_id', message: 'the plan is for another project' }], plan_owner: owner, plan_repo: repo },
  });
}

/** The branch is not the one the plan was made against (R5): nothing is written, and the manager plans again. */
const sourceChanged = (where: Record<string, unknown>, reason: string) => new CatalogError('source_changed', { details: { ...where, reason } });

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

/** One file the commit carries: its path, its bytes, their blob id, and the blob it replaces. */
interface Planned {
  path: string;
  content: Uint8Array | string;
  sha: string;
  replaces_sha: string | null;
  unit: Unit | null;
}

/** The plan's files with the bytes sent again, and its `metadata.json`, each with the blob id Door43 will list for it (E19, E45). */
async function plannedFiles(payload: UploadPlanPayload, bytes: ReadonlyMap<string, Uint8Array>): Promise<{ files: Planned[]; metadata: Planned }> {
  if (!payload.metadata) throw new CatalogError('unexpected', { details: { reason: 'an upload plan with identified files and no metadata.json' } });
  const files = await Promise.all(
    payload.files.map(async file => {
      const content = bytes.get(file.name)!;
      return { path: file.path!, content, sha: await gitBlobSha(content), replaces_sha: file.replaces_sha, unit: file.identified };
    }),
  );
  const { content } = payload.metadata;
  return { files, metadata: { path: METADATA_PATH, content, sha: await gitBlobSha(content), replaces_sha: null, unit: null } };
}

/** The commit's message: the books or stories, as the plan identified them, and the writer. */
function commitMessage(files: readonly Planned[], type: CreatableProjectType, context: OperationContext): string {
  const units = files.flatMap(file => (file.unit ? [unitLabel(file.unit)] : []));
  const subject = units.length <= 6 ? `Upload ${units.join(', ')}` : `Upload ${units.length} ${type === 'bible' ? 'books' : 'stories'}`;
  return `${subject}\n\nThe uploaded files and metadata.json, written by ${context.application.name} ${context.application.version}.`;
}

/**
 * What became of a commit that did not return one: `unknown` when Door43 may have made it anyway (X1).
 * Only a 4xx other than 408 is a refusal; a 5xx or a timeout from the contents call may have committed,
 * as `createRelease` reads the same statuses (releases.ts).
 */
function outcomeOf(error: CatalogError): Omit<UploadCommitOutcome, 'attempted_at'> {
  const status = typeof error.details.door43_status === 'number' ? error.details.door43_status : null;
  const refused = status !== null && status >= 400 && status < 500 && status !== 408;
  const unknown = error.code === 'door43_unavailable' || error.details.outcome === 'unknown' || (error.code === 'commit_failed' && !refused);
  return { outcome: unknown ? 'unknown' : 'failed', door43_status: status };
}

/** The commit's outcome unknown, answered as such (X1): the next apply of this plan reads the branch before anything else. */
function outcomeUnknown(where: Record<string, unknown>, message: string, cause?: unknown): CatalogError {
  return new CatalogError('commit_failed', { values: { 'error message': message }, cause, details: { ...where, outcome: 'unknown' } });
}

/**
 * What became of the commit, recorded on the plan, and a refusal also on the attempt the apply recorded
 * before the write, so a refusal either store write keeps is never read as an unknown outcome and never
 * adopted (X1). The attempt's second write waits out Workers KV's one write a second to a key. A record the
 * store refuses still fails closed: a refusal recorded nowhere reads as unknown, and the next apply reads
 * before it writes and never writes again. Each refused record is logged in one JSON line, as `logFailure`
 * logs a failure (worker/src/http/errors.ts), at warning level since the apply answers as it would have.
 */
async function recordOutcome(
  context: OperationContext,
  planId: string,
  where: { owner: string; repo: string },
  stored: StoredPlan<UploadApplyPayload>,
  attempt: StoredAttempt<UploadApplyPayload>,
  attemptWrittenAt: number,
): Promise<void> {
  const outcome = stored.payload.commit!;
  const refused: { record: 'plan' | 'attempt'; cause: unknown }[] = [];
  try {
    await context.plans.putPlan(stored, RECEIPT_SECONDS);
  } catch (cause) {
    refused.push({ record: 'plan', cause });
  }
  if (outcome.outcome === 'failed') {
    const wait = attemptWrittenAt + SAME_KEY_WRITE_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    try {
      await context.plans.putAttempt(planId, { ...attempt, stored }, RECEIPT_SECONDS);
    } catch (cause) {
      refused.push({ record: 'attempt', cause });
    }
  }
  if (refused.length > 0) logOutcomeNotRecorded(context, planId, where, outcome, refused);
}

/**
 * The line logged when the store refused a record of what became of a commit: the request id, the
 * operation, the plan id, the project, the outcome and Door43's status, and for each refused record its
 * name and the kind of the store's error only; never a token, a file, its bytes, or the error's message (X3).
 */
function logOutcomeNotRecorded(context: OperationContext, planId: string, where: { owner: string; repo: string }, outcome: UploadCommitOutcome, refused: readonly { record: 'plan' | 'attempt'; cause: unknown }[]): void {
  console.warn(
    JSON.stringify({
      request_id: context.requestId,
      operation: 'upload.apply',
      event: 'commit_outcome_not_recorded',
      plan_id: planId,
      owner: where.owner,
      repo: where.repo,
      outcome: outcome.outcome,
      door43_status: outcome.door43_status,
      not_recorded: refused.map(({ record, cause }) => ({ record, kind: cause instanceof Error ? cause.name : typeof cause })),
    }),
  );
}

/**
 * The latest full release the catalog names (E14), read by its tag for when and by
 * whom it was published; `null` when the catalog names none or Door43 has none
 * under that tag. Read before the write, so nothing after it can fail the apply.
 */
async function latestFullRelease(context: OperationContext, repository: Door43SearchRepository): Promise<ProjectReport['latest_full_release']> {
  const named = repositoryRefs(repository).latest_full_release;
  if (!named) return null;
  const release = await readPublishedRelease(signedIn(context), repository.owner.login, repository.name, named.tag);
  if (!release) return null;
  return { tag: release.tag, version: release.tag, sha: release.sha || named.sha, published_at: release.published_at ?? named.released_at ?? '', author: release.author ?? '' };
}

/**
 * File coverage from the `metadata.json` the commit carries (basis `archive`, H5):
 * each book or story it lists is present when the branch holds its path after the
 * commit, which is the tree the plan was bound to with the committed paths added.
 */
function uploadedCoverage(payload: UploadPlanPayload, paths: ReadonlySet<string>): ProjectReport['coverage'] {
  const metadata = parseMetadata(payload.metadata!.content);
  const type = payload.project_type;
  const ingredients = metadata.ingredients.flatMap(ingredient => (ingredient.unit === null ? [] : [{ id: ingredient.unit, path: ingredient.path, exists: paths.has(ingredient.path), is_dir: false }]));
  const files = coverage({ flavor: FLAVOR_BY_TYPE[type].flavor, metadata_format: 'sb', ingredients, current_scope: type === 'bible' ? Object.keys(metadata.current_scope) : null }, type);
  return { ...files, basis: 'archive' };
}

/** What the receipt reports besides the commit, gathered before the write. */
interface ReportBasis {
  repository: Door43SearchRepository;
  coverage: ProjectReport['coverage'];
  release: ProjectReport['latest_full_release'];
}

/**
 * The project as the commit left it, from what was read before the write and what
 * was written: the repository's identity and permissions, the coverage of the
 * metadata committed, the latest full release, and the commit as the head. The
 * new head's health has not been read (`never_checked`, H3), and no preparation
 * is read (`active_preparation: null`; `preparation.list` is the authority).
 */
function uploadedReport(basis: ReportBasis, payload: UploadPlanPayload, head: { sha: string; committed_at: string | null }, checkedAt: string): ProjectReport {
  const access = repositoryAccess(basis.repository);
  return {
    ...repositoryIdentity(basis.repository),
    project_type: payload.project_type,
    metadata_format: 'sb',
    editability: editability('sb', payload.project_type),
    coverage: basis.coverage,
    health: { state: 'never_checked', severity_raw: null, ref: head.sha, checked_at: null, issue_count: null, issues: null, source: 'door43' },
    latest_full_release: basis.release,
    default_branch_head: { sha: head.sha, committed_at: head.committed_at ?? checkedAt },
    active_preparation: null,
    setup: { state: 'complete', failed_step: null },
    permissions: { push: access.push, admin: access.admin, checked_at: checkedAt },
    freshness: { read_at: checkedAt, source: 'live', age_seconds: 0 },
  };
}

/** The receipt of the commit this plan made, stored under the plan id for a day, so the same plan id answers it again (§1 rule 6). */
async function answer(
  input: ParsedInput<'upload.apply'>,
  context: OperationContext,
  account: string,
  payload: UploadPlanPayload,
  basis: ReportBasis,
  commit: { sha: string; url: string; committed_at: string | null } | null,
  head: BranchHead,
  started: Date,
): Promise<UploadReceipt> {
  const finished = context.now();
  const target = `${payload.owner}/${payload.repo}@${payload.default_branch.name}`;
  const receipt: UploadReceipt = {
    operation: 'upload.apply',
    request_id: context.requestId,
    plan_id: input.plan_id,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    wrote: commit ? [{ kind: 'commit', target, sha: commit.sha, url: commit.url }] : [],
    result: uploadedReport(basis, payload, commit ?? head, finished.toISOString()),
    warnings: [],
  };
  await context.plans.putReceipt(input.plan_id, { receipt, account });
  return receipt;
}

export async function uploadApply(input: ParsedInput<'upload.apply'>, context: OperationContext): Promise<UploadReceipt> {
  const client = signedIn(context);
  // W6 first, as the plan checked it: the names as repository-relative paths, the modes, and the sizes of the bytes received.
  const checked = checkUpload(input.files.map(file => ({ name: file.name, size: file.content.length, mode: file.mode, content: file.content })));
  if (!checked.ok) throw checked.error;
  const { account } = await readAccount(client);

  // The same plan applied again answers the same receipt and writes nothing (§1 rule 6), for the project it was made for only.
  const done = await context.plans.getReceipt<UploadReceipt>(input.plan_id);
  if (done && done.account === account.login && done.receipt.operation === 'upload.apply') {
    const { ref } = done.receipt.result;
    if (!sameLogin(ref.owner, input.owner) || ref.repo !== input.repo) throw anotherProject(ref.owner, ref.repo);
    return done.receipt;
  }

  // The plan, or, once its thirty minutes are over, the copy its attempt keeps a day.
  const [kept, attempt] = await Promise.all([
    context.plans.getPlan<UploadApplyPayload>(input.plan_id),
    context.plans.getAttempt<UploadApplyPayload>(input.plan_id),
  ]);
  const stored: StoredPlan<UploadApplyPayload> | null = kept ?? attempt?.stored ?? null;
  if (!stored || stored.plan.operation !== 'upload.plan' || stored.account !== account.login) throw planExpired(input.plan_id);
  const payload = stored.payload;
  if (!sameLogin(payload.owner, input.owner) || payload.repo !== input.repo) throw anotherProject(payload.owner, payload.repo);
  const where = { owner: payload.owner, repo: payload.repo };
  // An earlier apply of this plan sent its commit, and Door43's refusal of it is on record neither on the plan nor on the
  // attempt, or its outcome is recorded as unknown (which holds after the attempt's key is gone): what it did is unknown (X1).
  // One predicate for not sending and for adopting.
  const recorded = kept?.payload.commit;
  const refusal = (outcome: UploadCommitOutcome | undefined) => attempt !== null && outcome?.outcome === 'failed' && outcome.attempted_at === attempt.attempted_at;
  const unknown = recorded?.outcome === 'unknown' || (attempt !== null && !refusal(recorded) && !refusal(attempt.stored.payload.commit));
  if (!unknown && expired(stored, context.now())) throw planExpired(input.plan_id);

  refuseHeldBack(payload.files);
  checkConfirmations(input.confirmations, payload.files, payload.project_type);
  const planned = await plannedFiles(payload, sentAgain(checked.files, payload.files));

  // The permission at the boundary, read again and strictly (A2), and the project still one tC Admin writes (W2).
  const repository = await readRepository(client, payload.owner, payload.repo);
  const access = repositoryAccess(repository);
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: where });
  const classified = classifyProject(projectCatalog(repository));
  if (classified.editability.state !== 'editable' || classified.project_type === 'other') {
    throw new CatalogError('not_editable', { message: classified.editability.reason, details: { ...where, project_type: classified.project_type, metadata_format: classified.metadata_format } });
  }
  if (classified.project_type !== payload.project_type) throw sourceChanged(where, 'the project type is not the one planned');

  // The default branch's head, read from the branch (E63), is the commit the plan is bound to (R5).
  const branch = payload.default_branch.name;
  if (repository.default_branch !== branch) throw sourceChanged(where, 'the default branch is not the one planned');
  const head = await readBranchHead(client, payload.owner, payload.repo, branch);
  const bound = payload.bound_to.default_branch_sha;
  const blobs = [...planned.files, planned.metadata].map(({ path, sha }) => ({ path, sha }));
  if (head.sha !== bound) {
    // An earlier apply of this plan may have made this commit and lost the answer: the branch holding every planned file, blob for blob, is it, adopted and never made again (X1).
    // A commit Door43 refused is not adopted: the branch moved, and the plan is planned again (R5).
    if (unknown) {
      const tree = await readTree(client, payload.owner, payload.repo, head.sha);
      if (holdsFiles(blobs, tree.files)) {
        const basis = { repository, coverage: uploadedCoverage(payload, new Set(tree.files.map(file => file.path))), release: await latestFullRelease(context, repository) };
        return answer(input, context, account.login, payload, basis, { sha: head.sha, url: head.url, committed_at: head.committed_at }, head, context.now());
      }
    }
    throw sourceChanged({ ...where, bound, head: head.sha }, 'the default branch moved since the plan');
  }
  if (unknown) {
    // The branch has not moved: the commit has not landed, or not yet. It is not sent again (X1); a later apply reads again, or the manager plans again.
    throw outcomeUnknown(where, 'Door43 did not confirm the commit, and the default branch does not show it');
  }

  // The tree at the bound commit: each file the plan overwrites is still the blob it replaces, each new one still absent, and metadata.json there (R5).
  const tree = await readTree(client, payload.owner, payload.repo, head.sha);
  const onBranch = new Map(tree.files.map((file: TreeFile) => [file.path, file.sha]));
  for (const file of planned.files) {
    if ((onBranch.get(file.path) ?? null) !== file.replaces_sha) throw sourceChanged({ ...where, path: file.path }, 'the file is not the one the plan replaces');
  }
  const metadataSha = onBranch.get(METADATA_PATH);
  if (!metadataSha) throw sourceChanged(where, 'no metadata.json on the default branch');
  const paths = new Set([...onBranch.keys(), ...planned.files.map(file => file.path)]);
  const basis: ReportBasis = { repository, coverage: uploadedCoverage(payload, paths), release: await latestFullRelease(context, repository) };

  // One commit (W5): each new file created and each overwrite updated by the blob it replaces, so Door43 refuses a file
  // that changed after this read; a file whose bytes are already the branch's is left as it is, and so is metadata.json when unchanged.
  const changes: CommitFile[] = [];
  for (const file of planned.files) {
    if (file.sha === file.replaces_sha) continue;
    changes.push(file.replaces_sha ? { path: file.path, content: file.content, operation: 'update', sha: file.replaces_sha } : { path: file.path, content: file.content, operation: 'create' });
  }
  if (planned.metadata.sha !== metadataSha) changes.push({ path: METADATA_PATH, content: planned.metadata.content, operation: 'update', sha: metadataSha });

  const started = context.now();
  // Every byte is already the branch's: nothing to write, and the receipt says so.
  if (changes.length === 0) return answer(input, context, account.login, payload, basis, null, head, started);

  // The attempt, recorded before the write in a key of its own and kept a day, so a later apply of this plan reads before it writes.
  // A store that refuses it stops the apply before the write: unrecorded, a lost answer on an unmoved branch would be sent again (X1).
  const attemptedAt = started.toISOString();
  const plan: UploadApplyPayload = { ...payload };
  delete plan.commit;
  const attemptRecord: StoredAttempt<UploadApplyPayload> = { stored: { ...stored, payload: plan }, attempted_at: attemptedAt };
  let attemptWrittenAt: number;
  try {
    await context.plans.putAttempt(input.plan_id, attemptRecord, RECEIPT_SECONDS);
    attemptWrittenAt = Date.now();
  } catch (cause) {
    // Nothing was sent, so the outcome is failed and the plan may be applied again.
    throw new CatalogError('commit_failed', { values: { 'error message': 'the attempt could not be recorded, and nothing was sent' }, cause, details: { ...where, outcome: 'failed', reason: 'attempt_not_recorded' } });
  }

  let commit: Commit;
  try {
    commit = await commitFiles(client, payload.owner, payload.repo, { message: commitMessage(planned.files, payload.project_type, context), files: changes, branch });
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    const outcome: UploadCommitOutcome = { ...outcomeOf(error), attempted_at: attemptedAt };
    await recordOutcome(context, input.plan_id, where, { ...stored, payload: { ...plan, commit: outcome } }, attemptRecord, attemptWrittenAt);
    if (outcome.outcome === 'failed' || error.details.outcome === 'unknown') throw error;
    throw outcomeUnknown({ ...where, door43_status: outcome.door43_status }, 'Door43 did not confirm the commit', error);
  }
  return answer(input, context, account.login, payload, basis, commit, head, started);
}
