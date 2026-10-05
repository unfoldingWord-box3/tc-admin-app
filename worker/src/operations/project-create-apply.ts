// `project.create.apply` (operations.md §4): the first Door43 writes. It takes
// the plan `project.create.plan` stored, re-reads the account and the owner's
// creation right (A2), confirms the name is still free, creates the repository
// and then makes one commit with exactly the plan's files (W5), both with the
// session's token and nothing else (A3), and answers a receipt that lists what
// it wrote and the new project's report. The plan id is the idempotency key:
// a repeated apply answers the stored receipt and writes nothing (operations.md
// §1 rule 6). When the repository was created but the commit failed, or its
// outcome is unknown, nothing is retried (X1) and nothing is deleted (W4): the
// receipt says the setup is incomplete, and the plan is kept for the retry
// (#31) with the created repository, recorded the moment Door43 answered 201
// and before the commit, and with what became of the commit. The report is
// built from what was written, because Door43's catalog
// reads the new repository a few seconds later (E28), and says so: coverage
// from the metadata just written, 0 of the testament scope's books or of the
// fifty stories (H5), health never checked (H3).

import { CatalogError, catalogMessage } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput, ProjectReport } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import { repositoryExists } from '../door43/repos';
import { DEFAULT_BRANCH, commitFiles, createRepository } from '../door43/writes';
import type { Commit, CreatedRepository } from '../door43/writes';
import { FLAVOR_BY_TYPE, LICENSE_PATH, projectScope } from '../model/burrito';
import { coverage, editability } from '../model/project';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { RECEIPT_SECONDS } from './plans';
import type { StoredPlan } from './plans';
import { ownerForCreation } from './project-create-plan';
import type { ProjectCreatePayload } from './project-create-plan';

export type ProjectCreateReceipt = OperationOutput<'project.create.apply'>;

/** The report of a project as it stands right after its creation, from what tC Admin wrote. */
export function createdProjectReport(
  payload: ProjectCreatePayload,
  repository: CreatedRepository,
  commit: Commit | null,
  checkedAt: string,
): ProjectReport {
  const { project } = payload;
  const files = coverage(
    {
      flavor: FLAVOR_BY_TYPE[project.project_type].flavor,
      metadata_format: 'sb',
      ingredients: [{ id: 'license', path: LICENSE_PATH, exists: true, is_dir: false }],
      // A Bible's testament scope widens the coverage scope (H5); the Open Bible Stories scope lists passages, not stories, and the coverage scope is `obs` regardless.
      current_scope: project.project_type === 'bible' ? Object.keys(projectScope(project)) : null,
    },
    project.project_type,
  );
  return {
    ref: { owner: payload.owner.login, repo: payload.repo_name, id: repository.id, url: repository.url },
    title: project.title,
    description: project.title,
    default_branch: repository.default_branch,
    language: { code: project.language.code, title: project.language.title },
    project_type: project.project_type,
    metadata_format: 'sb',
    editability: editability('sb', project.project_type),
    // Counted from the metadata just written, which is the project's Scripture Burrito, not from Door43's catalog, which has not read it yet.
    coverage: { ...files, basis: 'archive' },
    health: { state: 'never_checked', severity_raw: null, ref: repository.default_branch, checked_at: null, issue_count: null, source: 'door43' },
    latest_full_release: null,
    default_branch_head: commit ? { sha: commit.sha, committed_at: commit.committed_at ?? checkedAt } : null,
    active_preparation: null,
    setup: commit ? { state: 'complete', failed_step: null } : { state: 'incomplete', failed_step: 'first_commit' },
    permissions: { push: repository.permissions.push, admin: repository.permissions.admin, checked_at: checkedAt },
    freshness: { read_at: checkedAt, source: 'live', age_seconds: 0 },
  };
}

const expired = (stored: StoredPlan, now: Date) => new Date(stored.plan.expires_at).getTime() <= now.getTime();

