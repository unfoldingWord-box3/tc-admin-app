// The commit a plan listed, made once: what `upload.apply` (#75) and
// `import.apply` (#80) share once each has the bytes its plan was computed
// from. In this order, and all before any write: the receipt already stored
// for the plan id, answered as it is (§1 rule 6); the plan, made by this
// account for this project and not expired; the push permission read again
// (A2) and the project still editable (W2); the default branch's head still
// the commit the plan is bound to (R5), and its tree still holding each blob
// the plan replaces. Then one `POST /contents` on the default branch with
// every planned file and the plan's `metadata.json` (W5), as the signed-in
// manager (A3), sent once (X1).
//
// What the plan cannot learn from a lost answer is recorded before the write:
// the attempt, in a key of its own, and after a refusal what became of it, on
// the plan and on the attempt, so either record keeps the refusal. A
// repeated apply of a plan whose commit's outcome is unknown never sends it
// again: it reads the branch, adopts the commit when the head holds every
// planned file blob for blob, and otherwise answers the outcome as still
// unknown, or `source_changed` when someone else moved the branch.

import { CatalogError } from '@tc-admin/shared/schema';
import type { BoundTo, OperationOutput, ProjectReport } from '@tc-admin/shared/schema';
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
import { classifyProject, coverage, editability } from '../model/project';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { RECEIPT_SECONDS, SAME_KEY_WRITE_MS } from './plans';
import type { StoredAttempt, StoredPlan } from './plans';

/** The apply operations that make one planned commit to a project's default branch. */
export type CommitApplyOperation = 'upload.apply' | 'import.apply';
export type CommitPlanOperation = 'upload.plan' | 'import.plan';
export type CommitReceipt = OperationOutput<CommitApplyOperation>;

/** What every plan of such a commit stores: the project, the binding (R5), the branch, and the proposed `metadata.json` whole. */
export interface CommitPayload {
  owner: string;
  repo: string;
  project_type: CreatableProjectType;
  bound_to: BoundTo;
  default_branch: { name: string; sha: string };
  /** `null` when nothing would be written (an upload with no file identified). */
  metadata: { path: string; content: string; size: number; md5: string } | null;
}

/** What became of the commit an attempt sent, recorded on the plan, and a refusal also on the attempt, for that attempt: `failed` when Door43 refused it, `unknown` when it may have made it (X1). */
export interface CommitOutcome {
  outcome: 'failed' | 'unknown';
  door43_status: number | null;
  attempted_at: string;
}

/** A file of the commit by its path and the blob id Door43 will list for it. */
export interface CommitBlob {
  path: string;
  sha: string;
}

/**
 * A plan's payload as the apply keeps it: as the plan stored it, with what became of the last commit sent,
 * and the blob of every file that commit carried, recorded before the write, so a later apply adopts a
 * landed commit without the bytes (X1): an import's source may no longer be served by then.
 */
export type WithOutcome<Payload extends CommitPayload> = Payload & { commit?: CommitOutcome; sent?: CommitBlob[] };

/** One file the commit carries: its path, its bytes, their blob id, and the blob it replaces. */
export interface PlannedCommitFile {
  path: string;
  content: Uint8Array | string;
  sha: string;
  replaces_sha: string | null;
  unit: Unit | null;
}

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const expired = (stored: StoredPlan, now: Date) => new Date(stored.plan.expires_at).getTime() <= now.getTime();

export const planExpired = (planId: string) => new CatalogError('plan_expired', { details: { plan_id: planId } });

/** A plan, or a receipt, made for another project than the one the request names. */
export function anotherProject(owner: string, repo: string): CatalogError {
  return new CatalogError('validation_failed', {
    message: 'plan_id: the plan is for another project.',
    details: { fields: [{ path: 'plan_id', message: 'the plan is for another project' }], plan_owner: owner, plan_repo: repo },
  });
}

/** The branch is not the one the plan was made against (R5): nothing is written, and the manager plans again. */
export const sourceChanged = (where: Record<string, unknown>, reason: string) => new CatalogError('source_changed', { details: { ...where, reason } });

/** The receipt an earlier apply of this plan stored for this account (§1 rule 6), for the project it was made for only; `null` when none. */
export async function storedReceipt(context: OperationContext, operation: CommitApplyOperation, input: { owner: string; repo: string; plan_id: string }, account: string): Promise<CommitReceipt | null> {
  const done = await context.plans.getReceipt<CommitReceipt>(input.plan_id);
  if (!done || done.account !== account || done.receipt.operation !== operation) return null;
  const { ref } = done.receipt.result;
  if (!sameLogin(ref.owner, input.owner) || ref.repo !== input.repo) throw anotherProject(ref.owner, ref.repo);
  return done.receipt;
}

