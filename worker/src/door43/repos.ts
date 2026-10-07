// Writable-repository discovery, carried over from the prototype: the signed-in
// account's repository search, every page, de-duplicated by repository id, and
// Door43's permission fields read strictly (P2). The portfolio filter is in
// `operations/portfolio-list.ts`. Also the two reads a project plan needs:
// whether a repository name is taken, and in which organizations the account
// may create repositories (E43).

import { CatalogError } from '@tc-admin/shared/schema';
import { readDoor43, readPages } from './api';
import type { Door43Client } from './api';
import type { Door43Repository } from './catalog';
import { SUPPORTED_FLAVORS } from '../model/project';

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

/**
 * The search filter for the repositories tC Admin manages: Scripture Burrito
 * with exactly the flavors the model classifies as `bible` or `obs` (ADR 0013,
 * ADR 0014). Door43 reads a repeated `flavor` as any of them (E41).
 */
const SUPPORTED_ONLY = { metadataType: 'sb', flavor: SUPPORTED_FLAVORS } as const;

/**
 * Every repository the account can see, each once (`GET /repos/search?uid=`, E7);
 * with `supportedOnly`, only the Scripture Burrito Bible and Open Bible Stories
 * ones, which keeps a large account's portfolio quick (ADR 0014).
 */
export async function searchRepositories(client: Door43Client, userId: number, supportedOnly = false): Promise<Door43SearchRepository[]> {
  const query = { uid: userId, exclusive: false, private: true, ...(supportedOnly ? SUPPORTED_ONLY : {}) };
  const repositories = await readPages<Door43SearchRepository>(client, '/repos/search', query);
  return [...new Map(repositories.map(repo => [repo.id, repo])).values()];
}

/** `GET /repos/{owner}/{repo}` (E14): the repository with its catalog view, stages, and the account's permissions. A missing one is `not_found`. */
export async function readRepository(client: Door43Client, owner: string, repo: string): Promise<Door43SearchRepository> {
  return readDoor43<Door43SearchRepository>(client, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

/** `GET /repos/{owner}/{repo}`: whether a repository of that name exists in the owner (`name_taken`). Door43's 404 is the only "no". */
export async function repositoryExists(client: Door43Client, owner: string, repo: string): Promise<boolean> {
  try {
    await readDoor43(client, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    return true;
  } catch (error) {
    if (error instanceof CatalogError && error.code === 'not_found') return false;
    throw error;
  }
}

/** One of the account's teams as `GET /user/teams` returns it (E43). Only the fields read. */
interface Door43Team {
  id: number;
  organization?: { username?: unknown; name?: unknown; full_name?: unknown } | null;
  permission?: unknown;
  can_create_org_repo?: unknown;
}

/** Whether the account may create repositories in an organization, in glossary terms. */
export interface CreationRight {
  organization: string;
  /** The organization's display name, the login when Door43 has none. */
  name: string;
  can_create: boolean;
}

/**
 * The organizations the account belongs to through a team, each with whether that
 * team may create repositories (`GET /user/teams`, E43): an owner team, or a team
 * with `can_create_org_repo`. Every page is read, so a granting team listed after
 * the first page still grants. Read strictly: only an explicit `true` or `owner`
 * grants anything (A2 fails closed).
 */
export async function creationRights(client: Door43Client): Promise<CreationRight[]> {
  const teams = await readPages<Door43Team>(client, '/user/teams');
  return teams.flatMap(team => {
    const organization = team.organization?.username ?? team.organization?.name;
    if (typeof organization !== 'string' || !organization) return [];
    const fullName = team.organization?.full_name;
    const name = typeof fullName === 'string' && fullName.trim() ? fullName.trim() : organization;
    return [{ organization, name, can_create: team.permission === 'owner' || team.can_create_org_repo === true }];
  });
}
