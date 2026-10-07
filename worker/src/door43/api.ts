// Reads and writes to the Door43 API with the signed-in manager's token, the
// reads carried over from the prototype: requests go to the configured host
// only, never follow a redirect, time out, and send the token only in the
// authorization header (A1, A3). A write is sent once and never retried (X1). The Workers runtime refuses `redirect: 'error'` (E39), so a
// request is sent with `manual` and any redirect answer is refused here. Door43's statuses become catalog codes here; nothing above this
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
  let response: Response;
  try {
    response = await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    throw new CatalogError('door43_unavailable', { cause });
  }
  // A redirect could carry the token to another address; it is never followed.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new CatalogError('door43_unavailable', { details: { reason: 'Door43 answered with a redirect', door43_status: response.status } });
  }
  return response;
}

/** A query value; an array repeats the parameter, which Door43's search reads as any of the values (E41). */
export type QueryValue = string | number | boolean | readonly string[];
export type Query = Readonly<Record<string, QueryValue>>;

/** One read of `/api/v1<path>` with the session token. 401 is `session_expired`, 403 `permission_denied`, 404 `not_found`, anything else not ok `door43_unavailable`. */
async function readResponse(client: Door43Client, path: string, query: Query, accept: string): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new CatalogError('unexpected', { details: { reason: 'invalid Door43 API path' } });
  const url = new URL(`/api/v1${path}`, client.host.origin);
  url.search = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]): [string, string][] => (Array.isArray(value) ? value.map(item => [key, item]) : [[key, String(value)]])),
  ).toString();
  const response = await door43Request(client.host, url.href, { headers: { accept, authorization: `Bearer ${client.token}` } }, client.fetch);
  const status = { door43_status: response.status };
  if (response.status === 401) throw new CatalogError('session_expired', { details: status });
  if (response.status === 403) throw new CatalogError('permission_denied', { details: status });
  if (response.status === 404) throw new CatalogError('not_found', { details: status });
  if (!response.ok) throw new CatalogError('door43_unavailable', { details: status });
  return response;
}

/** `GET /api/v1<path>` as JSON. */
export async function readDoor43<T = unknown>(client: Door43Client, path: string, query: Query = {}): Promise<T> {
  return (await (await readResponse(client, path, query, 'application/json')).json()) as T;
}

/**
 * `GET /api/v1<path>` as bytes, for an archive (E34), up to `limit` bytes: a body
 * that declares more, or streams more, is refused as `door43_unavailable` before
 * it is held whole (decided 7 October 2026 by Rich, Q22); one that cannot be read
 * is too.
 */
export async function readDoor43Bytes(client: Door43Client, path: string, limit: number): Promise<Uint8Array> {
  const response = await readResponse(client, path, {}, 'application/zip, application/octet-stream');
  const tooLarge = (bytes: number) => new CatalogError('door43_unavailable', { details: { reason: 'archive larger than the limit', bytes, limit } });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(declared);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  // Each chunk is copied into one buffer as it arrives and not kept, so the body is held once, not as chunks and a copy of them.
  // The buffer starts at the declared length (a hint only: a decoded body may differ) and otherwise doubles up to the limit,
  // so at most the old and new buffers are live together: the limit once with a true Content-Length, one and a half times with none,
  // and under twice the limit only when a declared length is wrong.
  let out = new Uint8Array(Number.isFinite(declared) && declared > 0 ? declared : Math.min(limit, 1024 * 1024));
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > limit) {
        await reader.cancel();
        throw tooLarge(total + value.byteLength);
      }
      if (total + value.byteLength > out.length) {
        const grown = new Uint8Array(Math.min(limit, Math.max(out.length * 2, total + value.byteLength)));
        grown.set(out.subarray(0, total));
        out = grown;
      }
      out.set(value, total);
      total += value.byteLength;
    }
  } catch (cause) {
    if (cause instanceof CatalogError) throw cause;
    throw new CatalogError('door43_unavailable', { cause, details: { reason: 'unreadable response body' } });
  }
  return total === out.length ? out : out.subarray(0, total);
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
  query: Query = {},
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

/** What one write came back with: Door43's status and parsed body, for the endpoint's module to map. */
export interface WriteOutcome {
  status: number;
  body: unknown;
}

/**
 * One write (`POST`, `PATCH`, `DELETE`) to `/api/v1<path>` with a JSON body, sent
 * once and never retried, whatever the outcome (X1). 401 is `session_expired`
 * and 403 `permission_denied` here; every other status is returned for the
 * endpoint to map, since a 409 or 422 means something different per endpoint.
 */
export async function writeDoor43(client: Door43Client, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<WriteOutcome> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new CatalogError('unexpected', { details: { reason: 'invalid Door43 API path' } });
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${client.token}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await door43Request(client.host, new URL(`/api/v1${path}`, client.host.origin).href, init, client.fetch);
  const status = { door43_status: response.status };
  if (response.status === 401) throw new CatalogError('session_expired', { details: status });
  if (response.status === 403) throw new CatalogError('permission_denied', { details: status });
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    // The status arrived and the body did not: what Door43 did is unknown, as for a lost request, and is not retried (X1).
    throw new CatalogError('door43_unavailable', { cause, details: { ...status, reason: 'unreadable response body' } });
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text.slice(0, 500) };
  }
  return { status: response.status, body: parsed };
}

/** Door43's own `message` from an error body, for the catalog messages that quote it; the status when there is none. */
export function door43Message(outcome: WriteOutcome): string {
  const body = outcome.body as { message?: unknown } | null;
  return typeof body?.message === 'string' && body.message ? body.message : `Door43 answered ${outcome.status}`;
}

/** File bytes as base64, which the contents endpoint takes (E21). Chunked so a book-sized file does not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
