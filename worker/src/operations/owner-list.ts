// `owner.list` (operations.md §4): the owners the signed-in account may
// create a project in, and nothing else, so the wizard offers only what
// Door43 permits (decided 6 October 2026 by Rich; product spec §6). The
// account itself, which creates through `POST /user/repos` with the
// `write:user` scope sign-in requests (Q28), and every organization in which
// a team of the account is the owner team or may create repositories
// (`GET /user/teams`, every page, E43), read live each time, as
// `project.create.plan` and `project.create.apply` read it (A2). An
// organization the account belongs to without that right is not listed.
// Organizations come by name, the account last (product spec §2).

import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import { creationRights } from '../door43/repos';
import type { OperationContext } from './context';
import { signedIn } from './context';

type OwnerList = OperationOutput<'owner.list'>;

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export async function ownerList(_input: ParsedInput<'owner.list'>, context: OperationContext): Promise<OwnerList> {
  const client = signedIn(context);
  const { account } = await readAccount(client);
  const rights = await creationRights(client);
  const organizations = new Map<string, OwnerList['owners'][number]>();
  for (const right of rights) {
    const key = right.organization.toLowerCase();
    // Any one team that may create is enough, whatever the order Door43 lists them in; the account's own name is never an organization.
    if (!right.can_create || key === account.login.toLowerCase() || organizations.has(key)) continue;
    organizations.set(key, { login: right.organization, name: right.name, kind: 'organization' });
  }
  return {
    owners: [...[...organizations.values()].sort((a, b) => byName(a.login, b.login)), { login: account.login, name: account.name, kind: 'account' }],
    freshness: { read_at: context.now().toISOString(), source: 'live', age_seconds: 0 },
  };
}
