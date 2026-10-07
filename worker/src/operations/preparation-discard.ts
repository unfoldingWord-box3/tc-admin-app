// `preparation.discard` (operations.md §3, #58, Q14): the manager abandons an
// unreleased preparation. After the UI's confirmation and a live permission
// read (A2), the one write deletes the temporary branch, and the preparation
// is `discarded`, a terminal state. A released preparation cannot be
// discarded (`already_released`, R7). A deletion Door43 did not do leaves the
// branch and the preparation as `retryable_failure`, for the manager to try
// again (R7). A preparation never pushed has no branch and is discarded with
// no write. The same request after success answers the same receipt (§1
// rule 6).

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput, Preparation } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import { deleteBranch } from '../door43/branches';
import { readReleaseByTag } from '../door43/releases';
import { readRepository, repositoryAccess } from '../door43/repos';
import { signedIn } from './context';
import type { OperationContext } from './context';
import { PREPARATION_SECONDS } from './plans';
import { releaseTagKey } from './release-create';
import { temporaryBranch } from './release-plan';
import { errorShape } from './release-prepare';

type DiscardReceipt = OperationOutput<'preparation.discard'>;

export const discardReceiptKey = (owner: string, repo: string, id: string): string => `discard:${owner.toLowerCase()}/${repo}/${id}`;

export async function preparationDiscard(input: ParsedInput<'preparation.discard'>, context: OperationContext): Promise<DiscardReceipt> {
  const client = signedIn(context);
  const { account } = await readAccount(client);
  const { owner, repo, preparation_id: id } = input;
  const started = context.now();
  const at = () => context.now().toISOString();

  // The permission first, strictly (A2): nothing stored about the preparation, not even a receipt, is answered to an account that may not push.
  const access = repositoryAccess(await readRepository(client, owner, repo));
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner, repo } });

  const done = await context.plans.getReceipt<DiscardReceipt>(discardReceiptKey(owner, repo, id));
  const stored = await context.plans.getPreparation<Preparation>(owner, repo, id);
  // The receipt answers only while the preparation it discarded is still discarded: a replacement prepared under the same version is discarded on its own.
  if (done && done.account === account.login && (!stored || stored.state === 'discarded')) return done.receipt;
  if (!stored) throw new CatalogError('not_found', { details: { owner, repo, preparation_id: id } });
  if (stored.state === 'pre_release' || stored.state === 'full_release') throw new CatalogError('already_released', { details: { owner, repo, preparation_id: id, tag: stored.release?.tag ?? id } });

  const receipt = async (result: Preparation, wrote: DiscardReceipt['wrote']): Promise<DiscardReceipt> => {
    const answer: DiscardReceipt = { operation: 'preparation.discard', request_id: context.requestId, plan_id: null, started_at: started.toISOString(), finished_at: at(), wrote, result, warnings: [] };
    await context.plans.putReceipt(discardReceiptKey(owner, repo, id), { receipt: answer, account: account.login });
    return answer;
  };
  const fresh = (preparation: Preparation): Preparation => ({ ...preparation, freshness: { read_at: at(), source: 'live', age_seconds: 0 } });
  // Already discarded, or never pushed: nothing on Door43 to delete.
  if (stored.state === 'discarded') return receipt(fresh(stored), []);
  if (!stored.snapshot) {
    const result = fresh({ ...stored, state: 'discarded', last_error: null, history: [...stored.history, { at: at(), from: stored.state, to: 'discarded', event: 'preparation.discard' }] });
    await context.plans.putPreparation(owner, repo, id, result);
    return receipt(result, []);
  }

  if (stored.last_error?.code === 'release_outcome_unknown') {
    // The last release attempt was not confirmed: a release Door43 made of this snapshot makes it released, not discardable (R6, R7).
    // Whatever the state: a moved source (`restart_required`) keeps the unconfirmed attempt's error, and its release may still exist.
    const tag = stored.version.confirmed ?? id;
    const found = await readReleaseByTag(client, owner, repo, tag);
    if (found && found.target_sha === stored.snapshot.commit_sha) {
      // This snapshot's release: recorded, its branch deleted as after any release (R7), and the discard refused (decided 7 October 2026 by Rich).
      const state = found.prerelease ? 'pre_release' : 'full_release';
      // The release is recorded first, so a deletion that fails never hides it (R7); only the preparation's own temporary branch is
      // ever deleted (R3), and a deletion that fails is then put on the record, for the manager to finish on Door43.
      const released: Preparation = { ...stored, state, release: { tag: found.tag, url: found.url, prerelease: found.prerelease }, last_error: null, history: [...stored.history, { at: at(), from: stored.state, to: state, event: 'release.lookup found the release of the unconfirmed attempt' }] };
      await context.plans.putPreparation(owner, repo, id, released);
      // The tag may be above the preparation id (R9): `release.promote`, which knows only the tag, finds the preparation by this.
      await context.plans.putReceipt(releaseTagKey(owner, repo, found.tag), { receipt: { preparation_id: id }, account: account.login }, PREPARATION_SECONDS);
      const deletion = stored.snapshot.branch === temporaryBranch(id) ? await deleteBranch(client, owner, repo, stored.snapshot.branch) : { deleted: false as const, reason: 'it is not the temporary branch of this preparation' };
      if (!deletion.deleted) await context.plans.putPreparation(owner, repo, id, { ...released, history: [...released.history, { at: at(), from: state, to: state, event: `the temporary branch could not be deleted: ${deletion.reason}` }] });
      throw new CatalogError('already_released', { details: { owner, repo, preparation_id: id, tag: found.tag, branch_deleted: deletion.deleted, ...(deletion.deleted ? {} : { branch: stored.snapshot.branch, reason: deletion.reason }) } });
    }
    if (found) {
      // A release on another commit under this tag: not this preparation's, so nothing is deleted or stored; the manager resolves it on Door43 (R6, R7).
      throw new CatalogError('release_exists', { details: { owner, repo, preparation_id: id, tag: found.tag, target_sha: found.target_sha, snapshot_sha: stored.snapshot.commit_sha } });
    }
  }

  const branch = stored.snapshot.branch;
  // Only the preparation's own temporary branch is ever deleted (R3): another name is refused here, Door43 untouched and nothing stored.
  if (branch !== temporaryBranch(id)) throw new CatalogError('unexpected', { details: { owner, repo, preparation_id: id, branch, reason: 'the stored branch is not the temporary branch of this preparation' } });
  const deletion = await deleteBranch(client, owner, repo, branch);
  if (!deletion.deleted) {
    // The branch stays, and so does the preparation, for the retry (R7).
    const error = new CatalogError('door43_unavailable', { details: { owner, repo, branch, reason: `the temporary branch could not be deleted: ${deletion.reason}` } });
    // An unconfirmed release attempt stays on the record, so the retry looks the tag up again before deleting (R6).
    const lastError = stored.last_error?.code === 'release_outcome_unknown' ? stored.last_error : errorShape(error, context.requestId);
    await context.plans.putPreparation(owner, repo, id, fresh({ ...stored, state: 'retryable_failure', last_error: lastError, history: [...stored.history, { at: at(), from: stored.state, to: 'retryable_failure', event: `preparation.discard: ${deletion.reason}` }] }));
    throw error;
  }
  const result = fresh({ ...stored, state: 'discarded', last_error: null, history: [...stored.history, { at: at(), from: stored.state, to: 'discarded', event: 'preparation.discard' }] });
  await context.plans.putPreparation(owner, repo, id, result);
  return receipt(result, [{ kind: 'branch', target: branch }]);
}