/** The plan as loaded for an apply: the record, its attempt, and whether an earlier apply's commit has an unknown outcome (X1). */
export interface LoadedPlan<Payload extends CommitPayload> {
  stored: StoredPlan<WithOutcome<Payload>>;
  kept: StoredPlan<WithOutcome<Payload>> | null;
  attempt: StoredAttempt<WithOutcome<Payload>> | null;
  payload: WithOutcome<Payload>;
  unknown: boolean;
  /** When the outcome is unknown, the blob of every file the attempt sent, as recorded before the write; `null` when none is recorded. */
  sent: CommitBlob[] | null;
}

/**
 * The plan, or, once its thirty minutes are over, the copy its attempt keeps a day:
 * made by the plan operation named, by this account, for this project, and not
 * expired unless an earlier apply's commit has an unknown outcome, which a later
 * apply must still resolve (X1).
 */
export async function loadPlan<Payload extends CommitPayload>(
  context: OperationContext,
  planOperation: CommitPlanOperation,
  input: { owner: string; repo: string; plan_id: string },
  account: string,
): Promise<LoadedPlan<Payload>> {
  const [kept, attempt] = await Promise.all([
    context.plans.getPlan<WithOutcome<Payload>>(input.plan_id),
    context.plans.getAttempt<WithOutcome<Payload>>(input.plan_id),
  ]);
  const stored = kept ?? attempt?.stored ?? null;
  if (!stored || stored.plan.operation !== planOperation || stored.account !== account) throw planExpired(input.plan_id);
  const payload = stored.payload;
  if (!sameLogin(payload.owner, input.owner) || payload.repo !== input.repo) throw anotherProject(payload.owner, payload.repo);
  // An earlier apply of this plan sent its commit, and Door43's refusal of it is on record neither on the plan nor on the
  // attempt, or its outcome is recorded as unknown (which holds after the attempt's key is gone): what it did is unknown (X1).
  // One predicate for not sending and for adopting.
  const recorded = kept?.payload.commit;
  const refusal = (outcome: CommitOutcome | undefined) => attempt !== null && outcome?.outcome === 'failed' && outcome.attempted_at === attempt.attempted_at;
  const unknown = recorded?.outcome === 'unknown' || (attempt !== null && !refusal(recorded) && !refusal(attempt.stored.payload.commit));
  if (!unknown && expired(stored, context.now())) throw planExpired(input.plan_id);
  // The attempt's own record first; once its key is gone, the plan's, which the outcome's record wrote with the same blobs.
  const sent = unknown ? (attempt?.stored.payload.sent ?? kept?.payload.sent ?? null) : null;
  return { stored, kept, attempt, payload, unknown, sent };
}

/** The plan's `metadata.json` as one file of the commit, with the blob id Door43 will list for it (E19, E45). */
export async function plannedMetadata(payload: CommitPayload, operation: CommitPlanOperation): Promise<PlannedCommitFile> {
  if (!payload.metadata) throw new CatalogError('unexpected', { details: { reason: `an ${operation} with files and no metadata.json` } });
  const { content } = payload.metadata;
  return { path: METADATA_PATH, content, sha: await gitBlobSha(content), replaces_sha: null, unit: null };
}

/**
 * What became of a commit that did not return one: `unknown` when Door43 may have made it anyway (X1).
 * Only a 4xx other than 408 is a refusal; a 5xx or a timeout from the contents call may have committed,
 * as `createRelease` reads the same statuses (releases.ts).
 */
