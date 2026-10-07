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
// retried: the preparation says so, and `release.lookup` settles it before
// anything is sent again (R6, X1). The same request after success answers the
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
import { PREPARATION_SECONDS } from './plans';
import { temporaryBranch } from './release-plan';
import { errorShape, validation } from './release-prepare';

type ReleaseCreateReceipt = OperationOutput<'release.create'>;

/** The receipt of a release is stored under the preparation, which is the plan a release applies. */
export const releaseReceiptKey = (owner: string, repo: string, id: string): string => `release:${owner.toLowerCase()}/${repo}/${id}`;

/** Which preparation a released tag came from, kept as long as the preparation. */
export const releaseTagKey = (owner: string, repo: string, tag: string): string => `release-tag:${owner.toLowerCase()}/${repo}/${tag}`;

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

  // The permission (A2), read live before anything about the preparation or its receipt is answered.
  const repository = await readRepository(client, owner, repo);
  const access = repositoryAccess(repository);
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner, repo } });

  const done = await context.plans.getReceipt<ReleaseCreateReceipt>(releaseReceiptKey(owner, repo, id));
  if (done && done.account === account.login) return done.receipt;

  const stored = await context.plans.getPreparation<Preparation>(owner, repo, id);
  if (!stored) throw new CatalogError('not_found', { details: { owner, repo, preparation_id: id } });
  if (!stored.snapshot) throw new CatalogError('health_blocked', { message: 'The release snapshot has not been prepared.', details: { state: stored.state } });
  const retrying = stored.state === 'retryable_failure' && stored.last_error?.code === 'release_failed';
  if (stored.state === 'pre_release' || stored.state === 'full_release') throw new CatalogError('release_exists', { details: { tag: stored.release?.tag ?? id } });
  if (stored.state === 'restart_required') throw new CatalogError('source_changed', { details: { owner, repo, preparation_id: id } });
  if (stored.state === 'retryable_failure' && stored.last_error?.code === 'release_outcome_unknown') {
    throw new CatalogError('release_outcome_unknown', { details: { owner, repo, tag: stored.version.confirmed ?? id, reason: 'the last attempt was not confirmed; look the tag up first' } });
  }
  if (stored.state !== 'ready_for_release' && !retrying) throw new CatalogError('health_blocked', { message: stored.state === 'health_checking' ? 'The health check is still running.' : 'The release snapshot is not ready.', details: { state: stored.state, health: stored.health.state } });

  // The health gate (H2): Door43's result, with the manager's acknowledgement when it is a warning (Q6).
  if (!releasable(stored.health.state)) throw new CatalogError('health_blocked', { message: 'The health check did not pass.', details: { health: stored.health.state } });
  if (stored.health.state === 'warning' && !input.acknowledge_warnings) throw new CatalogError('warning_not_acknowledged', { details: { issues: stored.health.issue_count } });
  const notes = input.notes.trim();
  if (!notes) throw validation('notes', 'Release notes are required.');
  const version = releaseVersion(input.version, stored.version.baseline_tag, stored.version.confirmed ?? stored.version.proposed);

  // The binding (R5), from the repository read live above; a moved source makes the preparation restart.
  const refs = repositoryRefs(repository);
  const bound = stored.bound_to;
  const now = { default_branch_sha: refs.default_branch?.sha ?? null, release_tag: refs.latest_full_release?.tag ?? null, release_tag_sha: refs.latest_full_release?.sha ?? null };
  if (now.default_branch_sha === null) throw new CatalogError('door43_unavailable', { details: { owner, repo, reason: 'the default-branch head could not be read from the catalog' } });
  if (now.default_branch_sha !== bound.default_branch_sha || now.release_tag !== bound.release_tag || now.release_tag_sha !== bound.release_tag_sha) {
    await context.plans.putPreparation(owner, repo, id, { ...stored, state: 'restart_required', history: [...stored.history, { at: at(), from: stored.state, to: 'restart_required', event: 'source changed before release creation' }] });
    throw new CatalogError('source_changed', { details: { owner, repo, bound, now } });
  }

  const branch = stored.snapshot.branch;
  const target = { tag: version, notes, target_sha: stored.snapshot.commit_sha, prerelease: input.prerelease };
  const failed = async (error: CatalogError, event: string) => {
    const last: OperationErrorShape = errorShape(error, context.requestId);
    // A refusal confirms nothing, so the prepare-time version stays the floor (R9); an unconfirmed attempt keeps its tag for the lookup (R6).
    const kept = error.code === 'release_outcome_unknown' ? { ...stored.version, confirmed: version } : stored.version;
    await context.plans.putPreparation(owner, repo, id, { ...stored, state: 'retryable_failure', last_error: last, version: kept, notes: { ...stored.notes, confirmed: notes }, history: [...stored.history, { at: at(), from: stored.state, to: 'retryable_failure', event }] });
    throw error;
  };
  let created;
  try {
    created = await createRelease(client, owner, repo, target);
  } catch (error) {
    if (!(error instanceof ReleaseWriteError)) throw error;
    // The branch is kept whatever happened (R7); nothing is sent again (X1).
    if (error.kind === 'exists') {
      // Door43 has the tag already (decided 7 October 2026 by Rich): looked up, it is either this snapshot's release, which the preparation
      // records and whose branch is then deleted as after any release (R7), or another's, which the preparation records as its last error.
      const found = await readReleaseByTag(client, owner, repo, version);
      if (found && found.target_sha === stored.snapshot.commit_sha) {
        const state = found.prerelease ? 'pre_release' : 'full_release';
        await context.plans.putPreparation(owner, repo, id, { ...stored, state, version: { ...stored.version, confirmed: version }, notes: { ...stored.notes, confirmed: notes }, release: { tag: found.tag, url: found.url, prerelease: found.prerelease }, last_error: null, history: [...stored.history, { at: at(), from: stored.state, to: state, event: 'release.create: Door43 had the release already' }] });
        await context.plans.putReceipt(releaseTagKey(owner, repo, version), { receipt: { preparation_id: id }, account: account.login }, PREPARATION_SECONDS);
        const deletion = branch === temporaryBranch(id) ? await deleteBranch(client, owner, repo, branch) : { deleted: false as const };
        throw new CatalogError('release_exists', { details: { owner, repo, tag: version, url: found.url, target_sha: found.target_sha, snapshot_sha: stored.snapshot.commit_sha, branch_deleted: deletion.deleted } });
      }
      const exists = new CatalogError('release_exists', { details: { owner, repo, tag: version, reason: error.reason, url: found?.url ?? null, target_sha: found?.target_sha ?? null, snapshot_sha: stored.snapshot.commit_sha } });
      await context.plans.putPreparation(owner, repo, id, { ...stored, last_error: errorShape(exists, context.requestId), history: [...stored.history, { at: at(), from: stored.state, to: stored.state, event: `release.create: ${version} is already on Door43${found ? ` on ${found.target_sha.slice(0, 10)}` : ''}` }] });
      throw exists;
    }
    if (error.kind === 'failed') return failed(new CatalogError('release_failed', { values: { 'error message': error.reason }, details: { owner, repo, tag: version, door43_status: error.status } }), `release.create: ${error.reason}`);
    return failed(new CatalogError('release_outcome_unknown', { details: { owner, repo, tag: version, reason: error.reason } }), 'release.create: outcome unknown');
  }
  // A 201 for another tag, commit, or flag is not the release asked for: nothing is recorded as released and the branch is kept (R6, R7).
  if (created.tag !== version || created.target_sha !== stored.snapshot.commit_sha || created.prerelease !== input.prerelease) {
    const reason = `Door43 answered with ${created.tag} on ${created.target_sha || 'no commit'}${created.prerelease ? ' as a pre-release' : ''}`;
    return failed(new CatalogError('release_outcome_unknown', { details: { owner, repo, tag: version, reason } }), 'release.create: outcome unknown');
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
  // The tag may be above the preparation id (R9): `release.promote`, which knows only the tag, finds the preparation by this.
  await context.plans.putReceipt(releaseTagKey(owner, repo, version), { receipt: { preparation_id: id }, account: account.login }, PREPARATION_SECONDS);
  const warnings: ReleaseCreateReceipt['warnings'] = [];
  // Only the preparation's own temporary branch is ever deleted (R3).
  const deletion = branch === temporaryBranch(id) ? await deleteBranch(client, owner, repo, branch) : { deleted: false as const, reason: 'it is not the temporary branch of this preparation' };
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
