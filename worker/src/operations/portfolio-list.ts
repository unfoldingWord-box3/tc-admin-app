// `portfolio.list` (operations.md §4). The filter, carried over from the
// prototype: a repository is listed when it is not archived and Door43
// explicitly grants push or admin (P1, P2); nothing else is filtered out. The
// operation itself is #23.

import type { RepositoryAccess } from '../door43/repos';

export function isListed(access: RepositoryAccess): boolean {
  return !access.archived && (access.push || access.admin);
}
