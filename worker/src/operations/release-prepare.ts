// `release.prepare` (operations.md §4): the first writes of a release
// (ADR 0010, ADR 0013, Q22). It takes the plan `release.plan` stored and
// the manager's selection, re-reads the permission (A2), the editability
// (W2), and the two commits the plan was bound to (R5), checks the selection
// (R4) and the version (R9), reads the default branch's archive for the
// included books' bytes and the previous release's for the carried ones'
// sizes and checksums (R10), merges the metadata (#35), creates
// `temp-tca-release/<version>` from the previous release's commit, or from the
// default-branch head for a first or an Open Bible Stories release, and
// commits the snapshot in as many commits as the plan announced at most
// (R3, W5): included books uploaded, left-out books deleted and listed
// (R2), changed root and administrative files refreshed, the merged
// metadata last. The branch is kept whatever fails after it exists (R7); a
// commit that fails or is lost is reported, never retried (X1), and the
// preparation is stored as `retryable_failure`. The receipt is the
// preparation, an addressable record (operations.md §2), in
// `health_checking`, since Door43 checks every push (E28).

import { CatalogError, ERROR_CATALOG, catalogMessage } from '@tc-admin/shared/schema';
import type { OperationErrorShape, OperationOutput, ParsedInput, Preparation, SelectionState } from '@tc-admin/shared/schema';
import { readArchive } from '../door43/archive';
import type { Archive } from '../door43/archive';
import { readAccount } from '../door43/auth';
import { createBranch } from '../door43/branches';
import { projectCatalog, repositoryRefs } from '../door43/catalog';
import { readRepository, repositoryAccess } from '../door43/repos';
import { readTree } from '../door43/trees';
import { commitFiles } from '../door43/writes';
import type { Commit, CommitFile } from '../door43/writes';
import { mergeReleaseMetadata } from '../model/burrito';
import type { SnapshotFile } from '../model/burrito';
import { MetadataError, parseMetadata } from '../model/burrito-reader';
import type { ProjectMetadata } from '../model/burrito-reader';
import { removals } from '../model/candidates';
import type { Candidate } from '../model/candidates';
import { classifyFiles } from '../model/classify';
import { md5 } from '../model/md5';
import { releaseNotesDraft } from '../model/notes';
import { classifyProject } from '../model/project';
import { MAX_COMMIT_BYTES, commitBytes, planSnapshot } from '../model/snapshot';
import type { SnapshotWrite } from '../model/snapshot';
import { compareVersions, parseVersion, proposeVersion } from '../model/version';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { temporaryBranch } from './release-plan';
import type { ReleasePlan, ReleasePlanPayload } from './release-plan';

export type ReleasePrepareReceipt = OperationOutput<'release.prepare'>;

const validation = (field: string, message: string) => new CatalogError('validation_failed', { message: `${field}: ${message}`, details: { fields: [{ path: field, message }] } });

/** The metadata a ref's archive carries, or `archive_failed` when the archive holds none tC Admin can read. */
async function metadataOf(archive: Archive, ref: string): Promise<ProjectMetadata> {
  try {
    return parseMetadata(await archive.bytes('metadata.json'));
  } catch (error) {
    if (error instanceof MetadataError || (error instanceof CatalogError && error.code === 'not_found')) {
      throw new CatalogError('archive_failed', { details: { reason: error instanceof MetadataError ? error.reason : 'no metadata.json in the archive', ref } });
    }
    throw error;
  }
}

/**
 * The selection the snapshot is built from (R4, Q24). A Bible: every candidate
 * has a state, nothing else is named, a book is included only when the default
 * branch has it and carried forward only when the release has it, and at least
 * one book is included or carried forward. Open Bible Stories: no selection is
 * sent; every story on the default branch is included, one the branch no longer
 * has is left out (ADR 0013).
 */
