// `preparation.list` (operations.md §3, #125; decided 8 October 2026 by
// Rich): the release preparations stored for one project, so a manager who
// closed or reloaded the page, or signed in again, can find a preparation
// again and continue or discard it. The push permission is re-read first,
// strictly, before anything stored is answered (A2, as `preparation.discard`
// does); then every preparation stored under the project, newest first, each
// as last stored: no Door43 read beyond the permission, so its state is the
// one last stored, and `preparation.read` is the live one (R5, H1). A record
// that no longer parses as a preparation is left out, never thrown. Workers
// KV lists eventually: a preparation stored a moment ago may not be listed yet.

import { CatalogError, Preparation } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readRepository, repositoryAccess } from '../door43/repos';
import { signedIn } from './context';
import type { OperationContext } from './context';

type PreparationList = OperationOutput<'preparation.list'>;

/** When a preparation last changed: its last history entry, else the time it was last stored. */
export function lastChanged(preparation: Pick<Preparation, 'history' | 'freshness'>): string {
  return preparation.history.at(-1)?.at ?? preparation.freshness.read_at;
}

const time = (at: string): number => {
  const value = new Date(at).getTime();
  return Number.isNaN(value) ? 0 : value;
};

export async function preparationList(input: ParsedInput<'preparation.list'>, context: OperationContext): Promise<PreparationList> {
  const client = signedIn(context);
  const { owner, repo } = input;
  // The permission first, strictly (A2): nothing stored is answered to an account that may not push to the project.
  const access = repositoryAccess(await readRepository(client, owner, repo));
  if (!access.push && !access.admin) throw new CatalogError('permission_denied', { details: { owner, repo } });

  const now = context.now();
  const preparations: Preparation[] = [];
  for (const stored of await context.plans.listPreparations(owner, repo)) {
    const parsed = Preparation.safeParse(stored);
    // A record written by an older shape, or not a preparation of this project, is left out.
    if (!parsed.success) continue;
    const preparation = parsed.data;
    if (preparation.project_ref.owner.toLowerCase() !== owner.toLowerCase() || preparation.project_ref.repo !== repo) continue;
    // As stored, not read live: its age is the time since it was last stored.
    const age = Math.max(0, Math.floor((now.getTime() - time(preparation.freshness.read_at)) / 1000));
    preparations.push({ ...preparation, freshness: { read_at: preparation.freshness.read_at, source: 'cache', age_seconds: age } });
  }
  preparations.sort((a, b) => time(lastChanged(b)) - time(lastChanged(a)) || b.id.localeCompare(a.id));
  return { preparations, freshness: { read_at: now.toISOString(), source: 'live', age_seconds: 0 } };
}
