// `release.create` (operations.md §3, #39): the Door43 release of a prepared
// snapshot. Before any write: the preparation is `ready_for_release` (or a
// release attempt of it failed and the manager retries), its health lets it
// go on, with the manager's acknowledgement when it is a warning (H2, Q6); the
// notes are there; the version is valid and after the baseline (R9); the
// binding is re-read and unchanged (R5); the permission is re-read (A2). Then
// one write creates the tag and the release on the snapshot commit (E27), and
// only after that the temporary branch is deleted, its failure a warning on
// the receipt (R7, R3). A release Door43 refused keeps the branch and the
// preparation as `retryable_failure`; one Door43 did not confirm is not
// retried on its own: the next create looks the tag up first, records a
// release it finds, and creates nothing over it (R6, X1; #40). The same request after success answers the
// same receipt (§1 rule 6).

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationErrorShape, OperationOutput, ParsedInput, Preparation } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import { deleteBranch } from '../door43/branches';
import { repositoryRefs } from '../door43/catalog';
import { createRelease, readReleaseByTag, ReleaseWriteError } from '../door43/releases';
import { readRepository, repositoryAccess } from '../door43/repos';
import { releasable } from '../model/health';
import { compareVersions, parseVersion } from '../model/version';
import { signedIn } from './context';
import type { OperationContext } from './context';
import { temporaryBranch } from './release-plan';
import { errorShape, validation } from './release-prepare';

type ReleaseCreateReceipt = OperationOutput<'release.create'>;

/** The receipt of a release is stored under the preparation, which is the plan a release applies. */
export const releaseReceiptKey = (owner: string, repo: string, id: string): string => `release:${owner.toLowerCase()}/${repo}/${id}`;

/**
 * The version the release takes (R9): the manager's, valid, after the baseline, and not
 * below the one confirmed at prepare, which already carried the major increment a
 * removal needs; else `invalid_version`.
 */
export function releaseVersion(sent: string, baselineTag: string | null, confirmed: string): string {
  const version = parseVersion(sent.trim());
  if (!version) throw new CatalogError('invalid_version', { values: { latest: baselineTag ?? 'none' } });
  const baseline = baselineTag === null ? null : parseVersion(baselineTag);
  if (baseline && compareVersions(version, baseline) <= 0) throw new CatalogError('invalid_version', { values: { latest: baselineTag ?? 'none' } });
  const prepared = parseVersion(confirmed);
  if (prepared && compareVersions(version, prepared) < 0) throw new CatalogError('invalid_version', { values: { latest: confirmed }, details: { reason: `the version was confirmed as ${confirmed} when the release was prepared` } });
  return `v${version.major}.${version.minor}.${version.patch}`;
}