export function confirmedSelection(payload: ReleasePlanPayload, sent: Readonly<Record<string, SelectionState>>): Record<string, SelectionState> {
  const ids = new Set(payload.candidates.map(candidate => candidate.id));
  if (payload.project_type === 'obs') {
    if (Object.keys(sent).length > 0) throw validation('selection', 'An Open Bible Stories release takes the whole default branch; send no selection.');
    return Object.fromEntries(payload.candidates.map(candidate => [candidate.id, candidate.default_branch ? 'include' : 'leave_out']));
  }
  for (const id of Object.keys(sent)) if (!ids.has(id)) throw validation('selection', `${id} is not a book of this plan.`);
  const selection: Record<string, SelectionState> = {};
  for (const candidate of payload.candidates) {
    const state = sent[candidate.id];
    if (!state) throw validation('selection', `${candidate.id} has no selection state.`);
    if (state === 'include' && !candidate.default_branch) throw validation('selection', `${candidate.id} is not on the default branch and cannot be included.`);
    if (state === 'carry_forward' && !candidate.baseline) throw validation('selection', `${candidate.id} is not in the previous release and cannot be carried forward.`);
    selection[candidate.id] = state;
  }
  if (!Object.values(selection).some(state => state !== 'leave_out')) throw new CatalogError('invalid_selection');
  return selection;
}

/**
 * The unknown files the manager included (S5): each must be an unknown file of the default branch, and none may be
 * the path of a book carried forward, which the snapshot keeps from the release; one path has one source, so an
 * included unknown file never replaces a carried book's bytes behind the metadata's checksum (R1, R10).
 */
export function confirmedUnknowns(sent: readonly string[], branchUnknown: readonly string[], candidates: readonly Candidate[]): void {
  const carried = new Set(candidates.flatMap(candidate => (candidate.selection === 'carry_forward' && candidate.baseline ? [candidate.baseline.path] : [])));
  for (const path of sent) {
    if (!branchUnknown.includes(path)) throw validation('unknown_included', `${path} is not an unknown file of the default branch.`);
    if (carried.has(path)) throw validation('unknown_included', `${path} holds a book carried forward from the previous release and cannot also be included as an unknown file.`);
  }
}

/** The version the release takes: the manager's when given and valid, after the baseline, and a major increment when a book is removed (R9); else the proposal. */
export function confirmedVersion(sent: string | null, baselineTag: string | null, proposed: string, removal: boolean): string {
  if (sent === null) return proposed;
  const version = parseVersion(sent.trim());
  const baseline = baselineTag === null ? null : parseVersion(baselineTag);
  if (!version || (baseline && compareVersions(version, baseline) <= 0)) throw new CatalogError('invalid_version', { values: { latest: baselineTag ?? 'none' } });
  if (removal && baseline && version.major <= baseline.major) throw new CatalogError('invalid_version', { variant: 'removal', values: { major: String(baseline.major + 1) } });
  return `v${version.major}.${version.minor}.${version.patch}`;
}

const errorShape = (error: CatalogError, requestId: string): OperationErrorShape => ({
  code: error.code,
  message: error.code === 'unexpected' ? catalogMessage('unexpected', undefined, { request_id: requestId }) : error.message,
  retryable: ERROR_CATALOG[error.code].retryable,
  next_action: ERROR_CATALOG[error.code].next_action,
  request_id: requestId,
  details: { ...error.details },
  invariant: ERROR_CATALOG[error.code].invariants[0] ?? null,
});

