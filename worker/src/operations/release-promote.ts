// `release.promote` (operations.md §3, #39): a pre-release made a full release
// by one edit of its pre-release flag and nothing else (R8). The release must
// exist and be a pre-release; the permission is re-read (A2). A preparation
// of that version, when the store has one, follows the release to
// `full_release`.

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput, Preparation } from '@tc-admin/shared/schema';
import { promoteRelease, readReleaseByTag, ReleaseWriteError } from '../door43/releases';
import { readRepository, repositoryAccess } from '../door43/repos';
import { signedIn } from './context';
import type { OperationContext } from './context';
import { releaseTagKey } from './release-create';

export async function releasePromote(input: ParsedInput<'release.promote'>, context: OperationContext): Promise<OperationOutput<'release.promote'>> {
  const client = signedIn(context);
  const { owner, repo, tag } = input;
  const started = context.now();
  const at = () => context.now().toISOString();

  const access = repositoryAccess(await readRepository(client, owner, repo));
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner, repo } });
  const release = await readReleaseByTag(client, owner, repo, tag);
  if (!release) throw new CatalogError('not_found', { details: { owner, repo, tag } });
  if (!release.prerelease) throw new CatalogError('not_prerelease', { details: { owner, repo, tag } });

  let promoted;
  try {
    promoted = await promoteRelease(client, owner, repo, release.id);
  } catch (error) {
    if (error instanceof ReleaseWriteError) throw new CatalogError('promotion_failed', { values: { 'error message': error.reason }, details: { owner, repo, tag, door43_status: error.status } });
    throw error;
  }
  if (promoted.prerelease) throw new CatalogError('promotion_failed', { values: { 'error message': 'Door43 still reports a pre-release' }, details: { owner, repo, tag } });

  // The preparation the tag was created from, which may carry a lower id (R9); followed only when it recorded this release on this commit.
  const pointer = await context.plans.getReceipt<{ preparation_id: string }>(releaseTagKey(owner, repo, tag));
  const id = pointer?.receipt.preparation_id ?? tag;
  const preparation = await context.plans.getPreparation<Preparation>(owner, repo, id);
  if (preparation && preparation.state === 'pre_release' && preparation.release?.tag === promoted.tag && preparation.snapshot?.commit_sha === release.target_sha) {
    await context.plans.putPreparation(owner, repo, id, { ...preparation, state: 'full_release', release: { tag: promoted.tag, url: promoted.url, prerelease: false }, history: [...preparation.history, { at: at(), from: 'pre_release', to: 'full_release', event: 'release.promote' }] });
  }
  return {
    operation: 'release.promote',
    request_id: context.requestId,
    plan_id: null,
    started_at: started.toISOString(),
    finished_at: at(),
    wrote: [{ kind: 'release', target: promoted.tag, url: promoted.url }],
    result: { tag: promoted.tag, url: promoted.url, prerelease: false },
    warnings: [],
  };
}
