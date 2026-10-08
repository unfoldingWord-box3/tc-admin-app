// `import.plan` (operations.md §4, #79): books or stories from an existing
// Door43 repository, in any metadata format, through its Scripture Burrito
// archive (E1, E34; ADR 0013), planned as one commit to the project's default
// branch with nothing written (ADR 0011), the source read and never written
// (W2). In this order: the account and the project are read, and a project
// without push permission (A2) or that is not editable (W2) is refused before
// anything else is read; the chosen units are checked to be books or stories
// of the project's type; then the source repository is read, refused when it
// does not exist (`not_found`) or is not a repository of the project's type,
// and its revision resolved to a release's commit or the default branch's
// head; then the project's default branch, its tree, and its archive at that
// commit (E19, E34, E63) and the source's archive (E1) are read, the archive
// Door43 cannot serve being `source_unavailable`. Each chosen unit's file is
// taken from the source archive's `ingredients/` by its Scripture Burrito path
// (E17, E36), inflated one at a time and never held together (Q12, Q22), and
// planned as `upload.plan` plans a file: overwrite from the project's tree,
// a text diff where practical, an ingredient entry with the size and md5 of
// the bytes (R10); the proposed `metadata.json` adds those entries, one
// `source` relationship for the source and revision, and the `dcs` authority
// (E24, W1). The plan is bound to the project's head commit (R5) and stores
// what it computed, never the bytes.

import { CatalogError, catalogMessage } from '@tc-admin/shared/schema';
import type { BoundTo, OperationOutput, ParsedInput, Warning } from '@tc-admin/shared/schema';
import { readArchive } from '../door43/archive';
import type { Archive } from '../door43/archive';
import type { Door43Client } from '../door43/api';
import { readAccount } from '../door43/auth';
import { readBranchHead } from '../door43/branches';
import { projectCatalog } from '../door43/catalog';
import { readReleaseByTag } from '../door43/releases';
import { readRepository, repositoryAccess } from '../door43/repos';
import type { Door43SearchRepository } from '../door43/repos';
import { readTree } from '../door43/trees';
import { BIBLE_BOOKS, STORIES, bookId, storyId } from '../model/books';
import { METADATA_PATH, TYPE_TERM, mergeImportMetadata, metadataFile, unitIngredient, unitPath } from '../model/burrito';
import type { AddedUnit, CreatableProjectType, ImportSource, MergedImport, Unit } from '../model/burrito';
import { MetadataError, parseMetadata } from '../model/burrito-reader';
import type { ProjectMetadata } from '../model/burrito-reader';
import { gitBlobSha } from '../model/git-blob';
import { md5 } from '../model/md5';
import { classifyProject, projectTypeFromFlavor } from '../model/project';
import { textDiff } from '../model/text-diff';
import { headerBook } from '../model/upload';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { PLAN_SECONDS, newPlanId } from './plans';

export type ImportPlan = OperationOutput<'import.plan'>;

/** One imported file as the plan stores it for the apply (#80): what was computed from its bytes, never the bytes. */
export interface PlannedImport {
  /** Its path in the source's archive, the same as its path in the project (E17, E36). */
  source_path: string;
  identified: Unit;
  path: string;
  size: number;
  md5: string;
  overwrite: boolean;
  /** The blob the project's default branch holds at the path, when the file overwrites one (E19). */
  replaces_sha: string | null;
}

/** What `import.apply` (#80) needs: the binding, the source and the ref its archive is read by again, every file as planned, and the proposed `metadata.json` whole. */
export interface ImportPlanPayload {
  owner: string;
  repo: string;
  project_type: CreatableProjectType;
  bound_to: BoundTo;
  default_branch: { name: string; sha: string };
  source: {
    owner: string;
    repo: string;
    /** As asked: a release tag or the default branch's name. */
    revision: string;
    /** The commit the revision named when the plan was made. */
    sha: string;
    /** The ref the archive was read by, and is read by again at apply: the release tag, or the default branch's head commit. */
    archive_ref: string;
    /** The revision the `source` relationship records (E24): the tag, or the default branch's head commit. */
    relationship_revision: string;
  };
  files: PlannedImport[];
  metadata: { path: string; content: string; size: number; md5: string };
}

