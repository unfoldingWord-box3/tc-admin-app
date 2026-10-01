// The state identifiers of the operation catalog §5 and CONTEXT.md
// "Identifiers", one tuple each. The project classification identifiers
// (`project_type`, `metadata_format`, `editability.state`, `coverage.scope`,
// `coverage.basis`) live in `project.ts` beside the shapes that carry them.

import { z } from 'zod';

/** `health.state` (domain model §5; `info` from Q21). */
export const HEALTH_STATES = [
  'healthy',
  'info',
  'warning',
  'failing',
  'never_checked',
  'checking',
  'door43_unavailable',
  'health_error',
  'unsupported',
] as const;
export const HealthState = z.enum(HEALTH_STATES);
export type HealthState = z.infer<typeof HealthState>;

/** Content inclusion state (domain model §4). */
export const INCLUSION_STATES = [
  'unreleased',
  'released',
  'changed_released',
  'selected',
  'carried_forward',
  'excluded',
  'removed',
  'administrative',
  'unknown',
] as const;
export const InclusionState = z.enum(INCLUSION_STATES);
export type InclusionState = z.infer<typeof InclusionState>;

/** `selection` (ADR 0013, Q24). */
export const SELECTION_STATES = ['include', 'carry_forward', 'leave_out'] as const;
export const SelectionState = z.enum(SELECTION_STATES);
export type SelectionState = z.infer<typeof SelectionState>;

/** Candidate group. */
export const CANDIDATE_GROUPS = ['new', 'changed_released', 'unchanged', 'unknown'] as const;
export const CandidateGroup = z.enum(CANDIDATE_GROUPS);
export type CandidateGroup = z.infer<typeof CandidateGroup>;

/** `preparation.state` (domain model §6). */
export const PREPARATION_STATES = [
  'selecting',
  'snapshot_prepared',
  'health_checking',
  'health_blocked',
  'ready_for_release',
  'pre_release',
  'full_release',
  'restart_required',
  'retryable_failure',
  'discarded',
] as const;
export const PreparationState = z.enum(PREPARATION_STATES);
export type PreparationState = z.infer<typeof PreparationState>;

/** `version.rule_applied` (R9, Q19). */
export const VERSION_RULES = ['first', 'removal', 'new_books', 'revisions'] as const;
export const VersionRule = z.enum(VERSION_RULES);
export type VersionRule = z.infer<typeof VersionRule>;

/** `setup.state`. */
export const SETUP_STATES = ['complete', 'incomplete'] as const;
export const SetupState = z.enum(SETUP_STATES);
export type SetupState = z.infer<typeof SetupState>;

/** `freshness.source`. */
export const FRESHNESS_SOURCES = ['live', 'cache'] as const;
export const FreshnessSource = z.enum(FRESHNESS_SOURCES);
export type FreshnessSource = z.infer<typeof FreshnessSource>;
