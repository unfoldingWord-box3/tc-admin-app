// The release stepper's logic as pure functions (product spec §10, #41): the
// selection the manager edits from the plan's defaults, what it removes, when
// a snapshot may be prepared, the step a preparation is at, and the words for
// each state, from CONTEXT.md. No I/O; the component calls the operations.

import { catalogMessage } from '@tc-admin/shared/schema';
import type { CandidateGroup, OperationErrorShape, OperationOutput, Preparation, PreparationState, SelectionState } from '@tc-admin/shared/schema';

export type ReleasePlan = OperationOutput<'release.plan'>;
export type Book = ReleasePlan['preview']['books'][number];
export type Selection = Readonly<Record<string, SelectionState>>;

/** The three states, in the order the list shows them (decided 1 October 2026). */
export const SELECTION_LABELS: Readonly<Record<SelectionState, string>> = {
  include: 'Include',
  carry_forward: 'Carry forward',
  leave_out: 'Leave out',
};

/** What each state means, shown beside the list (product spec §10). */
export const SELECTION_MEANINGS: Readonly<Record<SelectionState, string>> = {
  include: "the book's current file from the default branch goes into the release",
  carry_forward: 'the file from the previous release, untouched by whatever is on the default branch',
  leave_out: 'the book is not in this release; a previously released book left out is removed from this release onward',
};

export const GROUP_LABELS: Readonly<Record<CandidateGroup, string>> = {
  new: 'New',
  changed_released: 'Changed since the last release',
  unchanged: 'Unchanged',
  unknown: 'Unknown',
};

/** A new book can only be included or left out; a released one can be carried forward too. */
export function statesFor(book: Pick<Book, 'group'>): readonly SelectionState[] {
  return book.group === 'new' || book.group === 'unknown' ? ['include', 'leave_out'] : ['include', 'carry_forward', 'leave_out'];
}

/** The plan's defaults (R4): every book as the plan selected it. */
export const selectionOf = (plan: { preview: { books: readonly Book[] } }): Selection => Object.fromEntries(plan.preview.books.map(book => [book.id, book.selection]));

/** The released books the selection leaves out: each will be removed from this release onward (R2), and the plan and the notes name it. */
export const removalsOf = (books: readonly Book[], selection: Selection): string[] =>
  books.filter(book => (book.group === 'changed_released' || book.group === 'unchanged') && selection[book.id] === 'leave_out').map(book => book.id);

/** A release needs at least one book included or carried forward (R4). */
export const canPrepare = (books: readonly Book[], selection: Selection): boolean => books.some(book => selection[book.id] !== 'leave_out');

/** How many books the selection includes, carries, and leaves out. */
export function counts(books: readonly Book[], selection: Selection): Record<SelectionState, number> {
  const result: Record<SelectionState, number> = { include: 0, carry_forward: 0, leave_out: 0 };
  for (const book of books) result[selection[book.id] ?? book.selection] += 1;
  return result;
}

/** The stories of Open Bible Stories, `01` to `50` (E36), all of which Door43's health check requires (E59). The model's list is the Worker's, out of the web's reach. */
export const OBS_STORIES = 50;

/**
 * What an Open Bible Stories release takes, in place of a selection (ADR 0013): every story on the default branch,
 * counted against the fifty; a story the release had that the branch no longer has is removed, named, and needs a major version (R2, R9).
 */
export function storySummary(books: readonly Book[]): { count: string; removed: string | null } {
  const included = books.filter(story => story.selection === 'include').length;
  const removed = books.filter(story => story.selection === 'leave_out').map(story => story.id);
  return {
    count: `${included} of ${OBS_STORIES} stories in this release.`,
    removed:
      removed.length === 0
        ? null
        : `Removed from this release onward, since the default branch no longer has ${removed.length === 1 ? 'it' : 'them'}: ${removed.length === 1 ? 'story' : 'stories'} ${removed.join(', ')}. Earlier releases keep ${removed.length === 1 ? 'it' : 'them'}. The version must then increase its first number, and Door43's health check blocks the release until every story is present.`,
  };
}

