// The Scripture Burrito writer (ADR 0008): the only module that writes
// project metadata (W1). The metadata and files of a new project, a Bible
// (`scripture/textTranslation`, #29) or Open Bible Stories
// (`gloss/textStories`, #82); the path and ingredient entry of a book or
// story an upload or import adds (#72), and the metadata an upload proposes with
// their entries (#74); and the merge for a release snapshot (#35,
// ADR 0010): ingredient entries from the previous release for carried-forward
// books and from the default branch for included books and administrative
// ingredients, every top-level field from the default branch (Q8), the scope
// set to the released books (Q7), and the size and md5 of every entry
// recomputed from the bytes in the snapshot, never copied from a base whose
// checksums may be stale (E5, R10). Pure: no I/O, no Door43 shape. What the
// schema requires is E37; the recorded schema is
// `fixtures/scripture-burrito/2026-10-05/` (E44), and the tests validate the
// output against it.

import { TEXT_TRANSLATION_FLAVOR_DEFAULTS } from '@tc-admin/shared/schema';
import type { ProjectType, SelectionState, TextTranslationFlavor } from '@tc-admin/shared/schema';
import { BIBLE_BOOKS, NEW_TESTAMENT, OLD_TESTAMENT, STORIES, bookId, storyId } from './books';
import { MetadataError, classifyIngredient, isRecord, unitIngredients } from './burrito-reader';
import type { MetadataIngredient, ProjectMetadata } from './burrito-reader';
import { CC_BY_SA_4_0_TEXT } from './license-cc-by-sa-4.0';
import { md5 } from './md5';
import { OBS_SCOPE } from './obs-scope';

/**
 * The `dcs` id authority every project tC Admin writes declares, as Door43's own
 * converter writes it (`go-rc2sb`, E17, E46): without a trailing slash, settled by #29
 * and confirmed by Rich (E24). The id names the authority, not the host, so it is the
 * same on QA and production.
 */
export const DCS_AUTHORITY = { id: 'https://git.door43.org', name: { en: 'Door43 Content Service' } } as const;

export const METADATA_PATH = 'metadata.json';
export const LICENSE_PATH = 'ingredients/license.md';
export const README_PATH = 'README.md';

/** The license texts by the wizard's identifier (Q20: CC BY-SA 4.0 only in Milestone 1). */
export const LICENSE_TEXTS: Readonly<Record<'cc-by-sa-4.0', string>> = { 'cc-by-sa-4.0': CC_BY_SA_4_0_TEXT };

export type TestamentScope = 'nt' | 'ot' | 'full';

/** The project types tC Admin creates: the two flavors translationCore 4 edits. */
export type CreatableProjectType = Exclude<ProjectType, 'other'>;

/** The flavor each project type is written as (CONTEXT.md "Project type"). */
export const FLAVOR_BY_TYPE: Readonly<Record<CreatableProjectType, { flavorType: 'scripture' | 'gloss'; flavor: 'textTranslation' | 'textStories' }>> = {
  bible: { flavorType: 'scripture', flavor: 'textTranslation' },
  obs: { flavorType: 'gloss', flavor: 'textStories' },
};

/** The glossary term for each project type, for the README. */
export const TYPE_TERM: Readonly<Record<CreatableProjectType, string>> = { bible: 'Bible', obs: 'Open Bible Stories' };

interface NewProjectBase {
  owner: string;
  repo_name: string;
  title: string;
  abbreviation: string;
  language: { code: string; title: string; direction?: 'ltr' | 'rtl' | null | undefined };
  license: 'cc-by-sa-4.0';
}

/**
 * What a new project is made from: the wizard's inputs plus the owner and repository
 * name. A Bible has a testament scope and, when the wizard gave them, its translation
 * details (Q4); Open Bible Stories has neither (Q25).
 */
export type NewProject = NewProjectBase &
  ({ project_type: 'bible'; testament_scope: TestamentScope; flavor?: TextTranslationFlavor | null | undefined } | { project_type: 'obs'; testament_scope: null });

/** The USFM version every new Bible project declares: Scribe's, without its patch level (E17, Q4). */
export const USFM_VERSION = '3.0';

/** The `textTranslation` flavor block: the translation details given, the defaults for the rest (Q4), and the USFM version. */
export function textTranslationFlavor(details: TextTranslationFlavor | null | undefined): Record<string, string> {
  return {
    name: 'textTranslation',
    projectType: details?.projectType ?? TEXT_TRANSLATION_FLAVOR_DEFAULTS.projectType,
    translationType: details?.translationType ?? TEXT_TRANSLATION_FLAVOR_DEFAULTS.translationType,
    audience: details?.audience ?? TEXT_TRANSLATION_FLAVOR_DEFAULTS.audience,
    usfmVersion: USFM_VERSION,
  };
}