const unitId = (unit: Unit) => ('book' in unit ? unit.book : unit.story);
const unitName = (unit: Unit) => ('book' in unit ? unit.book.toUpperCase() : `story ${unit.story}`);
const unitTerm = (type: CreatableProjectType) => (type === 'bible' ? 'book' : 'story');
const quoted = (value: string) => JSON.stringify(value);
/** The project type with its article: "a Bible", "an Open Bible Stories". */
const aType = (type: CreatableProjectType) => `${/^[aeiou]/i.test(TYPE_TERM[type]) ? 'an' : 'a'} ${TYPE_TERM[type]}`;

function fieldsFailed(fields: { path: string; message: string }[], details: Record<string, unknown> = {}): CatalogError {
  return new CatalogError('validation_failed', { message: fields.map(field => `${field.path}: ${field.message}`).join('; '), details: { ...details, fields } });
}

/** The chosen units in canonical spelling and the order given; an id that is no book or story of the project's type, a repeated one, or none at all is `validation_failed`. */
function chosenUnits(ids: readonly string[], type: CreatableProjectType): Unit[] {
  if (ids.length === 0) throw fieldsFailed([{ path: 'units', message: `choose at least one ${unitTerm(type)}, or all` }]);
  const units: Unit[] = [];
  const seen = new Map<string, number>();
  const fields: { path: string; message: string }[] = [];
  ids.forEach((id, index) => {
    const canonical = type === 'bible' ? bookId(id) : storyId(id.trim().padStart(2, '0'));
    if (canonical === null) {
      fields.push({ path: `units[${index}]`, message: `${quoted(id)} is not a ${unitTerm(type)} of ${aType(type)} project` });
      return;
    }
    const earlier = seen.get(canonical);
    if (earlier !== undefined) {
      fields.push({ path: `units[${index}]`, message: `${quoted(id)} is chosen twice (also units[${earlier}])` });
      return;
    }
    seen.set(canonical, index);
    units.push(type === 'bible' ? { book: canonical } : { story: canonical });
  });
  if (fields.length > 0) throw fieldsFailed(fields);
  return units;
}

/** Every book or story the source's archive holds at its Scripture Burrito path (E17, E36), in canonical order, and nothing else of the archive. */
function archiveUnits(archive: Archive, type: CreatableProjectType): Unit[] {
  const paths = new Set(archive.entries.map(entry => entry.path));
  const all: Unit[] = type === 'bible' ? BIBLE_BOOKS.map(book => ({ book })) : STORIES.map(story => ({ story }));
  return all.filter(unit => paths.has(unitPath(unit)));
}

/** The source's archive at the ref, or `source_unavailable` for any failure of Door43 to serve it (not a missing session or a refused token). */
async function readSourceArchive(client: Door43Client, source: ImportPlanPayload['source']): Promise<Archive> {
  try {
    return await readArchive(client, source.owner, source.repo, source.archive_ref);
  } catch (error) {
    if (error instanceof CatalogError && (error.code === 'not_found' || error.code === 'door43_unavailable')) {
      throw new CatalogError('source_unavailable', { details: { source: { owner: source.owner, repo: source.repo, revision: source.revision, ref: source.archive_ref }, ...error.details }, cause: error });
    }
    throw error;
  }
}

/** One file's bytes from the source's archive; an entry Door43 wrote that cannot be read is `source_unavailable` too. */
async function sourceBytes(archive: Archive, path: string, source: ImportPlanPayload['source']): Promise<Uint8Array> {
  try {
    return await archive.bytes(path);
  } catch (error) {
    if (error instanceof CatalogError && (error.code === 'not_found' || error.code === 'door43_unavailable')) {
      throw new CatalogError('source_unavailable', { details: { source: { owner: source.owner, repo: source.repo, revision: source.revision }, path, ...error.details }, cause: error });
    }
    throw error;
  }
}

