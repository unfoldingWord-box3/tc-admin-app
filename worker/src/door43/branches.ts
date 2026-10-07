// Branches on Door43 (E21, E27): the temporary branch a release is prepared
// on, created from the previous release's commit or the default-branch head
// (ADR 0010), and deleted once the release exists (R7, #39) or the manager
// discards the preparation (#58); each sent once and never retried (X1).
// Door43's shapes stop here.

import { CatalogError } from '@tc-admin/shared/schema';
import { door43Message, writeDoor43 } from './api';
import type { Door43Client } from './api';

export interface CreatedBranch {
  name: string;
  /** The commit the branch starts at. */
  sha: string;
}

/**
 * `POST /repos/{owner}/{repo}/branches` (`CreateBranchRepoOption`: `new_branch_name`,
 * `old_ref_name`, a branch, tag, or commit, E21; a tag worked on QA, E27). A branch
 * of that name already there means a preparation is already under way
 * (`preparation_active`); a `from` Door43 does not have is `not_found`.
 */
export async function createBranch(client: Door43Client, owner: string, repo: string, name: string, from: string): Promise<CreatedBranch> {
  const outcome = await writeDoor43(client, 'POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`, { new_branch_name: name, old_ref_name: from });
  const details = { door43_status: outcome.status, owner, repo, branch: name };
  if (outcome.status === 409) throw new CatalogError('preparation_active', { details });
  if (outcome.status === 404) throw new CatalogError('not_found', { details: { ...details, reason: 'the ref to branch from was not found' } });
  if (outcome.status !== 201) throw new CatalogError('door43_unavailable', { details: { ...details, reason: door43Message(outcome) } });
  const body = outcome.body as { name?: unknown; commit?: { id?: unknown; sha?: unknown } | null } | null;
  const sha = typeof body?.commit?.id === 'string' ? body.commit.id : typeof body?.commit?.sha === 'string' ? body.commit.sha : '';
  if (typeof body?.name !== 'string' || !sha) throw new CatalogError('door43_unavailable', { details: { ...details, reason: 'unexpected branch shape' } });
  return { name: body.name, sha };
}

/** How a branch deletion ended: done (a branch already gone counts), or not, with Door43's reason. */
export type BranchDeletion = { deleted: true } | { deleted: false; reason: string };

/**
 * `DELETE /repos/{owner}/{repo}/branches/{branch}` (E21; 204 on QA, E27). The result is
 * reported, never thrown: after a release, a branch that could not be deleted is a
 * warning on the receipt, not a failure of the release (R7). A branch Door43 no longer
 * has is as good as deleted.
 */
export async function deleteBranch(client: Door43Client, owner: string, repo: string, name: string): Promise<BranchDeletion> {
  let outcome;
  try {
    outcome = await writeDoor43(client, 'DELETE', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(name)}`);
  } catch (error) {
    // A cleanup after the release: whatever stopped it, including a session or permission Door43 refused, is reported, not thrown.
    if (error instanceof CatalogError) return { deleted: false, reason: String(error.details.reason ?? error.code) };
    throw error;
  }
  if (outcome.status === 204 || outcome.status === 404) return { deleted: true };
  return { deleted: false, reason: door43Message(outcome) };
}