export async function releaseCreate(input: ParsedInput<'release.create'>, context: OperationContext): Promise<ReleaseCreateReceipt> {
  const client = signedIn(context);
  const { account } = await readAccount(client);
  const { owner, repo, preparation_id: id } = input;
  const started = context.now();
  const at = () => context.now().toISOString();

  const done = await context.plans.getReceipt<ReleaseCreateReceipt>(releaseReceiptKey(owner, repo, id));
  if (done && done.account === account.login) return done.receipt;

  const stored = await context.plans.getPreparation<Preparation>(owner, repo, id);
  if (!stored) throw new CatalogError('not_found', { details: { owner, repo, preparation_id: id } });
  if (!stored.snapshot) throw new CatalogError('health_blocked', { message: 'The release snapshot has not been prepared.', details: { state: stored.state } });
  const retrying = stored.state === 'retryable_failure' && stored.last_error?.code === 'release_failed';
  if (stored.state === 'pre_release' || stored.state === 'full_release') throw new CatalogError('release_exists', { details: { tag: stored.release?.tag ?? id } });
  // A moved source (`restart_required`) keeps the unconfirmed attempt's error, and its release may still exist: it is looked up too.
  const unconfirmed = (stored.state === 'retryable_failure' || stored.state === 'restart_required') && stored.last_error?.code === 'release_outcome_unknown';
  if (unconfirmed) {
    // The last attempt was not confirmed: the tag is looked up before anything is sent again, so a lost answer never becomes a duplicate (R6, X1).
    // The permission is re-read first (A2): nothing is looked up or recorded for an account that may not release.
    const access = repositoryAccess(await readRepository(client, owner, repo));
    if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner, repo } });
    const tag = stored.version.confirmed ?? id;
    const found = await readReleaseByTag(client, owner, repo, tag);
    if (found) {
      if (found.target_sha === stored.snapshot.commit_sha) {
        // It is this preparation's release: the preparation records it, nothing new is created, and the temporary branch is
        // deleted as after any release (R7; decided 7 October 2026 by Rich).
        const state = found.prerelease ? 'pre_release' : 'full_release';
        // The release is recorded first, so a deletion that fails never hides it (R7); only the preparation's own temporary branch is
        // ever deleted (R3), and a deletion that fails is then put on the record, for the manager to finish on Door43.
        const released: Preparation = { ...stored, state, release: { tag: found.tag, url: found.url, prerelease: found.prerelease }, last_error: null, history: [...stored.history, { at: at(), from: stored.state, to: state, event: 'release.lookup found the release of the unconfirmed attempt' }] };
        await context.plans.putPreparation(owner, repo, id, released);
        const deletion = stored.snapshot.branch === temporaryBranch(id) ? await deleteBranch(client, owner, repo, stored.snapshot.branch) : { deleted: false as const, reason: 'it is not the temporary branch of this preparation' };
        if (!deletion.deleted) await context.plans.putPreparation(owner, repo, id, { ...released, history: [...released.history, { at: at(), from: state, to: state, event: `the temporary branch could not be deleted: ${deletion.reason}` }] });
        throw new CatalogError('release_exists', { details: { owner, repo, tag, url: found.url, target_sha: found.target_sha, snapshot_sha: stored.snapshot.commit_sha, branch_deleted: deletion.deleted, ...(deletion.deleted ? {} : { branch: stored.snapshot.branch, reason: deletion.reason }) } });
      }
      throw new CatalogError('release_exists', { details: { owner, repo, tag, url: found.url, target_sha: found.target_sha, snapshot_sha: stored.snapshot.commit_sha } });
    }
  }
  // None found on a moved source: nothing is created on it (R5).
  if (stored.state === 'restart_required') throw new CatalogError('source_changed', { details: { owner, repo, preparation_id: id } });
  if (stored.state !== 'ready_for_release' && !retrying && !unconfirmed) throw new CatalogError('health_blocked', { message: stored.state === 'health_checking' ? 'The health check is still running.' : 'The release snapshot is not ready.', details: { state: stored.state, health: stored.health.state } });

  // The health gate (H2): Door43's result, with the manager's acknowledgement when it is a warning (Q6).
  if (!releasable(stored.health.state)) throw new CatalogError('health_blocked', { message: 'The health check did not pass.', details: { health: stored.health.state } });
  if (stored.health.state === 'warning' && !input.acknowledge_warnings) throw new CatalogError('warning_not_acknowledged', { details: { issues: stored.health.issue_count } });
  const notes = input.notes.trim();
  if (!notes) throw validation('notes', 'Release notes are required.');
  const version = releaseVersion(input.version, stored.version.baseline_tag, stored.version.confirmed ?? stored.version.proposed);

  // The permission (A2) and the binding (R5), read live; a moved source makes the preparation restart.
  const repository = await readRepository(client, owner, repo);
  const access = repositoryAccess(repository);
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner, repo } });
  const refs = repositoryRefs(repository);
  const bound = stored.bound_to;
  const now = { default_branch_sha: refs.default_branch?.sha ?? null, release_tag: refs.latest_full_release?.tag ?? null, release_tag_sha: refs.latest_full_release?.sha ?? null };
  if (now.default_branch_sha !== bound.default_branch_sha || now.release_tag !== bound.release_tag || now.release_tag_sha !== bound.release_tag_sha) {
    await context.plans.putPreparation(owner, repo, id, { ...stored, state: 'restart_required', history: [...stored.history, { at: at(), from: stored.state, to: 'restart_required', event: 'source changed before release creation' }] });
    throw new CatalogError('source_changed', { details: { owner, repo, bound, now } });
  }

  const branch = stored.snapshot.branch;
  const target = { tag: version, notes, target_sha: stored.snapshot.commit_sha, prerelease: input.prerelease };
  const failed = async (error: CatalogError, event: string) => {
    const last: OperationErrorShape = errorShape(error, context.requestId);
    await context.plans.putPreparation(owner, repo, id, { ...stored, state: 'retryable_failure', last_error: last, version: { ...stored.version, confirmed: version }, notes: { ...stored.notes, confirmed: notes }, history: [...stored.history, { at: at(), from: stored.state, to: 'retryable_failure', event }] });
    throw error;
  };
  let created;
  try {
    created = await createRelease(client, owner, repo, target);
  } catch (error) {
    if (!(error instanceof ReleaseWriteError)) throw error;
    // The branch is kept whatever happened (R7); nothing is sent again (X1).
    if (error.kind === 'exists') throw new CatalogError('release_exists', { details: { owner, repo, tag: version, reason: error.reason } });
    if (error.kind === 'failed') return failed(new CatalogError('release_failed', { values: { 'error message': error.reason }, details: { owner, repo, tag: version, door43_status: error.status } }), `release.create: ${error.reason}`);
    return failed(new CatalogError('release_outcome_unknown', { details: { owner, repo, tag: version, reason: error.reason } }), 'release.create: outcome unknown');
  }

  // The release exists: the preparation records it before the cleanup, so a branch that resists deletion never hides a release (R7).
  const state = created.prerelease ? 'pre_release' : 'full_release';
  const result: Preparation = {
    ...stored,
    state,
    version: { ...stored.version, confirmed: version },
    notes: { ...stored.notes, confirmed: notes },
    release: { tag: created.tag, url: created.url, prerelease: created.prerelease },
    last_error: null,
    history: [...stored.history, { at: at(), from: stored.state, to: state, event: input.acknowledge_warnings && stored.health.state === 'warning' ? 'release.create, warnings acknowledged' : 'release.create' }],
    freshness: { read_at: at(), source: 'live', age_seconds: 0 },
  };
  await context.plans.putPreparation(owner, repo, id, result);
  const warnings: ReleaseCreateReceipt['warnings'] = [];
  const deletion = await deleteBranch(client, owner, repo, branch);
  if (!deletion.deleted) warnings.push({ code: 'branch_not_deleted', message: `The temporary branch ${branch} could not be deleted: ${deletion.reason}. The release is complete; delete the branch on Door43.` });
  const receipt: ReleaseCreateReceipt = {
    operation: 'release.create',
    request_id: context.requestId,
    plan_id: null,
    started_at: started.toISOString(),
    finished_at: at(),
    wrote: [
      { kind: 'tag', target: version, sha: stored.snapshot.commit_sha },
      { kind: 'release', target: version, sha: created.target_sha || stored.snapshot.commit_sha, url: created.url },
    ],
    result,
    warnings,
    acknowledged_warnings: stored.health.state === 'warning' && input.acknowledge_warnings,
  };
  await context.plans.putReceipt(releaseReceiptKey(owner, repo, id), { receipt, account: account.login });
  return receipt;
}
