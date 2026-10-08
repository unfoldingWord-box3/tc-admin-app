// A project's release preparations as the interface finds them again (#125):
// which ones are still under way, to continue or discard, and which are
// finished; the words for each; a preparation's own address; and the
// preparation a `preparation_active` refusal names. Pure functions; the
// stepper and the project view call the operations.

import type { OperationErrorShape, Preparation, PreparationState, ProjectSummary } from '@tc-admin/shared/schema';
import { projectHash, releaseTagHash } from './portfolio-labels';
import { STATE_LABELS } from './release-stepper';

type Ref = Pick<ProjectSummary, 'ref'>;

/**
 * The states of a preparation still under way (domain model §6): every state before a
 * release but `discarded`. Each may be continued or discarded; `restart_required` is
 * continued by starting again from the selection, which discards it first (R5).
 */
export const ACTIVE_STATES: readonly PreparationState[] = ['selecting', 'snapshot_prepared', 'health_checking', 'health_blocked', 'ready_for_release', 'retryable_failure', 'restart_required'];
/** The finished states: released, or discarded. Nothing more is done to them here; a pre-release is promoted from its release's page (S7). */
export const FINISHED_STATES: readonly PreparationState[] = ['pre_release', 'full_release', 'discarded'];

export const isActive = (preparation: Pick<Preparation, 'state'>): boolean => ACTIVE_STATES.includes(preparation.state);

/** The preparations still under way, in the list's order (newest first). */
export const activePreparations = <P extends Pick<Preparation, 'state'>>(preparations: readonly P[]): P[] => preparations.filter(isActive);

/** The version a preparation goes by: the one confirmed, else its id, the version it was created with. */
export const preparationVersion = (preparation: Pick<Preparation, 'id' | 'version'>): string => preparation.version.confirmed ?? preparation.id;

/** One preparation under way, in glossary words: "A release is being prepared: version v1.1.0 · Health check running". */
export const activeSummary = (preparation: Pick<Preparation, 'id' | 'version' | 'state'>): string => `A release is being prepared: version ${preparationVersion(preparation)} · ${STATE_LABELS[preparation.state]}`;

/** A preparation's own address, `#/<owner>/<repo>/release/<version>`, so a reload lands back on it. */
export const preparationHash = (project: Ref, id: string): string => `${projectHash(project)}/release/${encodeURIComponent(id)}`;

/** Where a listed preparation leads: the stepper at it while under way, its release's page once released, nowhere once discarded. */
export function preparationLink(project: Ref, preparation: Pick<Preparation, 'id' | 'state' | 'release'>): string | null {
  if (isActive(preparation)) return preparationHash(project, preparation.id);
  if (preparation.release) return releaseTagHash(project, preparation.release.tag);
  return null;
}

/** The preparation a `preparation_active` refusal names (`details.preparation_id`, the version), or `null` for any other failure. */
export function refusedFor(error: Pick<OperationErrorShape, 'code' | 'details'> | null): string | null {
  if (!error || error.code !== 'preparation_active') return null;
  const id = error.details.preparation_id;
  return typeof id === 'string' && id ? id : null;
}

/** The list with one preparation replaced by its newer answer (after a discard), so the list need not be read again: Workers KV lists eventually. */
export const withAnswer = <P extends Pick<Preparation, 'id'>>(preparations: readonly P[], answer: P): P[] => preparations.map(preparation => (preparation.id === answer.id ? answer : preparation));
