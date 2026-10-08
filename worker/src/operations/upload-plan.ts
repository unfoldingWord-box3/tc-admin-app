// `upload.plan` (operations.md §4, #74): files the manager has, identified as
// books or stories and planned as one commit to the default branch, with
// nothing written (ADR 0011). The bytes arrive in the request and are never
// stored: the plan keeps only what it computed from them, each file's path,
// size, and md5, the overwrite facts, and the proposed `metadata.json`, and
// `upload.apply` receives the same files again and commits only bytes whose
// md5 the plan holds (decided 8 October 2026 by Rich, Q33). In this order:
// every name and size is checked before anything else reads the batch (W6);
// then the account and the repository are read, and a project without push
// permission (A2) or that is not editable (W2) is refused before anything
// else is read; then each file is identified (#72), or takes the manager's
// confirmation, and two files for one book or story are refused; then the
// default branch's head, its tree (E19, E63), and its Scripture Burrito
// archive at that commit (E34) are read, for the overwrites, their diffs, and
// the current metadata the proposed entries are merged into (W1, R10). The
// plan is bound to the head commit (R5).

import { CatalogError, catalogMessage } from '@tc-admin/shared/schema';
import type { BoundTo, OperationOutput, ParsedInput, Warning } from '@tc-admin/shared/schema';
import { readArchive } from '../door43/archive';
import type { Archive } from '../door43/archive';
import { readAccount } from '../door43/auth';
import { readBranchHead } from '../door43/branches';
import { projectCatalog } from '../door43/catalog';
import { readRepository, repositoryAccess } from '../door43/repos';
import { readTree } from '../door43/trees';
import { METADATA_PATH, mergeUploadMetadata, metadataFile } from '../model/burrito';
import type { CreatableProjectType, MergedUpload, Unit } from '../model/burrito';
import { MetadataError, parseMetadata } from '../model/burrito-reader';
import type { ProjectMetadata } from '../model/burrito-reader';
import { gitBlobSha } from '../model/git-blob';
import { md5 } from '../model/md5';
import { classifyProject } from '../model/project';
import { textDiff } from '../model/text-diff';
import { confirmFile, headerBook, identifyFile } from '../model/upload';
import type { IdentifiedFile, Identification } from '../model/upload';
import { MAX_UPLOAD_BYTES, checkUpload, normalizeUploadName } from '../model/upload-paths';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { PLAN_SECONDS, newPlanId } from './plans';

export type UploadPlan = OperationOutput<'upload.plan'>;

/**
 * The most bytes an upload request may declare before its body is read: the batch
 * limit and a mebibyte for the multipart framing around it. A larger body is refused
 * before it is parsed (the HTTP projection), so the Worker never holds more than one
 * batch; the batch itself is checked against `MAX_UPLOAD_BYTES` by its bytes (W6).
 */
export const UPLOAD_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

/** One file as the plan stores it for the apply: what was computed from its bytes, never the bytes (Q33). */
export interface PlannedUpload {
  name: string;
  identified: Unit | null;
  path: string | null;
  size: number;
  md5: string;
  /** Whether the manager's confirmation, not the header and name, identified it. */
  confirmed: boolean;
  overwrite: boolean;
  /** The blob the default branch holds at the path, when the file overwrites one (E19). */
  replaces_sha: string | null;
}

/** What `upload.apply` (#75) needs: the binding, every file as planned, and the proposed `metadata.json` whole. */
export interface UploadPlanPayload {
  owner: string;
  repo: string;
  project_type: CreatableProjectType;
  bound_to: BoundTo;
  default_branch: { name: string; sha: string };
  files: PlannedUpload[];
  /** `null` when no file is identified, and nothing would be written. */
  metadata: { path: string; content: string; size: number; md5: string } | null;
}

const unitId = (unit: Unit) => ('book' in unit ? unit.book : unit.story);
const unitName = (unit: Unit) => ('book' in unit ? unit.book.toUpperCase() : `story ${unit.story}`);
const quoted = (name: string) => JSON.stringify(name);

/** The confirmations by the repository-relative name of the file each names; a key that names no file of the batch is `validation_failed`. */
function confirmationsByName(confirmations: Readonly<Record<string, Unit>>, names: ReadonlySet<string>): Map<string, Unit> {
  const byName = new Map<string, Unit>();
  const keyOf = new Map<string, string>();
  const fields: { path: string; message: string }[] = [];
  for (const [key, unit] of Object.entries(confirmations)) {
    const path = normalizeUploadName(key);
    if (!path.ok || !names.has(path.path)) {
      fields.push({ path: `confirmations.${key}`, message: `${quoted(key)} names no file of this upload` });
      continue;
    }
    // Two keys for one file (`./GEN.usfm` and `GEN.usfm`) are ambiguous: neither silently wins.
    const earlier = keyOf.get(path.path);
    if (earlier !== undefined) {
      fields.push({ path: `confirmations.${key}`, message: `${quoted(key)} and ${quoted(earlier)} name the same file` });
      continue;
    }
    keyOf.set(path.path, key);
    byName.set(path.path, unit);
  }
  if (fields.length > 0) {
    throw new CatalogError('validation_failed', { message: fields.map(field => `${field.path}: ${field.message}`).join('; '), details: { fields } });
  }
  return byName;
}

