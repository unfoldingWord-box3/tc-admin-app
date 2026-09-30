// Project classification: type, content structure, editability, and coverage
// from the catalog view of a repository (E12, E14, E32). Pure: no I/O, no
// Door43 shapes; `worker/src/door43/catalog.ts` produces the input.
//
// Enforces H3 (unknown coverage is `null`, never `0`, and never complete) and
// H5 (coverage is file coverage against the testament-scope target, with its
// basis), and carries the editability reason for P1.

import type {
  ContentStructure,
  Coverage,
  CoverageScope,
  CoverageUnit,
  Editability,
  MetadataFormat,
  ProjectClassification,
  ProjectType,
} from '../../../shared/schema/project';
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
  /** Door43's subject for the repository's metadata; `null` when it names none. */
  subject: string | null;
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
 * Subject to project type. The glossary names the types and their subjects
 * (CONTEXT.md "Project type", Q23 decided 30 September 2026); the subjects are
 * Door43's vocabulary (E33). Greek New Testament and Hebrew Old Testament are
 * Bibles that hold one testament; the markdown Translation Notes and Questions
 * are the same types as their TSV successors. Every other subject is `other`.
 */
const PROJECT_TYPE_BY_SUBJECT: Readonly<Record<string, ProjectType>> = {
  'Bible': 'bible',
  'Aligned Bible': 'bible',
  'Greek New Testament': 'bible',
  'Hebrew Old Testament': 'bible',
  'TSV Translation Notes': 'tn',
  'Translation Notes': 'tn',
  'TSV Translation Questions': 'tq',
  'Translation Questions': 'tq',
  'TSV Translation Words Links': 'twl',
  'Open Bible Stories': 'obs',
};

/**
 * The project types version one manages (CONTEXT.md "Project type"; roadmap):
 * Bible and Open Bible Stories. The `.tsv` book package types are typed and
 * counted but neither released nor edited until the Milestone 1 re-plan adds
 * them here (Q18).
 */
export const MANAGED_PROJECT_TYPES: ReadonlySet<ProjectType> = new Set<ProjectType>(['bible', 'obs']);

export function projectTypeFromSubject(subject: string | null | undefined): ProjectType {
  if (!subject) return 'other';
  return PROJECT_TYPE_BY_SUBJECT[subject.trim()] ?? 'other';
}

export function contentStructure(type: ProjectType): ContentStructure {
  switch (type) {
    case 'bible':
    case 'tn':
    case 'tq':
    case 'twl':
      return 'book_package';
    case 'obs':
      return 'story_package';
    case 'other':
      return 'whole';
  }
}

const FORMAT_NAMES: Readonly<Record<Exclude<MetadataFormat, 'none'>, string>> = {
  sb: 'Scripture Burrito',
  rc: 'Resource Container',
  ts: 'translationStudio',
  tc: 'translationCore',
};

/**
 * Editability with its one-line reason (ADR 0009, P1). A project whose type
 * version one does not manage is neither releasable nor editable, whatever
 * its format, which the glossary spells `unsupported` (CONTEXT.md "Unsupported
 * project"); for the rest, the format decides.
 */
export function editability(format: MetadataFormat, type: ProjectType, subject: string | null): Editability {
  if (format === 'none') {
    return { state: 'unsupported', reason: 'Door43 found no project metadata it recognizes. Release and editing are not available.' };
  }
  if (!MANAGED_PROJECT_TYPES.has(type)) {
    const what = subject ? `${subject} projects` : 'projects of this type';
    return { state: 'unsupported', reason: `tC Admin does not manage ${what} in this version. Release and editing are not available.` };
  }
  const name = FORMAT_NAMES[format];
  if (format === 'sb') return { state: 'editable', reason: `${name} project. Release and editing are available.` };
  return { state: 'release_only', reason: `${name} project. Release is available; editing needs conversion.` };
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
 * Scope: `obs` for a story package; for a book package, the testament scope
 * of the books the catalog lists together with `current_scope` when supplied,
 * so a present book is always inside the scope; `unknown` for anything else.
 *
 * Present (H3): `null` when Door43 lists no ingredients, or lists no recognized
 * unit but does list a directory that may hold units it does not itemize (an
 * Open Bible Stories `content/` container, for instance). Otherwise the count
 * of distinct recognized units whose file exists.
 */
export function coverage(catalog: ProjectCatalog, type: ProjectType): Coverage {
  const structure = contentStructure(type);
  if (structure === 'whole') return { present: null, target: null, scope: 'unknown', basis: 'catalog', units: [] };

  const recognize = structure === 'book_package' ? bookId : storyId;
  const listed = catalog.ingredients;
  const recognized = (listed ?? []).flatMap(ingredient => {
    const unit = recognize(ingredient.id);
    return unit === null ? [] : [{ unit, exists: ingredient.exists }];
  });

  let scope: CoverageScope;
  if (structure === 'story_package') {
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
  const project_type = projectTypeFromSubject(catalog.subject);
  return {
    project_type,
    content_structure: contentStructure(project_type),
    metadata_format: catalog.metadata_format,
    editability: editability(catalog.metadata_format, project_type, catalog.subject),
    coverage: coverage(catalog, project_type),
  };
}
