// The project report (operations.md §2) and its classification fields.
// Identifiers are the glossary's (CONTEXT.md "Identifiers"); they are spelled
// here once and imported by the Worker, the web client, and the tests.

import { z } from 'zod';
import { Freshness, ProjectRef } from './common';
import { HealthState, SetupState, PreparationState } from './states';

/**
 * The two Scripture Burrito flavors translationCore 4 edits, `scripture/textTranslation`
 * (`bible`, which includes Aligned Bible) and `gloss/textStories` (`obs`), and `other`
 * for every other kind of repository, which tC Admin lists but neither releases nor
 * edits (CONTEXT.md "Project type", Q11).
 */
export const PROJECT_TYPES = ['bible', 'obs', 'other'] as const;
export const ProjectType = z.enum(PROJECT_TYPES);
export type ProjectType = z.infer<typeof ProjectType>;

export const METADATA_FORMATS = ['sb', 'rc', 'ts', 'tc', 'none'] as const;
export const MetadataFormat = z.enum(METADATA_FORMATS);
export type MetadataFormat = z.infer<typeof MetadataFormat>;

export const EDITABILITY_STATES = ['editable', 'unsupported'] as const;
export const EditabilityState = z.enum(EDITABILITY_STATES);
export type EditabilityState = z.infer<typeof EditabilityState>;

export const Editability = z.object({
  state: EditabilityState,
  /** One sentence in glossary language, shown next to the state (P1). For a Bible or Open Bible Stories repository in another format it offers an import (ADR 0013). */
  reason: z.string(),
});
export type Editability = z.infer<typeof Editability>;

export const COVERAGE_SCOPES = ['nt', 'ot', 'full', 'obs', 'unknown'] as const;
export const CoverageScope = z.enum(COVERAGE_SCOPES);
export type CoverageScope = z.infer<typeof CoverageScope>;

export const COVERAGE_BASES = ['catalog', 'archive'] as const;
export const CoverageBasis = z.enum(COVERAGE_BASES);
export type CoverageBasis = z.infer<typeof CoverageBasis>;

export const CoverageUnit = z.object({
  /** A book id (`gen` … `rev`) or a story id (`01` … `50`). */
  id: z.string(),
  present: z.boolean(),
});
export type CoverageUnit = z.infer<typeof CoverageUnit>;

/**
 * File coverage (H5): recognized books or stories present against the target
 * the testament scope sets. `present` is `null`, never `0`, when it is unknown
 * (H3); `target` is `null` when the scope is unknown. `units` lists every unit
 * in scope with whether it is present, and is empty when `present` is `null`.
 */
export const Coverage = z.object({
  present: z.number().int().nonnegative().nullable(),
  target: z.number().int().positive().nullable(),
  scope: CoverageScope,
  basis: CoverageBasis,
  units: z.array(CoverageUnit),
});
export type Coverage = z.infer<typeof Coverage>;

/** The classification part of the project report (operations.md §2). */
export const ProjectClassification = z.object({
  project_type: ProjectType,
  metadata_format: MetadataFormat,
  editability: Editability,
  coverage: Coverage,
});
export type ProjectClassification = z.infer<typeof ProjectClassification>;

/** Health with its provenance (H1): the ref, time, and raw severity it came from. */
/** One issue Door43's health check reports (E15): its code, the rule, Door43's severity, and its text for the manager, as Door43 wrote it. */
export const HealthIssue = z.object({
  code: z.string(),
  rule: z.string().nullable(),
  severity: z.string(),
  title: z.string(),
  details: z.string(),
  suggestion: z.string(),
});
export type HealthIssue = z.infer<typeof HealthIssue>;

export const Health = z.object({
  state: HealthState,
  severity_raw: z.string().nullable(),
  ref: z.string().nullable(),
  checked_at: z.string().nullable(),
  issue_count: z.number().int().nonnegative().nullable(),
  /** The issues the health-check read reported, for the manager to read (H2); `null` until a health-check read, as in a project summary, and in a receipt recorded before #36. */
  issues: z.array(HealthIssue).nullable().default(null),
  source: z.literal('door43'),
});
export type Health = z.infer<typeof Health>;

/** The complete situation of one project (`project.read`). */
export const ProjectReport = z.object({
  ref: ProjectRef,
  title: z.string(),
  description: z.string(),
  default_branch: z.string(),
  language: z.object({ code: z.string(), title: z.string() }),
  /** When Door43 last recorded a change to the repository (its `updated_at`, E32); `null` when it says nothing, and in a receipt stored before #24, which a repeated apply answers unchanged. The portfolio sorts by it (#24). */
  last_activity_at: z.string().nullable().default(null),
  ...ProjectClassification.shape,
  health: Health,
  latest_full_release: z
    .object({ tag: z.string(), version: z.string(), sha: z.string(), published_at: z.string(), author: z.string() })
    .nullable(),
  /** `null` for a repository without a commit: a project whose setup is incomplete, or an empty repository (E10). */
  default_branch_head: z.object({ sha: z.string(), committed_at: z.string() }).nullable(),
  active_preparation: z.object({ id: z.string(), state: PreparationState, version: z.string() }).nullable(),
  setup: z.object({ state: SetupState, failed_step: z.string().nullable() }),
  permissions: z.object({ push: z.boolean(), admin: z.boolean(), checked_at: z.string() }),
  freshness: Freshness,
});
export type ProjectReport = z.infer<typeof ProjectReport>;

/**
 * One project in `portfolio.list`: the parts of the project report the
 * repository search carries (E7, E32), so the portfolio needs no read per
 * project. Releases, the default-branch head, preparations, and setup come
 * from `project.read`.
 */
export const ProjectSummary = ProjectReport.pick({
  ref: true,
  title: true,
  description: true,
  default_branch: true,
  language: true,
  last_activity_at: true,
  project_type: true,
  metadata_format: true,
  editability: true,
  coverage: true,
  health: true,
  permissions: true,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;