/**
 * Two files identified as one book or story cannot both be written to its one path:
 * the batch is refused, every such file named, and the manager drops one or names
 * another unit for it (built behind for Rich, #74; the narrowest reading of W6's
 * "two names for one path").
 */
function refuseSharedUnits(identified: readonly { index: number; file: Identification }[]): void {
  const byUnit = new Map<string, { index: number; file: IdentifiedFile }[]>();
  for (const { index, file } of identified) {
    if (file.identified === null) continue;
    const key = unitId(file.identified);
    byUnit.set(key, [...(byUnit.get(key) ?? []), { index, file }]);
  }
  const shared = [...byUnit.values()].filter(files => files.length > 1).flat();
  if (shared.length === 0) return;
  const fields = shared.map(({ index, file }) => ({
    path: `files.${index}.name`,
    message: `${quoted(file.name)}: the file is ${unitName(file.identified)} (${file.path}), as is ${byUnit
      .get(unitId(file.identified))!
      .filter(other => other.index !== index)
      .map(other => quoted(other.file.name))
      .join(', ')}`,
  }));
  throw new CatalogError('validation_failed', {
    message: fields.map(field => `${field.path}: ${field.message}`).join('; '),
    details: { fields, files: shared.map(({ file }) => ({ name: file.name, reason: 'same_unit', unit: file.identified })) },
  });
}

/** The archive's bytes for a path, which must be the blob the tree lists there: an archive of another commit is no ground for a plan (R5). */
async function branchBytes(archive: Archive, path: string, sha: string, details: Record<string, unknown>): Promise<Uint8Array> {
  const mismatch = () => new CatalogError('door43_unavailable', { details: { ...details, path, reason: 'the archive does not match the default branch tree' } });
  // A file the tree lists and the archive lacks is the same disagreement, not a missing project.
  if (path !== METADATA_PATH && !archive.entries.some(entry => entry.path === path)) throw mismatch();
  const bytes = await archive.bytes(path);
  if ((await gitBlobSha(bytes)) !== sha) throw mismatch();
  return bytes;
}