/** The project archive's bytes for a path, which must be the blob the tree lists there: an archive of another commit is no ground for a plan (R5). */
async function branchBytes(archive: Archive, path: string, sha: string, details: Record<string, unknown>): Promise<Uint8Array> {
  const mismatch = () => new CatalogError('door43_unavailable', { details: { ...details, path, reason: 'the archive does not match the default branch tree' } });
  if (path !== METADATA_PATH && !archive.entries.some(entry => entry.path === path)) throw mismatch();
  const bytes = await archive.bytes(path);
  if ((await gitBlobSha(bytes)) !== sha) throw mismatch();
  return bytes;
}

/** The source repository, or `not_found` naming it. */
async function readSource(client: Door43Client, ref: { owner: string; repo: string }): Promise<Door43SearchRepository> {
  try {
    return await readRepository(client, ref.owner, ref.repo);
  } catch (error) {
    if (error instanceof CatalogError && error.code === 'not_found') {
      throw new CatalogError('not_found', { message: 'The source repository was not found on Door43.', details: { source: ref, ...error.details } });
    }
    throw error;
  }
}

/**
 * The revision resolved against the source: its default branch, read for its head
 * (E63), or one of its releases, read by tag (E21). Anything else, a draft release
 * among it, is `validation_failed` on `source.revision` (built behind, #79).
 */
async function resolveRevision(client: Door43Client, input: ParsedInput<'import.plan'>, repository: Door43SearchRepository): Promise<ImportPlanPayload['source']> {
  const { owner, repo, revision } = input.source;
  if (repository.default_branch && revision === repository.default_branch) {
    const head = await readBranchHead(client, owner, repo, revision);
    return { owner, repo, revision, sha: head.sha, archive_ref: head.sha, relationship_revision: head.sha };
  }
  const release = await readReleaseByTag(client, owner, repo, revision);
  if (!release || release.draft) {
    throw fieldsFailed([{ path: 'source.revision', message: `${quoted(revision)} is not a release or the default branch of ${owner}/${repo}` }], { source: input.source });
  }
  if (!release.target_sha) throw new CatalogError('door43_unavailable', { details: { source: input.source, reason: 'the release names no commit' } });
  return { owner, repo, revision, sha: release.target_sha, archive_ref: revision, relationship_revision: revision };
}