/** Who generated the metadata: tC Admin, with its version, as the signed-in manager (`meta.generator`). */
export interface Generator {
  name: string;
  version: string;
  user: { login: string; name: string };
}

/** A file the first commit writes, with the size and md5 of its bytes (R10). */
export interface ProjectFile {
  path: string;
  content: string;
  bytes: Uint8Array;
  size: number;
  md5: string;
}

const BOOKS_BY_SCOPE: Readonly<Record<TestamentScope, readonly string[]>> = { nt: NEW_TESTAMENT, ot: OLD_TESTAMENT, full: BIBLE_BOOKS };

/** The repository name: `<language>_<abbreviation>` in lowercase, as in `en_ult` (product spec §6). */
export function repositoryName(languageCode: string, abbreviation: string): string {
  return `${languageCode.trim().toLowerCase()}_${abbreviation.trim().toLowerCase()}`;
}

/** Door43 accepts letters, digits, `.`, `-`, and `_`, not starting with a dot and not a git suffix. */
export function validRepositoryName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) && !/\.(git|wiki)$/i.test(name) && name !== '..';
}

/** `currentScope` for a testament scope: every book of the scope, in canonical order, with no chapter restriction (product spec §6). */
export function currentScope(scope: TestamentScope): Record<string, []> {
  return Object.fromEntries(BOOKS_BY_SCOPE[scope].map(book => [book.toUpperCase(), []]));
}

/** The `currentScope` a new project is written with: the testament scope for a Bible; for Open Bible Stories the fixed scope Door43 writes (E46, Q4). */
export function projectScope(project: NewProject): Record<string, readonly string[]> {
  return project.project_type === 'bible' ? currentScope(project.testament_scope) : OBS_SCOPE;
}

export function projectFile(path: string, content: string): ProjectFile {
  const bytes = new TextEncoder().encode(content);
  return { path, content, bytes, size: bytes.length, md5: md5(bytes) };
}

/** A book or story an upload or import adds: a book id (`gen` … `rev`) or a story id (`01` … `50`), as `books.ts` spells them. */
export type Unit = { book: string } | { story: string };

/** A book's or story's ingredient entry, as `metadata.json` lists it under the file's path (E37). */
export interface UnitIngredient {
  checksum: { md5: string };
  mimeType: 'text/x-usfm' | 'text/markdown';
  size: number;
  /** A book's scope names the whole book, as Scribe writes it (`{ "MAT": [] }`, E17). A story has none: the per-story passages Door43's converter writes (E36) are a table tC Admin does not hold. */
  scope?: Record<string, []>;
}

/** The unit in canonical spelling, or a thrown error: a path is only ever built from a recognized book or story (W1). */
function canonicalUnit(unit: Unit): Unit {
  const id = 'book' in unit ? bookId(unit.book) : storyId(unit.story);
  if (id === null || id !== ('book' in unit ? unit.book : unit.story)) throw new RangeError(`${JSON.stringify(unit)} is not a book or story id`);
  return unit;
}

/** The Scripture Burrito path of a book or story, whatever name it was uploaded under (W1): `ingredients/<BOOK>.usfm` or `ingredients/content/<NN>.md` (E36). */
export function unitPath(unit: Unit): string {
  const known = canonicalUnit(unit);
  return 'book' in known ? `ingredients/${known.book.toUpperCase()}.usfm` : `ingredients/content/${known.story}.md`;
}

/** The ingredient entry of a book or story, with the size and md5 of the bytes that will be written (R10). */
export function unitIngredient(unit: Unit, bytes: Uint8Array): UnitIngredient {
  const known = canonicalUnit(unit);
  const checksum = { md5: md5(bytes) };
  if ('book' in known) return { checksum, mimeType: 'text/x-usfm', size: bytes.length, scope: { [known.book.toUpperCase()]: [] } };
  return { checksum, mimeType: 'text/markdown', size: bytes.length };
}

