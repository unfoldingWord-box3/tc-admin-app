// Project classification: type, content structure, editability, and coverage
// from the catalog view of a repository (E12, E14, E32, E42). Pure: no I/O, no
// Door43 shapes; `worker/src/door43/catalog.ts` produces the input.
//
// Enforces H3 (unknown coverage is `null`, never `0`, and never complete) and
// H5 (coverage is file coverage against the testament-scope target, with its
// basis), and carries the editability reason for P1.

import type {
  Coverage,
  CoverageScope,
  CoverageUnit,
  Editability,
  MetadataFormat,
  ProjectClassification,
  ProjectType,
} from '@tc-admin/shared/schema';
import { BIBLE_BOOKS, NEW_TESTAMENT, OLD_TESTAMENT, STORIES, bookId, storyId, testamentOf } from './books';

/** One ingredient as the catalog lists it, in glossary spelling. */
export interface CatalogIngredient {
  /** Door43's ingredient identifier: a book id, a story id, or something else. */
  id: string;
  path: string;
  /** Door43 checked that the file is in the repository. */
  exists: boolean;
  /** The ingredient is a directory, which may hold units the catalog does not itemize. */
  is_dir: boolean;
}

/** The catalog view of one repository, the input to classification. */
export interface ProjectCatalog {
  /**
   * The Scripture Burrito flavor Door43 reads from the repository's metadata,
   * whatever its format (E42): `textTranslation`, `textStories`, or another;
   * `null` when it names none.
   */
  flavor: string | null;
  metadata_format: MetadataFormat;
  /** The ingredients Door43 lists; `null` when it lists none, which is unknown, not empty. */
  ingredients: CatalogIngredient[] | null;
  /**
   * Book ids from a Scripture Burrito `currentScope`, when the caller has read
   * the metadata (E20). The repository search does not carry it (E32), so the
   * scope is derived from the listed books alone unless this is supplied.
   */
  current_scope?: readonly string[] | null;
}

/**
 * Flavor to project type. tC Admin manages the two Scripture Burrito flavors
 * translationCore 4 edits: `scripture/textTranslation` is Bible (including
 * Aligned Bible) and `gloss/textStories` is Open Bible Stories. Door43 reads
 * the flavor for every metadata format and derives its catalog subject from
 * it (E14, E42), so the subject is never read. Every other flavor, or none,
 * is `other` (CONTEXT.md "Project type", Q11 and Q23).
 */
export const PROJECT_TYPE_BY_FLAVOR: Readonly<Record<string, Exclude<ProjectType, 'other'>>> = {
  textTranslation: 'bible',
  textStories: 'obs',
};

/** The flavors of the projects tC Admin manages; the search filter asks Door43 for exactly these (ADR 0014). */
export const SUPPORTED_FLAVORS: readonly string[] = Object.keys(PROJECT_TYPE_BY_FLAVOR);

export function projectTypeFromFlavor(flavor: string | null | undefined): ProjectType {
  if (!flavor) return 'other';
  return PROJECT_TYPE_BY_FLAVOR[flavor.trim()] ?? 'other';
}

const FORMAT_NAMES: Readonly<Record<Exclude<MetadataFormat, 'none'>, string>> = {
  sb: 'Scripture Burrito',
  rc: 'Resource Container',
  ts: 'translationStudio',
  tc: 'translationCore',
};

/**
 * Editability with its one-line reason (ADR 0013, P1, W2). Only a Scripture
 * Burrito Bible or Open Bible Stories project is editable. Everything else is
 * `unsupported` (CONTEXT.md "Unsupported project"): a project of type `other`
 * whatever its format, a repository without recognized metadata, and a Bible
 * or Open Bible Stories repository in another format, whose reason offers an
 * import into a new project.
 */
export function editability(format: MetadataFormat, type: ProjectType): Editability {
  if (format === 'none') {
    return { state: 'unsupported', reason: 'Door43 found no project metadata it recognizes. Release and editing are not available.' };
  }
  if (type === 'other') {
    return { state: 'unsupported', reason: 'tC Admin manages Bible and Open Bible Stories projects only. Release and editing are not available.' };
  }
  const name = FORMAT_NAMES[format];
  if (format === 'sb') return { state: 'editable', reason: `${name} project. Release and editing are available.` };
  return { state: 'unsupported', reason: `${name} project. Import it into a new project to manage it here.` };
}

const TARGET_BY_SCOPE: Readonly<Record<CoverageScope, number | null>> = { nt: 27, ot: 39, full: 66, obs: 50, unknown: null };
const UNITS_BY_SCOPE: Readonly<Record<CoverageScope, readonly string[]>> = {
  nt: NEW_TESTAMENT,
  ot: OLD_TESTAMENT,
  full: BIBLE_BOOKS,
  obs: STORIES,
  unknown: [],
};

/** The testament scope the given books imply: both testaments is `full`, none is `unknown`. */
export function testamentScope(books: Iterable<string>): CoverageScope {
  let ot = false;
  let nt = false;
  for (const book of books) {
    const testament = testamentOf(book);
    if (testament === 'ot') ot = true;
    if (testament === 'nt') nt = true;
  }
  return ot && nt ? 'full' : ot ? 'ot' : nt ? 'nt' : 'unknown';
}

/**
 * File coverage from the catalog (H5, basis `catalog`).
 *
 * Scope: `obs` for Open Bible Stories; for a Bible, the testament scope of
 * the books the catalog lists together with `current_scope` when supplied,
 * so a present book is always inside the scope; `unknown` for anything else.
 *
 * Present (H3): `null` when Door43 lists no ingredients, or lists no recognized
 * unit but does list a directory that may hold units it does not itemize (an
 * Open Bible Stories `content/` container, for instance). Otherwise the count
 * of distinct recognized units whose file exists.
 */
export function coverage(catalog: ProjectCatalog, type: ProjectType): Coverage {
  if (type === 'other') return { present: null, target: null, scope: 'unknown', basis: 'catalog', units: [] };

  const recognize = type === 'bible' ? bookId : storyId;
  const listed = catalog.ingredients;
  const recognized = (listed ?? []).flatMap(ingredient => {
    const unit = recognize(ingredient.id);
    return unit === null ? [] : [{ unit, exists: ingredient.exists }];
  });

  let scope: CoverageScope;
  if (type === 'obs') {
    scope = 'obs';
  } else {
    const declared = (catalog.current_scope ?? []).flatMap(value => bookId(value) ?? []);
    scope = testamentScope([...declared, ...recognized.map(r => r.unit)]);
  }
  const target = TARGET_BY_SCOPE[scope];

  const unknown = listed === null || (recognized.length === 0 && listed.some(ingredient => ingredient.is_dir));
  if (unknown) return { present: null, target, scope, basis: 'catalog', units: [] };

  const presentIds = new Set(recognized.filter(r => r.exists).map(r => r.unit));
  const units: CoverageUnit[] = UNITS_BY_SCOPE[scope].map(id => ({ id, present: presentIds.has(id) }));
  return { present: presentIds.size, target, scope, basis: 'catalog', units };
}

/** The classification fields of the project report for one catalog view. */
export function classifyProject(catalog: ProjectCatalog): ProjectClassification {
  const project_type = projectTypeFromFlavor(catalog.flavor);
  return {
    project_type,
    metadata_format: catalog.metadata_format,
    editability: editability(catalog.metadata_format, project_type),
    coverage: coverage(catalog, project_type),
  };
}