function outcomeOf(error: CatalogError): Omit<CommitOutcome, 'attempted_at'> {
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
async function recordOutcome<Payload extends CommitPayload>(
  context: OperationContext,
  operation: CommitApplyOperation,
  planId: string,
  where: { owner: string; repo: string },
  stored: StoredPlan<WithOutcome<Payload>>,
  attempt: StoredAttempt<WithOutcome<Payload>>,
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
  if (refused.length > 0) logOutcomeNotRecorded(context, operation, planId, where, outcome, refused);
}

/**
 * The line logged when the store refused a record of what became of a commit: the request id, the
 * operation, the plan id, the project, the outcome and Door43's status, and for each refused record its
 * name and the kind of the store's error only; never a token, a file, its bytes, or the error's message (X3).
 */
function logOutcomeNotRecorded(context: OperationContext, operation: CommitApplyOperation, planId: string, where: { owner: string; repo: string }, outcome: CommitOutcome, refused: readonly { record: 'plan' | 'attempt'; cause: unknown }[]): void {
  console.warn(
    JSON.stringify({
      request_id: context.requestId,
      operation,
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
function committedCoverage(payload: CommitPayload, paths: ReadonlySet<string>): ProjectReport['coverage'] {
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
function committedReport(basis: ReportBasis, payload: CommitPayload, head: { sha: string; committed_at: string | null }, checkedAt: string): ProjectReport {
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

/** What an apply hands over once it holds the bytes its plan was computed from. */
export interface PlannedCommit<Payload extends CommitPayload> {
  operation: CommitApplyOperation;
  input: { owner: string; repo: string; plan_id: string };
  /** The signed-in account's login, for the receipt's record. */
  account: string;
  loaded: LoadedPlan<Payload>;
  /** The plan's files with their bytes, each with the blob id Door43 will list for it. */
  files: PlannedCommitFile[];
  /** The plan's `metadata.json` as one file of the commit. */
  metadata: PlannedCommitFile;
  /** The commit's message. */
  message: string;
}

/** The receipt of the commit this plan made, stored under the plan id for a day, so the same plan id answers it again (§1 rule 6). */
async function answer<Payload extends CommitPayload>(
  planned: PlannedCommit<Payload>,
  context: OperationContext,
  basis: ReportBasis,
  commit: { sha: string; url: string; committed_at: string | null } | null,
  head: BranchHead,
  started: Date,
): Promise<CommitReceipt> {
  const { payload } = planned.loaded;
  const finished = context.now();
  const target = `${payload.owner}/${payload.repo}@${payload.default_branch.name}`;
  const receipt: CommitReceipt = {
    operation: planned.operation,
    request_id: context.requestId,
    plan_id: planned.input.plan_id,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    wrote: commit ? [{ kind: 'commit', target, sha: commit.sha, url: commit.url }] : [],
    result: committedReport(basis, payload, commit ?? head, finished.toISOString()),
    warnings: [],
  };
  await context.plans.putReceipt(planned.input.plan_id, { receipt, account: planned.account });
  return receipt;
}

/**
 * The planned commit, made once: the permission and editability read again (A2, W2),
 * the head still the plan's (R5) or an earlier attempt's commit adopted (X1), the tree
 * still holding what the plan replaces, then one `POST /contents` (W5, A3), the attempt
 * recorded before it and its outcome after, and the receipt stored by plan id.
 */
export async function applyPlannedCommit<Payload extends CommitPayload>(planned: PlannedCommit<Payload>, context: OperationContext): Promise<CommitReceipt> {
  const client = signedIn(context);
  const { stored, payload, unknown } = planned.loaded;
  const where = { owner: payload.owner, repo: payload.repo };

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
  const blobs: CommitBlob[] = [...planned.files, planned.metadata].map(({ path, sha }) => ({ path, sha }));
  if (head.sha !== bound) {
    // An earlier apply of this plan may have made this commit and lost the answer: the branch holding every planned file, blob for blob, is it, adopted and never made again (X1).
    // A commit Door43 refused is not adopted: the branch moved, and the plan is planned again (R5).
    if (unknown) {
      const tree = await readTree(client, payload.owner, payload.repo, head.sha);
      if (holdsFiles(planned.loaded.sent ?? blobs, tree.files)) {
        const basis = { repository, coverage: committedCoverage(payload, new Set(tree.files.map(file => file.path))), release: await latestFullRelease(context, repository) };
        return answer(planned, context, basis, { sha: head.sha, url: head.url, committed_at: head.committed_at }, head, context.now());
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
  const basis: ReportBasis = { repository, coverage: committedCoverage(payload, paths), release: await latestFullRelease(context, repository) };

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
  if (changes.length === 0) return answer(planned, context, basis, null, head, started);

  // The attempt, recorded before the write in a key of its own and kept a day, so a later apply of this plan reads before it writes.
  // A store that refuses it stops the apply before the write: unrecorded, a lost answer on an unmoved branch would be sent again (X1).
  const attemptedAt = started.toISOString();
  const plan: WithOutcome<Payload> = { ...payload, sent: blobs };
  delete plan.commit;
  const attemptRecord: StoredAttempt<WithOutcome<Payload>> = { stored: { ...stored, payload: plan }, attempted_at: attemptedAt };
  let attemptWrittenAt: number;
  try {
    await context.plans.putAttempt(planned.input.plan_id, attemptRecord, RECEIPT_SECONDS);
    attemptWrittenAt = Date.now();
  } catch (cause) {
    // Nothing was sent, so the outcome is failed and the plan may be applied again.
    throw new CatalogError('commit_failed', { values: { 'error message': 'the attempt could not be recorded, and nothing was sent' }, cause, details: { ...where, outcome: 'failed', reason: 'attempt_not_recorded' } });
  }

  let commit: Commit;
  try {
    commit = await commitFiles(client, payload.owner, payload.repo, { message: planned.message, files: changes, branch });
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    const outcome: CommitOutcome = { ...outcomeOf(error), attempted_at: attemptedAt };
    await recordOutcome(context, planned.operation, planned.input.plan_id, where, { ...stored, payload: { ...plan, commit: outcome } }, attemptRecord, attemptWrittenAt);
    if (outcome.outcome === 'failed' || error.details.outcome === 'unknown') throw error;
    throw outcomeUnknown({ ...where, door43_status: outcome.door43_status }, 'Door43 did not confirm the commit', error);
  }
  return answer(planned, context, basis, commit, head, started);
}
