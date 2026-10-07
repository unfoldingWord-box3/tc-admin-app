// `preparation.read` (operations.md §3, #36): the preparation as stored, with
// the health of its temporary branch read from Door43 while the preparation
// waits on it (`health_checking`, or `health_blocked` when the manager
// refreshes), and the state the health moves it to (domain model §6, H1, H2):
// `healthy`, `info`, and `warning` to `ready_for_release`, `warning` with the
// manager's acknowledgement still to come; a pending check stays
// `health_checking`; everything else is `health_blocked`. Before any of that,
// a default-branch head that moved since the plan makes the preparation
// `restart_required` (R5). The repository is read first in every state, as the
// caller's access check. A preparation not waiting on the check is answered as
// stored, with no health read. The Worker reads once per call;
// the client polls (HEALTH_POLL in the shared schema).

import { CatalogError } from '@tc-admin/shared/schema';
import type { Health, OperationOutput, ParsedInput, Preparation, PreparationState } from '@tc-admin/shared/schema';
import { repositoryRefs } from '../door43/catalog';
import { readHealth } from '../door43/health';
import { readRepository } from '../door43/repos';
import { healthOfRead, releasable } from '../model/health';
import { signedIn } from './context';
import type { OperationContext } from './context';

/** The states in which the preparation waits on Door43's health check. */
const POLLED: ReadonlySet<PreparationState> = new Set<PreparationState>(['health_checking', 'health_blocked']);
/** The states a moved default branch invalidates (R5): bound, not yet released, not discarded. */
const BOUND: ReadonlySet<PreparationState> = new Set<PreparationState>(['snapshot_prepared', 'health_checking', 'health_blocked', 'ready_for_release', 'retryable_failure']);

/** The state a health value moves a waiting preparation to (domain model §6). */
export function stateOfHealth(health: Health): PreparationState {
  if (releasable(health.state)) return 'ready_for_release';
  if (health.state === 'checking') return 'health_checking';
  return 'health_blocked';
}

export async function preparationRead(input: ParsedInput<'preparation.read'>, context: OperationContext): Promise<OperationOutput<'preparation.read'>> {
  const client = signedIn(context);
  const { owner, repo, preparation_id: id } = input;
  // The store is keyed by project, not by account: the caller's own repository read is the access check, in every state,
  // before the store is consulted, so a repository the token cannot see is `not_found` whether or not a preparation exists.
  const repository = await readRepository(client, owner, repo);
  const stored = await context.plans.getPreparation<Preparation>(owner, repo, id);
  if (!stored) throw new CatalogError('not_found', { details: { owner, repo, preparation_id: id } });
  const at = context.now().toISOString();
  const fresh = (preparation: Preparation): Preparation => ({ ...preparation, freshness: { read_at: at, source: 'live', age_seconds: 0 } });
  if (!BOUND.has(stored.state)) return fresh(stored);

  // R5: the binding is to the default-branch head the plan read; a head that moved means the release must restart.
  // A head Door43 does not name (no catalog `latest` stage) is unknown, not a move: nothing is written (decided 7 October 2026 by Rich).
  const head = repositoryRefs(repository).default_branch?.sha ?? null;
  if (head !== null && head !== stored.bound_to.default_branch_sha) {
    const restarted = fresh({ ...stored, state: 'restart_required', history: [...stored.history, { at, from: stored.state, to: 'restart_required', event: `default branch moved to ${head ?? 'none'}` }] });
    await context.plans.putPreparation(owner, repo, id, restarted);
    return restarted;
  }
  if (!POLLED.has(stored.state) || !stored.snapshot) return fresh(stored);

  const health = healthOfRead(await readHealth(client, owner, repo, stored.snapshot.branch), stored.snapshot.branch, at);
  const state = stateOfHealth(health);
  const history = state === stored.state ? stored.history : [...stored.history, { at, from: stored.state, to: state, event: `health ${health.state}` }];
  const read = fresh({ ...stored, state, health, requires_acknowledgement: health.state === 'warning', history });
  await context.plans.putPreparation(owner, repo, id, read);
  return read;
}
