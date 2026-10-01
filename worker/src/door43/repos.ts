// Writable-repository discovery, carried over from the prototype: the signed-in
// account's repository search, every page, de-duplicated by repository id, and
// Door43's permission fields read strictly (P2). The portfolio filter is in
// `operations/portfolio-list.ts`.

import { readPages } from './api';
import type { Door43Client } from './api';
import type { Door43Repository } from './catalog';

/** The repository search fields discovery reads (E7). */
export interface Door43SearchRepository extends Door43Repository {
  archived?: boolean | null;
  permissions?: { admin?: unknown; push?: unknown; pull?: unknown } | null;
}

/** A repository's access in glossary terms. Only an explicit `true` grants anything (P2). */
export interface RepositoryAccess {
  archived: boolean;
  push: boolean;
  admin: boolean;
}

export function repositoryAccess(repo: Door43SearchRepository): RepositoryAccess {
  return {
    archived: repo.archived === true,
    push: repo.permissions?.push === true,
    admin: repo.permissions?.admin === true,
  };
}

/** Every repository the account can see, each once (`GET /repos/search?uid=`, E7). */
export async function searchRepositories(client: Door43Client, userId: number): Promise<Door43SearchRepository[]> {
  const repositories = await readPages<Door43SearchRepository>(client, '/repos/search', { uid: userId, exclusive: false, private: true });
  return [...new Map(repositories.map(repo => [repo.id, repo])).values()];
}
