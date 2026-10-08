// The owners an import can come from (#77): the account's organizations,
// `GET /user/orgs` (E43, E61), and every owner with a catalog entry whose name
// contains a search, `GET /catalog/list/owners` (E35, E61), both mapped
// to an owner's login and display name here. Door43's field names stop in
// this module.

import { CatalogError } from '@tc-admin/shared/schema';
import { readDoor43, readPages } from './api';
import type { Door43Client } from './api';

/** An owner in glossary terms: its login, and its display name, the login when Door43 has none. */
export interface Owner {
  login: string;
  name: string;
}

function owner(login: unknown, fullName: unknown): Owner | null {
  if (typeof login !== 'string' || !login) return null;
  const name = typeof fullName === 'string' && fullName.trim() ? fullName.trim() : login;
  return { login, name };
}

/** One organization as `GET /user/orgs` returns it (E43, E61). Only the fields read. */
interface Door43Organization {
  id: number;
  username?: unknown;
  name?: unknown;
  full_name?: unknown;
}

/**
 * The organizations the account belongs to (`GET /user/orgs`), every page: the list
 * pages by `page` and `limit` and ends on an empty page (E61), as the account's teams
 * do (E43). The organization's login is `username`, or `name` where Door43 gives only
 * that, as for a team's organization.
 */
export async function readOrganizations(client: Door43Client): Promise<Owner[]> {
  const organizations = await readPages<Door43Organization>(client, '/user/orgs');
  return organizations.flatMap(organization => owner(organization.username ?? organization.name, organization.full_name) ?? []);
}

/** One owner as `GET /catalog/list/owners` returns it: Gitea's user shape, for an organization and a user account alike (E35). Only the fields read. */
interface Door43CatalogOwner {
  login?: unknown;
  full_name?: unknown;
}

/**
 * Every owner, organization or user account, with a catalog entry on a release or
 * its default branch whose name contains `q`
 * (`GET /catalog/list/owners?owner=<q>&partialMatch=1&stage=latest`, E35): one
 * request, which answers every match at once, since the endpoint ignores `limit`
 * and `page` (E61), so neither is sent. No match is `data: null` (E61); any other
 * shape is not an answer (`door43_unavailable`), never an empty one.
 */
export async function searchCatalogOwners(client: Door43Client, q: string): Promise<Owner[]> {
  const body = await readDoor43<{ data?: unknown } | null>(client, '/catalog/list/owners', { owner: q, partialMatch: '1', stage: 'latest' });
  if (body?.data === null) return [];
  if (!Array.isArray(body?.data)) throw new CatalogError('door43_unavailable', { details: { reason: 'unexpected list shape' } });
  return body.data.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const { login, full_name } = entry as Door43CatalogOwner;
    return owner(login, full_name) ?? [];
  });
}
