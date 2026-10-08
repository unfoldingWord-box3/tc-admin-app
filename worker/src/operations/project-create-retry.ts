// `project.create.retry` (operations.md §4, #31): completes the first commit
// of a project whose setup is incomplete, from the plan `project.create.apply`
// kept with its receipt. It never creates or deletes a repository (W4) and
// never commits blind (X1): it reads the repository first, with the account's
// permission in it (A2), and
//   - a repository with no commit gets the plan's files in one commit, once;
//   - a repository whose default branch holds exactly the plan's files has
//     its first commit already, made by an apply whose answer or receipt was
//     lost (Q29's replay case), and that commit is adopted, not made again;
//   - anything else is refused, and nothing is written.
// The repository must be this plan's: recorded on the plan or in the apply's
// receipt, or, when neither shows it (a creation answer that never arrived, a
// record the store refused or does not show yet), adopted only when it is
// empty, under the planned owner, and created no earlier than the attempt the
// apply recorded before the create (decided 6 October 2026 by Rich, Q29);
// otherwise the name reads as taken. The plan id is the idempotency key: a
// retry that completed the setup stores its receipt, and a repeated retry
// answers it and writes nothing (§1 rule 6).

import { CatalogError } from '@tc-admin/shared/schema';
import type { ParsedInput } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import { readBranchHead } from '../door43/branches';
import { readTree } from '../door43/trees';
import { commitFiles, readRepositoryState } from '../door43/writes';
import type { Commit, RepositoryState } from '../door43/writes';
import { gitBlobSha, sameFiles } from '../model/git-blob';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { RECEIPT_SECONDS } from './plans';
import type { StoredAttempt, StoredPlan } from './plans';
import { createdProjectReport, firstCommitMessage, storedPayload } from './project-create-apply';
import type { ProjectCreateReceipt } from './project-create-apply';
import type { ProjectCreatePayload } from './project-create-plan';

export type ProjectCreateRetryReceipt = ProjectCreateReceipt;

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Whether Door43 created the repository no earlier than the attempt began. Door43
 * gives `created_at` to the second (E45), so the attempt is compared at the second
 * it began in; a time that cannot be read proves nothing.
 */
export function createdSinceAttempt(createdAt: string | null, attemptedAt: string): boolean {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  const attempted = Date.parse(attemptedAt);
  if (Number.isNaN(created) || Number.isNaN(attempted)) return false;
  return created >= Math.floor(attempted / 1000) * 1000;
}

/** Q29's adoption rule: a repository this plan cannot show it created is its own only when all three hold. */
export function adoptable(state: RepositoryState, plannedOwner: string, attempt: StoredAttempt | null): boolean {
  if (!attempt || state.owner === null || !sameLogin(state.owner, plannedOwner)) return false;
  return state.empty === true && createdSinceAttempt(state.created_at, attempt.attempted_at);
}

/** A plan, or a retry receipt, that belongs to another project than the one asked for. */
function anotherProject(owner: string, repo: string): CatalogError {
  return new CatalogError('validation_failed', {
    message: 'plan_id: the plan is for another project.',
    details: { fields: [{ path: 'plan_id', message: 'the plan is for another project' }], plan_owner: owner, plan_repo: repo },
  });
}

/** The first commit an earlier apply made, from its receipt, when the receipt lists one. */
function committedByApply(receipt: ProjectCreateReceipt | null): Commit | null {
  const write = receipt?.wrote.find(entry => entry.kind === 'commit');
  if (!receipt || !write?.sha) return null;
  return { sha: write.sha, url: write.url ?? '', committed_at: receipt.result.default_branch_head?.committed_at ?? null, files: [] };
}

