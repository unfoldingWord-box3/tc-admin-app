// The project report's classification fields, as types. Identifiers are the
// glossary's (CONTEXT.md "Identifiers"); they are spelled here once and imported
// by the Worker, the web client, and the tests. #7 decides whether this package
// grows an executable schema (zod or equivalent); until then these are plain types.

/**
 * The two Scripture Burrito flavors translationCore 4 edits, `scripture/textTranslation`
 * (`bible`, which includes Aligned Bible) and `gloss/textStories` (`obs`), and `other`
 * for every other kind of repository, which tC Admin lists but neither releases nor
 * edits (CONTEXT.md "Project type", Q11).
 */
export const PROJECT_TYPES = ['bible', 'obs', 'other'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const METADATA_FORMATS = ['sb', 'rc', 'ts', 'tc', 'none'] as const;
export type MetadataFormat = (typeof METADATA_FORMATS)[number];

export const EDITABILITY_STATES = ['editable', 'release_only', 'unsupported'] as const;
export type EditabilityState = (typeof EDITABILITY_STATES)[number];

export interface Editability {
  state: EditabilityState;
  /** One sentence in glossary language, shown next to the state (P1). */
  reason: string;
}

export const COVERAGE_SCOPES = ['nt', 'ot', 'full', 'obs', 'unknown'] as const;
export type CoverageScope = (typeof COVERAGE_SCOPES)[number];

export const COVERAGE_BASES = ['catalog', 'archive'] as const;
export type CoverageBasis = (typeof COVERAGE_BASES)[number];

export interface CoverageUnit {
  /** A book id (`gen` … `rev`) or a story id (`01` … `50`). */
  id: string;
  present: boolean;
}

/**
 * File coverage (H5): recognized books or stories present against the target
 * the testament scope sets. `present` is `null`, never `0`, when it is unknown
 * (H3); `target` is `null` when the scope is unknown. `units` lists every unit
 * in scope with whether it is present, and is empty when `present` is `null`.
 */
export interface Coverage {
  present: number | null;
  target: number | null;
  scope: CoverageScope;
  basis: CoverageBasis;
  units: CoverageUnit[];
}

/** The classification part of the project report (operations.md §2). */
export interface ProjectClassification {
  project_type: ProjectType;
  metadata_format: MetadataFormat;
  editability: Editability;
  coverage: Coverage;
}