/** The repository's README: the project in glossary words; not an ingredient. */
export function readme(project: NewProject): string {
  const units = project.project_type === 'bible' ? 'books' : 'stories';
  return `# ${project.title}\n\n${project.abbreviation} · ${project.language.title} (${project.language.code}) · ${TYPE_TERM[project.project_type]}\n\nA Scripture Burrito project created with tC Admin. \`${METADATA_PATH}\` describes it and lists its files; its ${units} will live under \`ingredients/\` as they are added.\n`;
}

/** The `type` of the metadata: the flavor, and the scope (E37, E44). */
function projectTypeBlock(project: NewProject): Record<string, unknown> {
  const { flavorType } = FLAVOR_BY_TYPE[project.project_type];
  // The textTranslation flavor's required `projectType`, `translationType`, and `audience` are the wizard's, or the defaults recorded in Q4; textStories takes only its name.
  const flavor = project.project_type === 'bible' ? textTranslationFlavor(project.flavor) : { name: 'textStories' };
  return { flavorType: { name: flavorType, flavor, currentScope: projectScope(project) } };
}

/**
 * The `metadata.json` of a new project (E37): tC Admin as generator, the
 * flavor of the project type, the scope, the license as the one ingredient,
 * and no `relationships` until an import adds one (E24).
 */
export function newProjectMetadata(project: NewProject, generator: Generator, now: Date, license: ProjectFile): Record<string, unknown> {
  const timestamp = now.toISOString();
  const language: Record<string, unknown> = { tag: project.language.code, name: { en: project.language.title } };
  if (project.language.direction) language.scriptDirection = project.language.direction;
  return {
    format: 'scripture burrito',
    meta: {
      version: '1.0.0',
      category: 'source',
      generator: {
        softwareName: generator.name,
        softwareVersion: generator.version,
        userId: `dcs::${generator.user.login}`,
        userName: generator.user.name,
      },
      defaultLocale: 'en',
      dateCreated: timestamp,
      normalization: 'NFC',
    },
    idAuthorities: { dcs: DCS_AUTHORITY },
    identification: {
      name: { en: project.title },
      abbreviation: { en: project.abbreviation },
      primary: { dcs: { [`${project.owner}/${project.repo_name}`]: { revision: 'master', timestamp } } },
    },
    confidential: false,
    languages: [language],
    type: projectTypeBlock(project),
    copyright: { licenses: [{ ingredient: license.path }] },
    ingredients: {
      [license.path]: { checksum: { md5: license.md5 }, mimeType: 'text/markdown', size: license.size, role: 'x-license' },
    },
  };
}

/** `metadata.json` as tC Admin writes it: the document as JSON, indented by two spaces, with a final line feed, and its size and md5. */
export function metadataFile(metadata: Readonly<Record<string, unknown>>): ProjectFile {
  return projectFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
}

/** The files of a new project's first commit, in the order they are listed: the metadata, the license ingredient, the README (W5). */
export function newProjectFiles(project: NewProject, generator: Generator, now: Date): { metadata: Record<string, unknown>; files: ProjectFile[] } {
  const license = projectFile(LICENSE_PATH, LICENSE_TEXTS[project.license]);
  const metadata = newProjectMetadata(project, generator, now, license);
  return {
    metadata,
    files: [metadataFile(metadata), license, projectFile(README_PATH, readme(project))],
  };
}

/** A book or story an upload or import adds, as identified (`model/upload.ts`): its unit, its Scripture Burrito path, and the entry of its bytes (R10). */
export interface AddedUnit {
  identified: Unit;
  path: string;
  ingredient: UnitIngredient;
}

