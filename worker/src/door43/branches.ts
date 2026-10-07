// Branches on Door43 (E21, E27): the temporary branch a release is prepared
// on, created from the previous release's commit or the default-branch head
// (ADR 0010), sent once and never retried (X1). Its deletion joins with #39
// and #58. Door43's shapes stop here.

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
