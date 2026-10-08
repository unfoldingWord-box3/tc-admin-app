// `project.read` and `project.refresh` (operations.md §4, #26): one project's
// complete situation, read live. The repository with its permissions (A2: a
// project the account cannot write is `permission_denied`, as the portfolio
// would not list it, P1, P2), classified from the catalog metadata the
// repository answer carries, with no archive (Q17, `coverage.basis = catalog`);
// the default branch's health from Door43's health check (E15, H1, H3), with
// its issues; the latest full release the catalog names, by its tag; the
// default branch's head; and the preparation under way, from what tC Admin
// stored (#125). tC Admin keeps no cache of any of it (architecture §4), so
// `project.refresh` is the same read, live, and both answer
// `freshness.source = live` (P3).

import { CatalogError, Preparation } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput, ProjectReport } from '@tc-admin/shared/schema';
import { readBranchHead } from '../door43/branches';
import { readHealth } from '../door43/health';
import { repositoryRefs } from '../door43/catalog';
import { readRepository, repositoryAccess } from '../door43/repos';
import { healthOfRead } from '../model/health';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { latestFullRelease } from './planned-commit';
import { isListed, projectSummary } from './portfolio-list';

type ProjectReadOutput = OperationOutput<'project.read'>;

/** The states of a preparation still under way (domain model §6): every state before a release but `discarded`. */
const UNDER_WAY: ReadonlySet<Preparation['state']> = new Set(['selecting', 'snapshot_prepared', 'health_checking', 'health_blocked', 'ready_for_release', 'retryable_failure', 'restart_required']);

const time = (at: string): number => {
  const value = new Date(at).getTime();
  return Number.isNaN(value) ? 0 : value;
};

/** The newest preparation under way for the project, as last stored; `null` when none is (Workers KV lists eventually, #125). */
async function preparationUnderWay(context: OperationContext, owner: string, repo: string): Promise<ProjectReport['active_preparation']> {
  const underWay: Preparation[] = [];
  for (const stored of await context.plans.listPreparations(owner, repo)) {
    const parsed = Preparation.safeParse(stored);
    if (!parsed.success) continue;
    const preparation = parsed.data;
    if (preparation.project_ref.owner.toLowerCase() !== owner.toLowerCase() || preparation.project_ref.repo !== repo) continue;
    if (UNDER_WAY.has(preparation.state)) underWay.push(preparation);
  }
  const lastChanged = (preparation: Preparation) => time(preparation.history.at(-1)?.at ?? preparation.freshness.read_at);
  const newest = underWay.sort((a, b) => lastChanged(b) - lastChanged(a) || b.id.localeCompare(a.id))[0];
  return newest ? { id: newest.id, state: newest.state, version: newest.version.confirmed ?? newest.version.proposed } : null;
}

/** The default branch's head, or `null` for a repository without one (E10): Door43 answers no such branch. */
async function branchHead(context: OperationContext, owner: string, repo: string, branch: string | null | undefined, checkedAt: string): Promise<ProjectReport['default_branch_head']> {
  if (!branch) return null;
  try {
    const head = await readBranchHead(signedIn(context), owner, repo, branch);
    return { sha: head.sha, committed_at: head.committed_at ?? checkedAt };
  } catch (error) {
    if (error instanceof CatalogError && error.code === 'not_found') return null;
    throw error;
  }
}

export async function projectRead(input: ParsedInput<'project.read'>, context: OperationContext): Promise<ProjectReadOutput> {
  const client = signedIn(context);
  const { owner, repo } = input;
  const repository = await readRepository(client, owner, repo);
  // A2, P2: only a project the account may write is reported; one it cannot write is refused, as the portfolio would not list it.
  const access = repositoryAccess(repository);
  if (!isListed(access)) throw new CatalogError('permission_denied', { details: { owner, repo } });

  const checkedAt = context.now().toISOString();
  const summary = projectSummary(repository, access, checkedAt);
  const branch = summary.default_branch;
  // The latest full release's tag, as the catalog names it (E14): Door43 checks every tag (E28), so its health is read beside the branch's (#146).
  const releaseTag = repositoryRefs(repository).latest_full_release?.tag ?? null;
  const [health, releaseHealth, head, release, preparation] = await Promise.all([
    readHealth(client, repository.owner.login, repository.name, branch).then(read => healthOfRead(read, branch, checkedAt)),
    releaseTag ? readHealth(client, repository.owner.login, repository.name, releaseTag).then(read => healthOfRead(read, releaseTag, checkedAt)) : Promise.resolve(null),
    branchHead(context, repository.owner.login, repository.name, branch, checkedAt),
    latestFullRelease(context, repository),
    preparationUnderWay(context, repository.owner.login, repository.name),
  ]);
  return {
    ...summary,
    health,
    latest_full_release: release,
    release_health: release ? releaseHealth : null,
    default_branch_head: head,
    active_preparation: preparation,
    // A repository with no commit on its default branch is a setup that did not finish its first commit (W4), or an empty repository (E10).
    setup: head ? { state: 'complete', failed_step: null } : { state: 'incomplete', failed_step: 'first_commit' },
    freshness: { read_at: checkedAt, source: 'live', age_seconds: 0 },
  };
}

/** `project.refresh`: tC Admin caches nothing, so the refresh is the project's read, live (architecture §4, P3). */
export const projectRefresh = (input: ParsedInput<'project.refresh'>, context: OperationContext): Promise<ProjectReadOutput> => projectRead(input, context);