/** What became of a first commit that did not return one: `unknown` when Door43 may have made it anyway (X1). */
function commitOutcome(error: CatalogError): NonNullable<ProjectCreatePayload['first_commit']> {
  const status = typeof error.details.door43_status === 'number' ? error.details.door43_status : null;
  const unknown = error.code === 'door43_unavailable' || error.details.outcome === 'unknown';
  return { outcome: unknown ? 'unknown' : 'failed', door43_status: status };
}

export async function projectCreateApply(input: ParsedInput<'project.create.apply'>, context: OperationContext): Promise<ProjectCreateReceipt> {
  const client = signedIn(context);
  const { account } = await readAccount(client);

  // The same plan applied again answers the same receipt and writes nothing (§1 rule 6).
  const done = await context.plans.getReceipt<ProjectCreateReceipt>(input.plan_id);
  if (done && done.account === account.login) return done.receipt;

  const stored = await context.plans.getPlan<ProjectCreatePayload>(input.plan_id);
  if (!stored || stored.plan.operation !== 'project.create.plan' || stored.account !== account.login) {
    throw new CatalogError('plan_expired', { details: { plan_id: input.plan_id } });
  }
  const { payload } = stored;

  // This plan already created its repository, but no receipt is stored: the earlier apply ended before storing one, or is
  // still committing. The repository is not created again, nor is the commit retried (X1): setup is incomplete, the retry is #31.
  // No receipt is stored here, so a receipt the earlier apply stores later is never overwritten.
  if (payload.created_repository) {
    return receiptFor(input.plan_id, context, payload, payload.created_repository, null, context.now());
  }
  if (expired(stored, context.now())) throw new CatalogError('plan_expired', { details: { plan_id: input.plan_id } });

  // The permission at the boundary, read again (A2), and the name, still free.
  const owner = await ownerForCreation(client, account.login, payload.owner.login);
  if (await repositoryExists(client, owner.login, payload.repo_name)) {
    throw new CatalogError('name_taken', { values: { repo_name: payload.repo_name, owner: owner.login }, details: { owner: owner.login, repo_name: payload.repo_name } });
  }

  const started = context.now();
  const repository = await createRepository(client, owner, { name: payload.repo_name, description: payload.project.title });
  // Recorded before the commit, and kept with the receipt for the retry (#31), so a later apply of this plan finds it.
  const marked = { ...payload, repository_created: true, created_repository: repository };
  await context.plans.putPlan({ ...stored, payload: marked }, RECEIPT_SECONDS);

  let commit: Commit | null = null;
  try {
    commit = await commitFiles(client, owner.login, payload.repo_name, {
      message: `Create ${payload.project.title}\n\nmetadata.json, ingredients/license.md, and README.md, written by ${context.application.name} ${context.application.version}.`,
      files: payload.files,
    });
  } catch (error) {
    // The repository exists and is never deleted (W4); the commit is not retried (X1). Setup is incomplete, and the retry (#31) learns what became of it.
    if (!(error instanceof CatalogError)) throw error;
    await context.plans.putPlan({ ...stored, payload: { ...marked, first_commit: commitOutcome(error) } }, RECEIPT_SECONDS);
  }

  const receipt = receiptFor(input.plan_id, context, marked, repository, commit, started);
  await context.plans.putReceipt(input.plan_id, { receipt, account: account.login });
  return receipt;
}

/** The receipt of an apply: the repository, the commit when there is one, else the `setup_incomplete` warning. */
function receiptFor(
  planId: string,
  context: OperationContext,
  payload: ProjectCreatePayload,
  repository: CreatedRepository,
  commit: Commit | null,
  started: Date,
): ProjectCreateReceipt {
  const target = `${payload.owner.login}/${payload.repo_name}`;
  const wrote: ProjectCreateReceipt['wrote'] = [{ kind: 'repo', target, url: repository.url }];
  if (commit) wrote.push({ kind: 'commit', target: `${target}@${DEFAULT_BRANCH}`, sha: commit.sha, url: commit.url });
  const finished = context.now();
  return {
    operation: 'project.create.apply',
    request_id: context.requestId,
    plan_id: planId,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    wrote,
    result: createdProjectReport(payload, repository, commit, finished.toISOString()),
    warnings: commit ? [] : [{ code: 'setup_incomplete', message: catalogMessage('setup_incomplete') }],
  };
}