export async function projectCreateRetry(input: ParsedInput<'project.create.retry'>, context: OperationContext): Promise<ProjectCreateRetryReceipt> {
  const client = signedIn(context);
  const { account } = await readAccount(client);

  // The same retry again answers the same receipt and writes nothing (§1 rule 6), for the project it was made for only.
  const done = await context.plans.getRetryReceipt<ProjectCreateRetryReceipt>(input.plan_id);
  if (done && done.account === account.login) {
    const { ref } = done.receipt.result;
    if (!sameLogin(ref.owner, input.owner) || ref.repo !== input.repo) throw anotherProject(ref.owner, ref.repo);
    return done.receipt;
  }

  // The plan as the apply left it, or as it stood when the apply began, which the attempt keeps a day (Q29).
  const [kept, attempt, applied] = await Promise.all([
    context.plans.getPlan<ProjectCreatePayload>(input.plan_id),
    context.plans.getAttempt<ProjectCreatePayload>(input.plan_id),
    context.plans.getReceipt<ProjectCreateReceipt>(input.plan_id),
  ]);
  const stored: StoredPlan<ProjectCreatePayload> | null = kept ?? attempt?.stored ?? null;
  if (!stored || stored.plan.operation !== 'project.create.plan' || stored.account !== account.login) {
    throw new CatalogError('plan_expired', { details: { plan_id: input.plan_id } });
  }
  const payload = storedPayload(stored.payload);
  if (!payload) throw new CatalogError('plan_expired', { details: { plan_id: input.plan_id } });
  if (!sameLogin(payload.owner.login, input.owner) || payload.repo_name !== input.repo) throw anotherProject(payload.owner.login, payload.repo_name);
  const receipt = applied && applied.account === account.login ? applied.receipt : null;
  const owner = payload.owner.login;
  const target = `${owner}/${payload.repo_name}`;

  // The repository as Door43 has it now, with the account's permission in it, read before anything is written (A2, X1).
  const started = context.now();
  const state = await readRepositoryState(client, owner, payload.repo_name);
  if (!state.repository.permissions.push) throw new CatalogError('permission_denied', { details: { owner, repo: payload.repo_name } });

  // This plan's own repository, or one Q29's rule lets it adopt; anything else is a name someone else took.
  // A recorded repository is this plan's only while Door43 still names it by the same id: one deleted or moved
  // and replaced under the name is another repository, refused without falling through to adoption.
  const recordedId = payload.created_repository?.id
    ?? (receipt?.wrote.some(entry => entry.kind === 'repo' && entry.target === target) ? receipt.result.ref.id : null);
  if (recordedId !== null && recordedId !== state.repository.id) {
    throw new CatalogError('name_taken', { values: { repo_name: payload.repo_name, owner }, details: { owner, repo_name: payload.repo_name, reason: 'not the repository this plan created' } });
  }
  if (recordedId === null) {
    if (!adoptable(state, owner, attempt)) {
      throw new CatalogError('name_taken', { values: { repo_name: payload.repo_name, owner }, details: { owner, repo_name: payload.repo_name, reason: 'not shown to be this plan\'s repository' } });
    }
    // Recorded before the commit, as the apply records its own, so a later retry finds it even once the repository has a commit.
    await context.plans.putPlan({ ...stored, payload: { ...payload, repository_created: true, created_repository: state.repository } }, RECEIPT_SECONDS);
  }

  let commit: Commit | null = null;
  const wrote: ProjectCreateRetryReceipt['wrote'] = [];
  const earlier = committedByApply(receipt);
  if (earlier) {
    // The apply's own receipt lists its commit: the setup is complete, and nothing is written.
    commit = earlier;
  } else if (state.empty === true) {
    commit = await commitOnce(context, stored, payload, state);
    wrote.push({ kind: 'commit', target: `${target}@${state.repository.default_branch}`, sha: commit.sha, url: commit.url });
  } else if (state.empty === false) {
    commit = await landedCommit(context, payload, state);
  } else {
    throw new CatalogError('door43_unavailable', { details: { owner, repo: payload.repo_name, reason: 'Door43 did not say whether the repository has a commit' } });
  }

  const finished = context.now();
  const answer: ProjectCreateRetryReceipt = {
    operation: 'project.create.retry',
    request_id: context.requestId,
    plan_id: input.plan_id,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    wrote,
    result: createdProjectReport(payload, state.repository, commit, finished.toISOString()),
    warnings: [],
  };
  await context.plans.putRetryReceipt(input.plan_id, { receipt: answer, account: account.login });
  return answer;
}

/**
 * The plan's files in one commit, sent once (X1). A commit Door43 refused is
 * `commit_failed` with its message; one whose answer never arrived or could not
 * be read is `commit_failed` with the outcome unknown, and the next retry reads
 * the repository before it commits again. What became of it is kept on the plan.
 */
async function commitOnce(context: OperationContext, stored: StoredPlan<ProjectCreatePayload>, payload: ProjectCreatePayload, state: RepositoryState): Promise<Commit> {
  try {
    return await commitFiles(signedIn(context), payload.owner.login, payload.repo_name, { message: firstCommitMessage(payload, context), files: payload.files });
  } catch (error) {
    if (!(error instanceof CatalogError) || error.code === 'session_expired' || error.code === 'permission_denied') throw error;
    const unknown = error.code === 'door43_unavailable' || error.details.outcome === 'unknown';
    const status = typeof error.details.door43_status === 'number' ? error.details.door43_status : null;
    try {
      await context.plans.putPlan(
        { ...stored, payload: { ...payload, repository_created: true, created_repository: state.repository, first_commit: { outcome: unknown ? 'unknown' : 'failed', door43_status: status } } },
        RECEIPT_SECONDS,
      );
    } catch {
      // The retry reads the repository before it commits, so a record the store refused costs nothing but the record.
    }
    if (error.code === 'commit_failed') throw error;
    throw new CatalogError('commit_failed', {
      values: { 'error message': 'Door43 did not confirm the commit' },
      cause: error,
      details: { owner: payload.owner.login, repo: payload.repo_name, door43_status: status, outcome: 'unknown' },
    });
  }
}

/**
 * The first commit Door43 already made: the default branch's head commit
 * (`GET /branches/{branch}`, `commit.id` and `timestamp`, E63), whose tree,
 * read at that commit so both describe the same one, holds exactly the plan's
 * files, blob for blob (E19, E45). The tree's own `sha` is the tree object's,
 * never the commit's (E63), so the commit is named by the branch read. A branch
 * with any other files is not this plan's first commit, and nothing is written.
 */
async function landedCommit(context: OperationContext, payload: ProjectCreatePayload, state: RepositoryState): Promise<Commit> {
  const client = signedIn(context);
  const branch = state.repository.default_branch;
  const head = await readBranchHead(client, payload.owner.login, payload.repo_name, branch);
  const tree = await readTree(client, payload.owner.login, payload.repo_name, head.sha);
  const planned = await Promise.all(payload.files.map(async file => ({ path: file.path, sha: await gitBlobSha(file.content) })));
  if (!sameFiles(planned, tree.files)) {
    throw new CatalogError('commit_failed', {
      values: { 'error message': `the ${branch} branch already has files other than this plan's first commit` },
      details: { owner: payload.owner.login, repo: payload.repo_name, outcome: 'failed', reason: 'default branch differs from the plan' },
    });
  }
  return { sha: head.sha, url: head.url, committed_at: head.committed_at, files: tree.files.map(({ path, sha }) => ({ path, sha })) };
}