export async function releasePrepare(input: ParsedInput<'release.prepare'>, context: OperationContext): Promise<ReleasePrepareReceipt> {
  const client = signedIn(context);
  const { account } = await readAccount(client);

  // The same plan applied again answers the same receipt and writes nothing (§1 rule 6).
  const done = await context.plans.getReceipt<ReleasePrepareReceipt>(input.plan_id);
  if (done && done.account === account.login) return done.receipt;
  const stored = await context.plans.getPlan<ReleasePlanPayload>(input.plan_id);
  if (!stored || stored.plan.operation !== 'release.plan' || stored.account !== account.login || new Date(stored.plan.expires_at).getTime() <= context.now().getTime()) {
    throw new CatalogError('plan_expired', { details: { plan_id: input.plan_id } });
  }
  const payload = stored.payload;
  if (payload.owner.toLowerCase() !== input.owner.toLowerCase() || payload.repo !== input.repo) throw validation('plan_id', 'The plan is for another project.');
  const { owner, repo } = payload;

  // The permission at the boundary (A2), the editability (W2), and the binding (R5), read live.
  const repository = await readRepository(client, owner, repo);
  const access = repositoryAccess(repository);
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner, repo } });
  const classified = classifyProject(projectCatalog(repository));
  if (classified.editability.state !== 'editable') throw new CatalogError('not_editable', { message: classified.editability.reason, details: { owner, repo } });
  const refs = repositoryRefs(repository);
  const bound = payload.bound_to;
  if (refs.default_branch?.sha !== bound.default_branch_sha || (refs.latest_full_release?.tag ?? null) !== bound.release_tag || (refs.latest_full_release?.sha ?? null) !== bound.release_tag_sha) {
    throw new CatalogError('source_changed', { details: { owner, repo, planned: bound, now: { default_branch_sha: refs.default_branch?.sha ?? null, release_tag: refs.latest_full_release?.tag ?? null, release_tag_sha: refs.latest_full_release?.sha ?? null } } });
  }

  // The selection (R4), the removals it makes (R2), and the version (R9).
  const selection = confirmedSelection(payload, input.selection);
  const candidates: Candidate[] = payload.candidates.map(candidate => ({ ...candidate, selection: selection[candidate.id] ?? 'leave_out' }));
  const removed = removals(candidates);
  const included = (group: Candidate['group']) => candidates.filter(candidate => candidate.group === group && candidate.selection === 'include');
  const proposal = proposeVersion(payload.baseline?.tag ?? null, { removed: removed.length > 0, added: included('new').length > 0, revised: included('changed_released').length > 0 });
  const version = confirmedVersion(input.version, payload.baseline?.tag ?? null, proposal.proposed, removed.length > 0);
  const branchName = temporaryBranch(version);
  const fromRelease = payload.project_type === 'bible' && payload.baseline !== null;
  const startSha = fromRelease ? payload.baseline!.sha : payload.default_branch.sha;

  // The bytes: the default branch's archive for included books, administrative files, and unknown files the manager included; the previous release's for carried books' sizes and checksums (R10).
  const branchArchive = await readArchive(client, owner, repo, payload.default_branch.sha);
  const current = await metadataOf(branchArchive, payload.default_branch.sha);
  const branchFiles = classifyFiles(current, branchArchive.entries);
  confirmedUnknowns(input.unknown_included, branchFiles.unknown, candidates);
  // Only sizes and checksums are kept here; the bytes to upload are inflated again per commit, so the Worker holds one commit's content at a time (Q22, E30).
  const sizeByPath = new Map<string, number>();
  const files: SnapshotFile[] = [];
  const take = async (archive: Archive, path: string, keep: boolean) => {
    const bytes = await archive.bytes(path);
    if (keep) sizeByPath.set(path, bytes.length);
    files.push({ path, size: bytes.length, md5: md5(bytes) });
  };
  let base: ProjectMetadata | null = null;
  let tagArchive: Archive | null = null;
  if (payload.baseline) {
    tagArchive = await readArchive(client, owner, repo, payload.baseline.sha);
    base = await metadataOf(tagArchive, payload.baseline.sha);
  }
  for (const candidate of candidates) {
    if (candidate.selection === 'include' && candidate.default_branch) await take(branchArchive, candidate.default_branch.path, true);
    else if (candidate.selection === 'carry_forward' && candidate.baseline && tagArchive) await take(tagArchive, candidate.baseline.path, false);
  }
  tagArchive = null;
  for (const path of branchFiles.administrative) {
    const bytes = await branchArchive.bytes(path);
    sizeByPath.set(path, bytes.length);
    if (path.startsWith('ingredients/')) files.push({ path, size: bytes.length, md5: md5(bytes) });
  }
  for (const path of input.unknown_included) sizeByPath.set(path, (await branchArchive.bytes(path)).length);

  let merged: ReturnType<typeof mergeReleaseMetadata>;
  try {
    merged = mergeReleaseMetadata({ current, base, selection, files, unknown_included: input.unknown_included });
  } catch (error) {
    if (error instanceof MetadataError) throw new CatalogError('unexpected', { details: { reason: `the release metadata could not be merged: ${error.reason}` } });
    throw error;
  }
  const metadataBytes = new TextEncoder().encode(`${JSON.stringify(merged.metadata, null, 2)}\n`);

  // The blobs of the default branch and of the ref the branch starts from (E19): what is already there is not uploaded, what is deleted needs its SHA (E21).
  const branchTree = await readTree(client, owner, repo, payload.default_branch.sha);
  const startTree = fromRelease ? await readTree(client, owner, repo, startSha) : branchTree;
  const startBlobs = new Map(startTree.files.map(file => [file.path, file.sha]));
  const snapshot = planSnapshot({
    project_type: payload.project_type,
    from_release: fromRelease,
    candidates,
    selection,
    branch: branchFiles,
    branch_blobs: new Map(branchTree.files.map(file => [file.path, file.sha])),
    start_blobs: startBlobs,
    // The byte lengths read, so a size the tree does not give still counts (Q22).
    sizes: sizeByPath,
    unknown_included: input.unknown_included,
    metadata_size: metadataBytes.length,
  });
  const announced = ((stored.plan as unknown as ReleasePlan).would_write ?? []).filter(write => write.kind === 'commit').length;
  if (snapshot.commits.length > announced) throw new CatalogError('unexpected', { details: { reason: 'the snapshot needs more commits than the plan announced', announced, needed: snapshot.commits.length } });
  const oversized = snapshot.commits.find(commit => commitBytes(commit) > MAX_COMMIT_BYTES);
  if (oversized) throw new CatalogError('unexpected', { details: { reason: 'a file of the snapshot is larger than one commit may carry', bytes: commitBytes(oversized), ceiling: MAX_COMMIT_BYTES } });

  const notes = releaseNotesDraft({
    owner,
    repo,
    version,
    baseline_tag: payload.baseline?.tag ?? null,
    source: { branch: payload.default_branch.name, sha: payload.default_branch.sha },
    units: payload.project_type === 'obs' ? 'stories' : 'books',
    added: included('new').map(named),
    revised: included('changed_released').map(named),
    removed: candidates.filter(candidate => removed.includes(candidate.id)).map(named),
    carried_forward: candidates.filter(candidate => candidate.selection === 'carry_forward').map(named),
    unknown_included: input.unknown_included,
  });

  // The writes (R3): the branch, then the commits, each sent once (X1), all on the branch.
  const started = context.now();
  const target = `${owner}/${repo}@${branchName}`;
  const at = () => context.now().toISOString();
  const history: Preparation['history'] = [
    { at: (stored.plan as unknown as ReleasePlan).created_at, from: null, to: 'selecting', event: 'release.plan' },
    { at: at(), from: 'selecting', to: 'snapshot_prepared', event: 'release.prepare' },
  ];
  const preparation = (state: Preparation['state'], commitSha: string, lastError: OperationErrorShape | null): Preparation => ({
    id: version,
    project_ref: { owner, repo },
    state,
    bound_to: bound,
    selection: { new: included('new').map(candidate => candidate.id), revised: included('changed_released').map(candidate => candidate.id), unknown_included: [...input.unknown_included] },
    snapshot: { branch: branchName, commit_sha: commitSha, files: snapshot.files },
    health: { state: 'checking', severity_raw: null, ref: branchName, checked_at: null, issue_count: null, source: 'door43' },
    requires_acknowledgement: false,
    version: { baseline_tag: payload.baseline?.tag ?? null, proposed: proposal.proposed, confirmed: version },
    notes: { draft: notes, confirmed: null },
    release: null,
    last_error: lastError,
    history,
    freshness: { read_at: at(), source: 'live', age_seconds: 0 },
  });
  // Once Door43 holds the branch, every failure is stored as `retryable_failure` before it is reported, so the branch never lacks its preparation (R7, X1).
  const recordFailure = async (commitSha: string, error: unknown, step: string) => {
    const known = error instanceof CatalogError ? error : new CatalogError('unexpected', { details: { reason: error instanceof Error ? error.message : String(error) } });
    history.push({ at: at(), from: 'snapshot_prepared', to: 'retryable_failure', event: `${step}: ${known.code}` });
    await context.plans.putPreparation(owner, repo, version, preparation('retryable_failure', commitSha, errorShape(known, context.requestId)));
  };

  let branch: { sha: string };
  try {
    branch = await createBranch(client, owner, repo, branchName, startSha);
  } catch (error) {
    // Door43 created the branch (201) but its answer could not be read: the branch exists, so its preparation is stored too.
    if (error instanceof CatalogError && error.details.door43_status === 201) await recordFailure(startSha, error, 'branch');
    throw error;
  }
  const wrote: ReleasePrepareReceipt['wrote'] = [{ kind: 'branch', target, sha: branch.sha }];

  // A path the start ref lacks is created; one it has is replaced by `upload` (E27). Bytes are inflated for this commit only.
  const commitFilesOf = async (writes: readonly SnapshotWrite[]): Promise<CommitFile[]> => {
    const out: CommitFile[] = [];
    for (const write of writes) {
      if (write.operation === 'delete') out.push({ path: write.path, operation: 'delete', sha: write.sha });
      else out.push({ path: write.path, content: write.path === 'metadata.json' ? metadataBytes : await branchArchive.bytes(write.path), operation: startBlobs.has(write.path) ? 'upload' : 'create' });
    }
    return out;
  };
  let last: Commit | null = null;
  for (const [index, batch] of snapshot.commits.entries()) {
    try {
      last = await commitFiles(client, owner, repo, {
        message: `Release ${version}: snapshot${snapshot.commits.length > 1 ? ` (${index + 1} of ${snapshot.commits.length})` : ''}\n\nPrepared by ${context.application.name} ${context.application.version} from ${payload.default_branch.name} at ${payload.default_branch.sha.slice(0, 10)}.`,
        branch: branchName,
        files: await commitFilesOf(batch),
      });
      wrote.push({ kind: 'commit', target, sha: last.sha, url: last.url });
    } catch (error) {
      // The branch is kept (R7), nothing is retried (X1): the preparation records the failure for the retry.
      await recordFailure(last?.sha ?? branch.sha, error, `commit ${index + 1} of ${snapshot.commits.length}`);
      throw error;
    }
  }
  history.push({ at: at(), from: 'snapshot_prepared', to: 'health_checking', event: 'push confirmed' });
  const result = preparation('health_checking', last?.sha ?? branch.sha, null);
  await context.plans.putPreparation(owner, repo, version, result);
  const receipt: ReleasePrepareReceipt = {
    operation: 'release.prepare',
    request_id: context.requestId,
    plan_id: input.plan_id,
    started_at: started.toISOString(),
    finished_at: at(),
    wrote,
    result,
    warnings: [],
  };
  await context.plans.putReceipt(input.plan_id, { receipt, account: account.login });
  return receipt;
}

const named = (candidate: Candidate) => ({ id: candidate.id, title: (candidate.default_branch ?? candidate.baseline)?.title ?? '' });