export async function uploadPlan(input: ParsedInput<'upload.plan'>, context: OperationContext): Promise<UploadPlan> {
  const client = signedIn(context);
  // W6 first, before identification or any Door43 read: every name, mode, and size, the sizes measured from the bytes received.
  const checked = checkUpload(input.files.map(file => ({ name: file.name, size: file.content.length, mode: file.mode, content: file.content })));
  if (!checked.ok) throw checked.error;
  const confirmations = confirmationsByName(input.confirmations ?? {}, new Set(checked.files.map(file => file.name)));
  const where = { owner: input.owner, repo: input.repo };

  const { account } = await readAccount(client);
  const repository = await readRepository(client, input.owner, input.repo);
  const access = repositoryAccess(repository);
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: where });
  // W2: an unsupported project is refused with its reason, and nothing more is read.
  const classified = classifyProject(projectCatalog(repository));
  if (classified.editability.state !== 'editable' || classified.project_type === 'other') {
    throw new CatalogError('not_editable', { message: classified.editability.reason, details: { ...where, project_type: classified.project_type, metadata_format: classified.metadata_format } });
  }
  const type: CreatableProjectType = classified.project_type;

  // Identification (#72): the manager's confirmation, when there is one, else the header and the name.
  const warnings: Warning[] = [];
  const identified = checked.files.map((file, index) => {
    const uploaded = { name: file.name, bytes: file.content };
    const confirmation = confirmations.get(file.name);
    const result = confirmation ? confirmFile(uploaded, confirmation, type) : identifyFile(uploaded, type);
    // The bytes are committed as they are (W1): a confirmed book whose \id line names another, or none, is said, never rewritten (#74, for Rich).
    if (confirmation && result.identified && 'book' in result.identified && headerBook(file.content) !== result.identified.book) {
      warnings.push({ code: 'id_line_mismatch', message: catalogMessage('id_line_mismatch', undefined, { 'file name': file.name, unit: unitName(result.identified) }) });
    }
    return { index, file: result, confirmed: Boolean(confirmation), content: file.content };
  });
  refuseSharedUnits(identified);

  // The default branch at its head commit: the tree for what each path holds (E19; its own sha is the tree's, E63), the archive for the bytes.
  const branch = repository.default_branch;
  if (!branch) throw new CatalogError('door43_unavailable', { details: { ...where, reason: 'no default branch named' } });
  const head = await readBranchHead(client, input.owner, input.repo, branch);
  const [tree, archive] = await Promise.all([readTree(client, input.owner, input.repo, head.sha), readArchive(client, input.owner, input.repo, head.sha)]);
  const onBranch = new Map(tree.files.map(file => [file.path, file.sha]));
  const at = { ...where, sha: head.sha };

  const metadataSha = onBranch.get(METADATA_PATH);
  let current: ProjectMetadata;
  try {
    if (!metadataSha) throw new MetadataError('no metadata.json on the default branch');
    current = parseMetadata(await branchBytes(archive, METADATA_PATH, metadataSha, at));
  } catch (error) {
    if (error instanceof MetadataError || (error instanceof CatalogError && error.code === 'not_found')) {
      throw new CatalogError('archive_failed', { details: { ...at, reason: error instanceof MetadataError ? error.reason : 'no metadata.json in the archive' } });
    }
    throw error;
  }
  // The catalog said what the project is; the metadata at the commit must say the same, or the catalog has not caught up (a retry).
  if (current.project_type !== type) throw new CatalogError('door43_unavailable', { details: { ...at, reason: 'the catalog and the metadata disagree on the project type', catalog: type, metadata: current.project_type } });

  const files: UploadPlan['preview']['files'] = [];
  const stored: PlannedUpload[] = [];
  const added: IdentifiedFile[] = [];
  for (const { file, confirmed, content } of identified) {
    const size = content.length;
    const digest = md5(content);
    if (file.identified === null) {
      files.push({ name: file.name, identified: null, path: null, size, md5: digest, overwrite: false, diff: null });
      stored.push({ name: file.name, identified: null, path: null, size, md5: digest, confirmed, overwrite: false, replaces_sha: null });
      continue;
    }
    const replaces = onBranch.get(file.path) ?? null;
    let diff: string | null = null;
    if (replaces !== null) {
      // The same blob is the same bytes: no diff to read. Otherwise the old bytes from the archive, checked against the tree.
      diff = (await gitBlobSha(content)) === replaces ? '' : textDiff(file.path, await branchBytes(archive, file.path, replaces, at), content);
    }
    files.push({ name: file.name, identified: file.identified, path: file.path, size, md5: digest, overwrite: replaces !== null, diff });
    stored.push({ name: file.name, identified: file.identified, path: file.path, size, md5: digest, confirmed, overwrite: replaces !== null, replaces_sha: replaces });
    added.push(file);
  }

  let merged: MergedUpload;
  try {
    merged = mergeUploadMetadata(current, added);
  } catch (error) {
    // The project's metadata lists a planned book or story elsewhere: the manager cannot fix that by choosing differently here.
    if (error instanceof MetadataError) throw new CatalogError('validation_failed', { message: `metadata.json: ${error.reason}`, details: { ...where, reason: error.reason } });
    throw error;
  }
  const metadata = added.length > 0 ? metadataFile(merged.metadata) : null;

  const now = context.now();
  const bound_to: BoundTo = { default_branch_sha: head.sha, release_tag: null, release_tag_sha: null };
  const plan: UploadPlan = {
    id: newPlanId(),
    operation: 'upload.plan',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PLAN_SECONDS * 1000).toISOString(),
    bound_to,
    preview: {
      files,
      metadata_diff: { ingredients: merged.entries },
      unknown: files.filter(file => file.identified === null).map(file => file.name),
    },
    // One commit to the default branch with every identified file and the metadata (W5), or nothing when no file is identified.
    would_write: added.length > 0 ? [{ kind: 'commit', target: `${input.owner}/${input.repo}@${branch}` }] : [],
    warnings,
  };
  const payload: UploadPlanPayload = {
    owner: input.owner,
    repo: input.repo,
    project_type: type,
    bound_to,
    default_branch: { name: branch, sha: head.sha },
    files: stored,
    metadata: metadata ? { path: metadata.path, content: metadata.content, size: metadata.size, md5: metadata.md5 } : null,
  };
  // The plan without its preview, whose diffs the apply does not need (the payload has the rest), and never the bytes (Q33).
  const kept = { id: plan.id, operation: plan.operation, created_at: plan.created_at, expires_at: plan.expires_at, bound_to, would_write: plan.would_write, warnings };
  await context.plans.putPlan({ plan: kept, payload, account: account.login });
  return plan;
}
