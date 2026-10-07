// `release.promote` (operations.md §3, #39): a pre-release made a full release
// by one edit of its pre-release flag and nothing else (R8). The release must
// exist and be a pre-release; the permission is re-read (A2) and the project
// must be releasable (W2). A preparation of that version, when the store has
// one, follows the release to `full_release`, also when Door43 already shows
// it full after an answer that was lost.

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput, Preparation } from '@tc-admin/shared/schema';
import { projectCatalog } from '../door43/catalog';
import { promoteRelease, readReleaseByTag, ReleaseWriteError } from '../door43/releases';
import { readRepository, repositoryAccess } from '../door43/repos';
import { classifyProject } from '../model/project';
import { signedIn } from './context';
import type { OperationContext } from './context';
import { releaseTagKey } from './release-create';

export async function releasePromote(input: ParsedInput<'release.promote'>, context: OperationContext): Promise<OperationOutput<'release.promote'>> {
  const client = signedIn(context);
  const { owner, repo, tag } = input;
  const started = context.now();
  const at = () => context.now().toISOString();

  const repository = await readRepository(client, owner, repo);
  const access = repositoryAccess(repository);
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner, repo } });
  // Only a Scripture Burrito Bible or Open Bible Stories project is ever written, a promotion included (W2), as at `release.plan`.
  const classified = classifyProject(projectCatalog(repository));
  if (classified.editability.state !== 'editable' || classified.project_type === 'other') {
    throw new CatalogError('not_releasable', { message: classified.editability.reason, details: { owner, repo, project_type: classified.project_type, metadata_format: classified.metadata_format } });
  }
  const release = await readReleaseByTag(client, owner, repo, tag);
  if (!release) throw new CatalogError('not_found', { details: { owner, repo, tag } });

  // The preparation the tag was created from, which may carry a lower id (R9); followed only when it recorded this tag on this release's commit.
  const follow = async (answered: { tag: string; url: string }, event: string): Promise<boolean> => {
    if (answered.tag !== tag) return false;
    const pointer = await context.plans.getReceipt<{ preparation_id: string }>(releaseTagKey(owner, repo, tag));
    const id = pointer?.receipt.preparation_id ?? tag;
    const preparation = await context.plans.getPreparation<Preparation>(owner, repo, id);
    if (!preparation || preparation.state !== 'pre_release' || preparation.release?.tag !== tag || preparation.snapshot?.commit_sha !== release.target_sha) return false;
    await context.plans.putPreparation(owner, repo, id, { ...preparation, state: 'full_release', release: { tag, url: answered.url, prerelease: false }, history: [...preparation.history, { at: at(), from: 'pre_release', to: 'full_release', event }] });
    return true;
  };
  const receipt = (answered: { tag: string; url: string }, wrote: OperationOutput<'release.promote'>['wrote']): OperationOutput<'release.promote'> => ({
    operation: 'release.promote',
    request_id: context.requestId,
    plan_id: null,
    started_at: started.toISOString(),
    finished_at: at(),
    wrote,
    result: { tag: answered.tag, url: answered.url, prerelease: false },
    warnings: [],
  });

  if (!release.prerelease) {
    // A promotion Door43 applied whose answer was lost: the preparation follows the live release, and nothing is written (X1).
    if (await follow(release, 'release.promote, already full on Door43')) return receipt(release, []);
    throw new CatalogError('not_prerelease', { details: { owner, repo, tag } });
  }

  let promoted;
  try {
    promoted = await promoteRelease(client, owner, repo, release.id);
  } catch (error) {
    if (error instanceof ReleaseWriteError) throw new CatalogError('promotion_failed', { values: { 'error message': error.reason }, details: { owner, repo, tag, door43_status: error.status } });
    throw error;
  }
  if (promoted.prerelease) throw new CatalogError('promotion_failed', { values: { 'error message': 'Door43 still reports a pre-release' }, details: { owner, repo, tag } });

  await follow(promoted, 'release.promote');
  return receipt(promoted, [{ kind: 'release', target: promoted.tag, url: promoted.url }]);
}