export async function importPlan(input: ParsedInput<'import.plan'>, context: OperationContext): Promise<ImportPlan> {
  const client = signedIn(context);
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
  const chosen = input.units === 'all' ? null : chosenUnits(input.units, type);

  // The source: any repository of the project's type, in any metadata format (ADR 0013), at a release or its default branch.
  const sourceRepository = await readSource(client, input.source);
  const sourceType = projectTypeFromFlavor(projectCatalog(sourceRepository).flavor);
  if (sourceType !== type) {
    const what = sourceType === 'other' ? 'not a Bible or Open Bible Stories repository' : `${aType(sourceType)} repository`;
    throw fieldsFailed([{ path: 'source', message: `${input.source.owner}/${input.source.repo} is ${what}; ${aType(type)} project imports from ${aType(type)} repository` }], { source: input.source, project_type: type, source_type: sourceType });
  }
  const source = await resolveRevision(client, input, sourceRepository);

  // The project's default branch at its head commit (E19, E63) and the two archives (E34), the source's by the commit or tag resolved.
  const branch = repository.default_branch;
  if (!branch) throw new CatalogError('door43_unavailable', { details: { ...where, reason: 'no default branch named' } });
  const head = await readBranchHead(client, input.owner, input.repo, branch);
  const [tree, archive, sourceArchive] = await Promise.all([
    readTree(client, input.owner, input.repo, head.sha),
    readArchive(client, input.owner, input.repo, head.sha),
    readSourceArchive(client, source),
  ]);
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
  if (current.project_type !== type) throw new CatalogError('door43_unavailable', { details: { ...at, reason: 'the catalog and the metadata disagree on the project type', catalog: type, metadata: current.project_type } });

  // The units: the ones chosen, each of which the source must hold at its path, or every one the archive holds.
  const sourcePaths = new Set(sourceArchive.entries.map(entry => entry.path));
  const units = chosen ?? archiveUnits(sourceArchive, type);
  if (chosen === null && units.length === 0) {
    throw fieldsFailed([{ path: 'units', message: `${source.owner}/${source.repo} at ${quoted(source.revision)} holds no ${unitTerm(type)} under ingredients/` }], { source: input.source });
  }
  const missing = units.filter(unit => !sourcePaths.has(unitPath(unit)));
  if (missing.length > 0) {
    throw fieldsFailed(
      missing.map(unit => ({ path: `units[${units.indexOf(unit)}]`, message: `${source.owner}/${source.repo} at ${quoted(source.revision)} has no ${unitName(unit)} (${unitPath(unit)})` })),
      { source: input.source, units: missing.map(unit => ({ id: unitId(unit), reason: 'not_in_source' })) },
    );
  }

  const warnings: Warning[] = [];
  const files: ImportPlan['preview']['files'] = [];
  const stored: PlannedImport[] = [];
  const added: AddedUnit[] = [];
  for (const unit of units) {
    const path = unitPath(unit);
    // One file inflated at a time, and dropped once measured: an aligned Bible's archive is 106 MB unpacked (E30, Q12).
    const content = await sourceBytes(sourceArchive, path, source);
    const size = content.length;
    const digest = md5(content);
    // The bytes are committed as they are (W1): a book whose \id line names another book, or none, is said, never rewritten.
    if ('book' in unit && headerBook(content) !== unit.book) {
      warnings.push({ code: 'id_line_mismatch', message: catalogMessage('id_line_mismatch', undefined, { 'file name': path, unit: unitName(unit) }) });
    }
    const replaces = onBranch.get(path) ?? null;
    let diff: string | null = null;
    if (replaces !== null) {
      diff = (await gitBlobSha(content)) === replaces ? '' : textDiff(path, await branchBytes(archive, path, replaces, at), content);
    }
    files.push({ name: path, identified: unit, path, size, md5: digest, overwrite: replaces !== null, diff });
    stored.push({ source_path: path, identified: unit, path, size, md5: digest, overwrite: replaces !== null, replaces_sha: replaces });
    added.push({ identified: unit, path, ingredient: unitIngredient(unit, content) });
  }

  const relationshipSource: ImportSource = { owner: source.owner, repo: source.repo, revision: source.relationship_revision };
  let merged: MergedImport;
  try {
    merged = mergeImportMetadata(current, added, relationshipSource);
  } catch (error) {
    if (error instanceof MetadataError) throw new CatalogError('validation_failed', { message: `metadata.json: ${error.reason}`, details: { ...where, reason: error.reason } });
    throw error;
  }
  const metadata = metadataFile(merged.metadata);

  const now = context.now();
  const bound_to: BoundTo = { default_branch_sha: head.sha, release_tag: null, release_tag_sha: null };
  const plan: ImportPlan = {
    id: newPlanId(),
    operation: 'import.plan',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PLAN_SECONDS * 1000).toISOString(),
    bound_to,
    preview: {
      source: { owner: source.owner, repo: source.repo, revision: source.revision, sha: source.sha },
      files,
      metadata_diff: { ingredients: merged.entries, relationships: merged.relationships },
    },
    // One commit to the project's default branch with every chosen file and the metadata (W5); the source is never written (W2).
    would_write: [{ kind: 'commit', target: `${input.owner}/${input.repo}@${branch}` }],
    warnings,
  };
  const payload: ImportPlanPayload = {
    owner: input.owner,
    repo: input.repo,
    project_type: type,
    bound_to,
    default_branch: { name: branch, sha: head.sha },
    source,
    files: stored,
    metadata: { path: metadata.path, content: metadata.content, size: metadata.size, md5: metadata.md5 },
  };
  const kept = { id: plan.id, operation: plan.operation, created_at: plan.created_at, expires_at: plan.expires_at, bound_to, would_write: plan.would_write, warnings };
  await context.plans.putPlan({ plan: kept, payload, account: account.login });
  return plan;
}