/** One ingredient entry an upload adds or replaces: as it stands, `null` when new, and as it will be. */
export interface EntryChange {
  path: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

export interface MergedUpload {
  metadata: Record<string, unknown>;
  entries: EntryChange[];
}

/**
 * The default branch's `metadata.json` with the ingredient entries an upload or
 * import adds (#74, product spec §8 "Metadata inference"): a unit the metadata does
 * not list gets the writer's entry for its bytes; a unit it lists keeps every field
 * of its entry, with the size and the md5 replaced by those of the new bytes, as the
 * release merge does (R10). Nothing else changes: not the scope, not the names, not
 * the generator (built behind, #74). A unit the metadata lists under another path,
 * or a path it lists for something else, is a `MetadataError`: one book or story is
 * never listed twice, as the reader refuses (`unitIngredients`).
 */
export function mergeUploadMetadata(current: ProjectMetadata, added: readonly AddedUnit[]): MergedUpload {
  const type = current.project_type;
  if (type === 'other') throw new MetadataError('not a Bible or Open Bible Stories project');
  const listed = unitIngredients(current);
  const byPath = new Map(current.ingredients.map(ingredient => [ingredient.path, ingredient]));
  const document = structuredClone(current.document) as Record<string, unknown>;
  const ingredients = document.ingredients as Record<string, unknown>;
  const entries: EntryChange[] = [];
  const seen = new Set<string>();
  for (const unit of added) {
    const id = 'book' in unit.identified ? unit.identified.book : unit.identified.story;
    if (('book' in unit.identified) !== (type === 'bible')) throw new MetadataError(`${id} is not a ${type === 'bible' ? 'book' : 'story'} of this project`);
    if (seen.has(id)) throw new MetadataError(`${id} is added twice`);
    seen.add(id);
    const existing = listed.get(id);
    if (existing && existing.path !== unit.path) throw new MetadataError(`${id} is listed at ${existing.path}, not ${unit.path}`);
    const atPath = byPath.get(unit.path);
    if (atPath && atPath.unit !== id) throw new MetadataError(`${unit.path} is listed as ${atPath.unit ?? `an ingredient of kind ${atPath.kind}`}, not ${id}`);
    const written = ingredients[unit.path];
    const before = existing && typeof written === 'object' && written !== null ? structuredClone(written as Record<string, unknown>) : null;
    // Only the md5 of the new bytes: any other digest the entry declares would be stale (E5, R10).
    const after: Record<string, unknown> = before ? { ...structuredClone(before), checksum: { md5: unit.ingredient.checksum.md5 }, size: unit.ingredient.size } : structuredClone(unit.ingredient) as unknown as Record<string, unknown>;
    ingredients[unit.path] = after;
    entries.push({ path: unit.path, before, after });
  }
  return { metadata: document, entries };
}

/** The repository an import takes from, and the revision taken: a release tag, or the default branch's head commit (built behind, #79). */
export interface ImportSource {
  owner: string;
  repo: string;
  revision: string;
}

/** A `source` relationship as `metadata.json` lists it (E24): the source repository under the `dcs` authority and the revision imported. */
export interface SourceRelationship {
  id: string;
  relationType: 'source';
  flavor: string;
  revision: string;
}

/**
 * The flavor a `source` relationship names for each project type. The relationship
 * schema (E24, `fixtures/scripture-burrito/2026-10-05/schema/relationship.schema.json`)
 * allows a `source` only `textTranslation` or `audioTranslation`, or a custom
 * `x-` flavor, so a Bible's is its own flavor and an Open Bible Stories project's
 * is the custom spelling of its flavor: the schema names no story flavor a source
 * may carry, and tC Admin writes only what the schema accepts (W1). Built behind
 * the catalog's "the project's flavor", for Rich to confirm or change (Q34, #79).
 */
export const SOURCE_RELATIONSHIP_FLAVOR: Readonly<Record<CreatableProjectType, string>> = { bible: 'textTranslation', obs: 'x-textStories' };

/** The relationship an import of `source` into a project of `type` records (E24). */
export function sourceRelationship(type: CreatableProjectType, source: ImportSource): SourceRelationship {
  return { id: `dcs::${source.owner}/${source.repo}`, relationType: 'source', flavor: SOURCE_RELATIONSHIP_FLAVOR[type], revision: source.revision };
}

export interface MergedImport extends MergedUpload {
  /** The relationships the import adds: the source's, or none when the document already lists that same relationship. */
  relationships: SourceRelationship[];
}

const sameRelationship = (a: Record<string, unknown>, b: SourceRelationship) => a.id === b.id && a.relationType === b.relationType && a.flavor === b.flavor && a.revision === b.revision && !('variant' in a);

/**
 * The metadata an import proposes (#79, product spec §8 "Import from an existing
 * repository"): what `mergeUploadMetadata` proposes for the imported books or
 * stories, plus one `source` relationship for the source repository and revision
 * (E24, ADR 0013), and the `dcs` id authority it refers to when the document does
 * not declare one. A relationship the document already lists, field for field, is
 * not listed again; an authority already declared under `dcs` is kept as written,
 * whatever its spelling (E24). Nothing else changes.
 */
export function mergeImportMetadata(current: ProjectMetadata, added: readonly AddedUnit[], source: ImportSource): MergedImport {
  const type = current.project_type;
  if (type === 'other') throw new MetadataError('not a Bible or Open Bible Stories project');
  const { metadata, entries } = mergeUploadMetadata(current, added);
  const relationship = sourceRelationship(type, source);
  const authorities = isRecord(metadata.idAuthorities) ? metadata.idAuthorities : {};
  // A new object, as the relationships are a new array: nothing the caller holds is written to.
  if (!isRecord(authorities.dcs)) metadata.idAuthorities = { ...authorities, dcs: structuredClone(DCS_AUTHORITY) };
  const listed = Array.isArray(metadata.relationships) ? metadata.relationships : [];
  const relationships = listed.some(entry => isRecord(entry) && sameRelationship(entry, relationship)) ? [] : [relationship];
  if (relationships.length > 0) metadata.relationships = [...listed, structuredClone(relationship)];
  return { metadata, entries, relationships };
}

/** A file under `ingredients/` in a release snapshot, with the size and md5 computed from its bytes (R10). */
export interface SnapshotFile {
  path: string;
  size: number;
  md5: string;
}

export interface ReleaseMerge {
  /** The default branch's metadata: every top-level field of the release comes from it (Q8). */
  current: ProjectMetadata;
  /** The previous release's metadata, whose entries carried-forward books keep; `null` for a first release. */
  base: ProjectMetadata | null;
  /** Each unit's selection state. A unit on neither side is ignored; an Open Bible Stories release may give none, since every story on the default branch is included (ADR 0013). */
  selection: Readonly<Record<string, SelectionState>>;
  /** Every file under `ingredients/` in the snapshot (R10). */
  files: readonly SnapshotFile[];
  /** Unknown files the manager included: in the snapshot without an entry (product spec §8). */
  unknown_included?: readonly string[];
}

export interface MergedRelease {
  metadata: Record<string, unknown>;
  /** The books or stories the release carries, in canonical order: its `currentScope` (Q7). */
  released: string[];
  /** The units of the previous release this one leaves out (R2). */
  removed: string[];
}

const ORDER_BY_TYPE: Readonly<Record<ProjectType, readonly string[]>> = { bible: BIBLE_BOOKS, obs: STORIES, other: [] };
const canonical = (type: ProjectType, ids: Iterable<string>) => {
  const index = new Map(ORDER_BY_TYPE[type].map((id, i) => [id, i]));
  return [...new Set(ids)].sort((a, b) => (index.get(a) ?? Infinity) - (index.get(b) ?? Infinity) || a.localeCompare(b));
};

/** The entry as written in its document, with the size and md5 of the file in the snapshot (R10). */
function entryFor(ingredient: MetadataIngredient, source: ProjectMetadata, file: SnapshotFile): Record<string, unknown> {
  const ingredients = source.document.ingredients as Record<string, unknown>;
  const written = ingredients[ingredient.path];
  const entry: Record<string, unknown> = typeof written === 'object' && written !== null ? structuredClone(written as Record<string, unknown>) : {};
  // Only the md5 recomputed from the bytes: any other digest the base declares may be as stale as its md5 (E5, R10).
  return { ...entry, checksum: { md5: file.md5 }, size: file.size };
}

/**
 * The release snapshot's `metadata.json` (ADR 0010, #35): the default branch's
 * document with its ingredients replaced by exactly the released units and the
 * default branch's administrative ingredients, each with the size and md5 of
 * the file in the snapshot, and its `currentScope` set to the released books; an
 * Open Bible Stories release keeps the fixed scope every one carries (E46). A
 * carried-forward unit keeps the previous release's entry at its previous path;
 * an included one takes the default branch's. Every snapshot file must have an
 * entry, unless the manager included it as an unknown file, and every entry a
 * file; otherwise the merge refuses, since Door43 verifies both ways on a tag
 * (E16, R10). Open Bible Stories excepted: a story file the default branch's
 * metadata does not list is left unlisted, for Door43's health check (Q32).
 */
export function mergeReleaseMetadata(merge: ReleaseMerge): MergedRelease {
  const { current, base } = merge;
  const type = current.project_type;
  if (type === 'other') throw new MetadataError('not a Bible or Open Bible Stories project');
  if (base && base.project_type !== type) throw new MetadataError(`the previous release is ${base.project_type}, the default branch ${type}`);
  const files = new Map(merge.files.map(file => [file.path, file]));
  const onBranch = unitIngredients(current);
  const inBase = base ? unitIngredients(base) : new Map<string, MetadataIngredient>();
  // A unit without a selection: an Open Bible Stories story is included while on the branch (ADR 0013); a released book is carried forward, never removed by omission (R2).
  const chosen = (unit: string): SelectionState => merge.selection[unit] ?? (type === 'obs' ? (onBranch.has(unit) ? 'include' : 'leave_out') : inBase.has(unit) ? 'carry_forward' : 'leave_out');
  // The story an Open Bible Stories snapshot file is, by its path (E36); `null` for any other file or project type.
  const storyOf = (path: string): string | null => {
    if (type !== 'obs') return null;
    const { kind, unit } = classifyIngredient(path, null, 'obs');
    return kind === 'story' ? unit : null;
  };
  const storyFiles = new Set(merge.files.map(file => storyOf(file.path)).filter((unit): unit is string => unit !== null));

  const entries = new Map<string, Record<string, unknown>>();
  const owners = new Map<string, string>();
  const put = (path: string, owner: string, entry: Record<string, unknown>) => {
    if (owners.has(path)) throw new MetadataError(`${path} is the entry of both ${owners.get(path)} and ${owner}`);
    owners.set(path, owner);
    entries.set(path, entry);
  };
  const releasedEntry = new Map<string, MetadataIngredient>();
  const released: string[] = [];
  const removed: string[] = [];
  for (const unit of canonical(type, [...onBranch.keys(), ...inBase.keys()])) {
    const selection = chosen(unit);
    if (selection === 'leave_out') {
      if (inBase.has(unit)) removed.push(unit);
      continue;
    }
    const [ingredient, source] = selection === 'include' ? [onBranch.get(unit), current] : [inBase.get(unit), base];
    // A released story whose file is still on the branch but which the branch's metadata no longer lists stays unlisted, as on a first release (Q32).
    if (!ingredient && selection === 'include' && storyFiles.has(unit)) continue;
    if (!ingredient || !source) throw new MetadataError(`${unit} cannot be ${selection === 'include' ? 'included: it is not on the default branch' : 'carried forward: it is not in the previous release'}`);
    const file = files.get(ingredient.path);
    if (!file) throw new MetadataError(`${ingredient.path} is listed for ${unit} but is not in the snapshot`);
    put(ingredient.path, unit, entryFor(ingredient, source, file));
    releasedEntry.set(unit, ingredient);
    released.push(unit);
  }
  for (const ingredient of current.ingredients) {
    if (ingredient.kind !== 'administrative') continue;
    const file = files.get(ingredient.path);
    if (!file) throw new MetadataError(`${ingredient.path} is an administrative ingredient but is not in the snapshot`);
    put(ingredient.path, 'an administrative ingredient', entryFor(ingredient, current, file));
  }
  // An Open Bible Stories release is the whole default branch, whose metadata is the authority for its stories: a story file it does not
  // list stays unlisted, with no entry invented, and Door43's health check reports the gap (decided 7 October 2026 by Rich, H1, Q32).
  // Any other file without an entry is still refused, in Open Bible Stories as in a Bible (R10).
  const unknown = new Set(merge.unknown_included ?? []);
  for (const file of merge.files) {
    if (!entries.has(file.path) && !unknown.has(file.path) && storyOf(file.path) === null) throw new MetadataError(`${file.path} is in the snapshot but has no ingredient entry`);
  }

  // The scope: for a Bible exactly the released books, each with the ranges its entry declares (Q7); Open Bible Stories keeps the fixed scope (E46).
  // A deep copy, so the result shares no object with the default branch's document (the writer is pure).
  const document = structuredClone(current.document) as Record<string, unknown>;
  const typeBlock = document.type as Record<string, unknown>;
  const flavorType = typeBlock.flavorType as Record<string, unknown>;
  if (type === 'bible') {
    const scope: Record<string, readonly string[]> = {};
    for (const unit of released) {
      const code = unit.toUpperCase();
      scope[code] = [...(releasedEntry.get(unit)?.scope?.[code] ?? [])];
    }
    flavorType.currentScope = scope;
    // The names travel with the books: `localizedNames` keeps the released books' entries only, so a removed or left-out book
    // leaves the names as it leaves the ingredients and the scope (Q7, Q8); an entry that is no book code is kept as it is.
    const names = document.localizedNames as Record<string, unknown> | undefined;
    if (names && typeof names === 'object') {
      const codes = new Set(released.map(unit => unit.toUpperCase()));
      document.localizedNames = Object.fromEntries(Object.entries(names).filter(([key]) => codes.has(key.toUpperCase()) || !BIBLE_BOOKS.includes(key.toLowerCase())));
    }
  }

  const metadata: Record<string, unknown> = { ...document, ingredients: Object.fromEntries(entries) };
  return { metadata, released, removed };
}
