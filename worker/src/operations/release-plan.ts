// `release.plan` (operations.md §4): candidate detection and everything the
// manager needs to decide, with no writes (ADR 0011). Reads the repository
// for its baseline tag and default-branch head (E14), the catalog entry for
// each ref to map book to path (E20), and the recursive git tree for each ref
// (E19), then groups books by blob SHA (E18) with the plan's default
// selection (R4), the proposed version (R9), and a notes draft. The plan is
// bound to the two commits it was computed from (R5) and stored with what
// `release.prepare` needs. Only a writable, editable project is releasable
// (A2, W2, P2): an unsupported one is `not_releasable` with its reason.

import { CatalogError } from '@tc-admin/shared/schema';
import type { BoundTo, OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import { projectCatalog, readCatalogEntry, repositoryRefs } from '../door43/catalog';
import { readRepository, repositoryAccess } from '../door43/repos';
import { readTree } from '../door43/trees';
import { detectCandidates, removals } from '../model/candidates';
import type { Candidate, RefContent, ReleasableType } from '../model/candidates';
import { releaseNotesDraft } from '../model/notes';
import { classifyProject } from '../model/project';
import { proposeVersion } from '../model/version';
import type { Proposal } from '../model/version';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { PLAN_SECONDS, newPlanId } from './plans';

export type ReleasePlan = OperationOutput<'release.plan'>;

/** The branch a release is prepared on (CONTEXT.md). */
export const temporaryBranch = (version: string) => `temp-tca-release/${version}`;

/** What `release.prepare` needs from the plan: the refs, every candidate with its files on both refs, and what the plan proposed. */
export interface ReleasePlanPayload {
  owner: string;
  repo: string;
  project_type: ReleasableType;
  bound_to: BoundTo;
  default_branch: { name: string; sha: string };
  baseline: { tag: string; sha: string } | null;
  candidates: Candidate[];
  administrative: string[];
  version: Proposal;
  notes_draft: string;
}

const named = (candidates: readonly Candidate[]) => candidates.map(candidate => ({ id: candidate.id, title: (candidate.default_branch ?? candidate.baseline)?.title ?? '' }));

/**
 * The catalog entry is read by ref name, the tree by commit (R5). An entry Door43
 * computed for another commit, or one that names none, would map books to paths
 * the tree does not describe, so the plan is refused and nothing is stored; the
 * catalog catching up is a retry (`door43_unavailable`).
 */
function sameCommit(input: { owner: string; repo: string }, ref: string, expected: string, entrySha: string | null): void {
  if (entrySha === expected) return;
  throw new CatalogError('door43_unavailable', { details: { owner: input.owner, repo: input.repo, ref, expected_sha: expected, catalog_sha: entrySha, reason: 'catalog entry not at the commit the repository named' } });
}

export async function releasePlan(input: ParsedInput<'release.plan'>, context: OperationContext): Promise<ReleasePlan> {
  const client = signedIn(context);
  const { account } = await readAccount(client);
  const repository = await readRepository(client, input.owner, input.repo);
  const access = repositoryAccess(repository);
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner: input.owner, repo: input.repo } });
  const classified = classifyProject(projectCatalog(repository));
  if (classified.editability.state !== 'editable' || classified.project_type === 'other') {
    throw new CatalogError('not_releasable', { message: classified.editability.reason, details: { owner: input.owner, repo: input.repo, project_type: classified.project_type, metadata_format: classified.metadata_format } });
  }
  const type: ReleasableType = classified.project_type;
  const refs = repositoryRefs(repository);
  if (!refs.default_branch) {
    throw new CatalogError('not_releasable', { message: 'This project has no commit on its default branch yet. Add books before releasing.', details: { owner: input.owner, repo: input.repo, reason: 'no default-branch head' } });
  }
  const { default_branch, latest_full_release } = refs;

  // Both refs are read at the commit the repository named, so the plan binds to what it compared (R5).
  const [branchEntry, branchTree] = await Promise.all([readCatalogEntry(client, input.owner, input.repo, default_branch.name), readTree(client, input.owner, input.repo, default_branch.sha)]);
  sameCommit(input, default_branch.name, default_branch.sha, branchEntry.sha);
  const defaultBranch: RefContent = { ingredients: branchEntry.catalog.ingredients, files: branchTree.files };
  let baseline: RefContent | null = null;
  if (latest_full_release) {
    const [tagEntry, tagTree] = await Promise.all([readCatalogEntry(client, input.owner, input.repo, latest_full_release.tag), readTree(client, input.owner, input.repo, latest_full_release.sha)]);
    sameCommit(input, latest_full_release.tag, latest_full_release.sha, tagEntry.sha);
    baseline = { ingredients: tagEntry.catalog.ingredients, files: tagTree.files };
  }

  const candidates = detectCandidates(type, defaultBranch, baseline);
  const included = (group: Candidate['group']) => candidates.books.filter(book => book.group === group && book.selection === 'include');
  const version = proposeVersion(latest_full_release?.tag ?? null, {
    removed: candidates.removals.length > 0,
    added: included('new').length > 0,
    revised: included('changed_released').length > 0,
  });
  const notes_draft = releaseNotesDraft({
    owner: input.owner,
    repo: input.repo,
    version: version.proposed,
    baseline_tag: version.baseline_tag,
    source: { branch: default_branch.name, sha: default_branch.sha },
    units: type === 'obs' ? 'stories' : 'books',
    added: named(included('new')),
    revised: named(included('changed_released')),
    removed: named(candidates.books.filter(book => candidates.removals.includes(book.id))),
    carried_forward: named(candidates.books.filter(book => book.selection === 'carry_forward')),
    unknown_included: [],
  });

  const now = context.now();
  const bound_to: BoundTo = { default_branch_sha: default_branch.sha, release_tag: latest_full_release?.tag ?? null, release_tag_sha: latest_full_release?.sha ?? null };
  const target = `${input.owner}/${input.repo}@${temporaryBranch(version.proposed)}`;
  const plan: ReleasePlan = {
    id: newPlanId(),
    operation: 'release.plan',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PLAN_SECONDS * 1000).toISOString(),
    bound_to,
    preview: {
      books: candidates.books.map(({ id, group, selection }) => ({ id, group, selection })),
      removals: removals(candidates.books),
      administrative: candidates.administrative,
      version,
      notes_draft,
    },
    would_write: [
      { kind: 'branch', target },
      { kind: 'commit', target },
    ],
    warnings: [],
  };
  const payload: ReleasePlanPayload = {
    owner: input.owner,
    repo: input.repo,
    project_type: type,
    bound_to,
    default_branch,
    baseline: latest_full_release ? { tag: latest_full_release.tag, sha: latest_full_release.sha } : null,
    candidates: candidates.books,
    administrative: candidates.administrative,
    version,
    notes_draft,
  };
  await context.plans.putPlan({ plan, payload, account: account.login });
  return plan;
}