/** A typed version, trimmed, with the `v` the catalog spells: `2.0.1` and `V2.0.1` are `v2.0.1`; only a `v` before a digit is taken as already spelled. */
export function spellVersion(typed: string): string {
  const text = typed.trim();
  return /^v\d/i.test(text) ? `v${text.slice(1)}` : `v${text}`;
}

/** A version the manager typed, or `null` to take the calculated one (`release.prepare`). */
export function versionToSend(typed: string, proposed: string): string | null {
  const text = typed.trim();
  if (!text || text === proposed) return null;
  return spellVersion(text);
}

/** The selection `release.prepare` takes: an Open Bible Stories release takes the whole default branch, so it sends none (ADR 0013). */
export const selectionToSend = (projectType: string | null | undefined, selection: Selection): Selection => (projectType === 'obs' ? {} : selection);

export const STEPS = ['Select books', 'Review the snapshot', 'Health check', 'Notes, version, and release', 'Released'] as const;
export type Step = (typeof STEPS)[number];

/** The step a preparation is at (domain model §6). */
export function stepOf(preparation: Pick<Preparation, 'state'> | null): Step {
  if (!preparation) return 'Select books';
  switch (preparation.state) {
    case 'selecting':
    case 'snapshot_prepared':
      return 'Review the snapshot';
    case 'health_checking':
    case 'health_blocked':
      return 'Health check';
    case 'ready_for_release':
    case 'retryable_failure':
      return 'Notes, version, and release';
    case 'pre_release':
    case 'full_release':
      return 'Released';
    case 'restart_required':
    case 'discarded':
      return 'Select books';
  }
}

export const STATE_LABELS: Readonly<Record<PreparationState, string>> = {
  selecting: 'Selecting books',
  snapshot_prepared: 'Snapshot prepared',
  health_checking: 'Health check running',
  health_blocked: 'Health check blocks the release',
  ready_for_release: 'Ready for release',
  pre_release: 'Pre-release created',
  full_release: 'Full release created',
  restart_required: 'Restart required',
  retryable_failure: 'The last step failed; it can be retried',
  discarded: 'Discarded',
};

/** The failures of a release attempt, which `release.create` takes again (R6, #40); any other failure was the snapshot's or a discard's. */
const RELEASE_FAILURES: readonly string[] = ['release_failed', 'release_outcome_unknown'];

/** A `retryable_failure` that `release.create` cannot take again: the snapshot was not completed, or a discard did not finish; discarding it is the way on (R7). */
export const discardOnly = (preparation: Pick<Preparation, 'state'> & { last_error?: Pick<OperationErrorShape, 'code'> | null }): boolean =>
  // Fail closed: the release is offered again only after a release attempt Door43 refused or did not confirm.
  preparation.state === 'retryable_failure' && !(preparation.last_error && RELEASE_FAILURES.includes(preparation.last_error.code));

/** Whether the preparation's health lets the release go on, and whether the manager must acknowledge warnings first (H2, Q6). */
export const releaseGate = (preparation: Pick<Preparation, 'state' | 'health' | 'requires_acknowledgement'> & { last_error?: Pick<OperationErrorShape, 'code'> | null }): 'ready' | 'acknowledge' | 'blocked' | 'checking' => {
  if (preparation.state === 'health_checking') return 'checking';
  if (preparation.state !== 'ready_for_release' && preparation.state !== 'retryable_failure') return 'blocked';
  if (discardOnly(preparation)) return 'blocked';
  return preparation.requires_acknowledgement ? 'acknowledge' : 'ready';
};

/** The message the spec fixes for a project edited during preparation (R5). */
export const RESTART_MESSAGE = catalogMessage('source_changed');

/** A preparation may be discarded until it is released (Q14). */
export const canDiscard = (preparation: Pick<Preparation, 'state'>): boolean => preparation.state !== 'pre_release' && preparation.state !== 'full_release' && preparation.state !== 'discarded';

/** A link to Door43 is shown only when it is on the project's own host: a URL from an answer never sends the manager elsewhere. */
export function onProjectHost(url: string, projectUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(projectUrl).origin && new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
