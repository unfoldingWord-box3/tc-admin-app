// Reads from the Door43 API with the signed-in manager's token, carried over
// from the prototype: requests go to the configured host only, never follow
// a redirect, time out, and send the token only in the authorization header
// (A1, A3). Door43's statuses become catalog codes here; nothing above this
// module sees an HTTP status from Door43.

import { CatalogError } from '@tc-admin/shared/schema';
import type { Door43Host } from './host';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Door43Client {
  host: Door43Host;
  /** The session's Door43 token. Never logged, never returned (A1). */
  token: string;
  fetch?: Fetch;
}

const TIMEOUT_MS = 30_000;

/** One request to the configured host. Refuses any other origin. */
export async function door43Request(host: Door43Host, url: string, init: RequestInit = {}, fetcher: Fetch = fetch): Promise<Response> {
  if (new URL(url).origin !== host.origin) {
    throw new CatalogError('unexpected', { details: { reason: 'request outside the configured Door43 host' } });
  }
  try {
    return await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    throw new CatalogError('door43_unavailable', { cause });
  }
}

/** `GET /api/v1<path>` as JSON. 401 is `session_expired`, 403 `permission_denied`, 404 `not_found`, anything else `door43_unavailable`. */
export async function readDoor43<T = unknown>(client: Door43Client, path: string, query: Readonly<Record<string, string | number | boolean>> = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new CatalogError('unexpected', { details: { reason: 'invalid Door43 API path' } });
  const url = new URL(`/api/v1${path}`, client.host.origin);
  url.search = new URLSearchParams(Object.entries(query).map(([key, value]): [string, string] => [key, String(value)])).toString();
  const response = await door43Request(
    client.host,
    url.href,
    { headers: { accept: 'application/json', authorization: `Bearer ${client.token}` } },
    client.fetch,
  );
  const status = { door43_status: response.status };
  if (response.status === 401) throw new CatalogError('session_expired', { details: status });
  if (response.status === 403) throw new CatalogError('permission_denied', { details: status });
  if (response.status === 404) throw new CatalogError('not_found', { details: status });
  if (!response.ok) throw new CatalogError('door43_unavailable', { details: status });
  return (await response.json()) as T;
}

/** The prototype's read limit: 2000 pages of 50. Beyond it nothing partial is returned (`portfolio_too_large`). */
export const MAX_PAGES = 2000;
const PAGE_SIZE = 50;

/**
 * Every page of a list endpoint, until an empty page. A page that repeats an
 * earlier one fails as `door43_unavailable` rather than looping, and a list
 * longer than `maxPages` fails as `portfolio_too_large` (P1).
 */
export async function readPages<T extends { id: number }>(
  client: Door43Client,
  path: string,
  query: Readonly<Record<string, string | number | boolean>> = {},
  maxPages = MAX_PAGES,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const body = await readDoor43<T[] | { data?: T[] }>(client, path, { ...query, page, limit: PAGE_SIZE });
    const batch = Array.isArray(body) ? body : body.data;
    if (!Array.isArray(batch)) throw new CatalogError('door43_unavailable', { details: { reason: 'unexpected list shape' } });
    if (batch.length === 0) return items;
    const signature = JSON.stringify(batch.map(item => item.id));
    if (seen.has(signature)) throw new CatalogError('door43_unavailable', { details: { reason: 'repeated result page', page } });
    seen.add(signature);
    items.push(...batch);
  }
  throw new CatalogError('portfolio_too_large');
}
