// `owner.search` (operations.md §4): the owners an import can come from. The
// account's organizations (`GET /user/orgs`), listed first and always, and,
// when the manager has typed a search, every owner with a catalog entry whose
// name contains it (`GET /catalog/list/owners`, E35), organization or user
// account. Each list by name, each owner once in it; an organization of the
// account that also matches is in both, since each list answers its own
// question. Read live each time, with its freshness (P3).

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readOrganizations, searchCatalogOwners } from '../door43/owners';
import type { Owner } from '../door43/owners';
import type { OperationContext } from './context';
import { signedIn } from './context';

const byName = (a: Owner, b: Owner) => a.login.localeCompare(b.login, undefined, { sensitivity: 'base' });

/** Each owner once, the first spelling Door43 gave, by name. */
function listed(owners: Owner[]): Owner[] {
  const seen = new Map<string, Owner>();
  for (const entry of owners) if (!seen.has(entry.login.toLowerCase())) seen.set(entry.login.toLowerCase(), entry);
  return [...seen.values()].sort(byName);
}

export async function ownerSearch(input: ParsedInput<'owner.search'>, context: OperationContext): Promise<OperationOutput<'owner.search'>> {
  const client = signedIn(context);
  const q = input.q?.trim() || null;
  try {
    const [organizations, matches] = await Promise.all([readOrganizations(client), q ? searchCatalogOwners(client, q) : Promise.resolve([])]);
    return { own: listed(organizations), matches: listed(matches), freshness: { read_at: context.now().toISOString(), source: 'live', age_seconds: 0 } };
  } catch (error) {
    // Neither read names a project, so a refusal or a missing list is Door43 not answering, the one other error this read raises.
    if (error instanceof CatalogError && (error.code === 'not_found' || error.code === 'permission_denied')) {
      throw new CatalogError('door43_unavailable', { cause: error, details: error.details });
    }
    throw error;
  }
}
