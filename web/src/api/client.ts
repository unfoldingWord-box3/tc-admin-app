// The typed client: one call per catalog operation, with its route, input,
// and output taken from `shared/schema` (operations.md §7). A failure is an
// `ApiError` carrying the catalog error shape; the client branches on `code`,
// never on `message`. The Worker issues the signed-in browser's CSRF token in
// a response header; the client keeps it in memory only and sends it on every
// `POST` (A4, A1). A route that says `body: 'multipart'` (`upload.plan`) sends
// its input as `multipart/form-data`, the files' bytes as file parts (Q33).

import { CSRF_HEADER, ERROR_CATALOG, IDEMPOTENCY_HEADER, OPERATIONS, OperationErrorShape, UPLOAD_CONFIRMATIONS_PART, catalogMessage, routeParams, uploadPartName } from '@tc-admin/shared/schema';
import type { OperationDefinition, OperationInput, OperationOutput, RoutedOperation } from '@tc-admin/shared/schema';
import { reportPermissionDenied } from '../revoked';

export class ApiError extends Error {
  readonly error: OperationErrorShape;
  readonly status: number;

  constructor(error: OperationErrorShape, status: number) {
    super(error.message);
    this.name = 'ApiError';
    this.error = error;
    this.status = status;
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The message to show for a failure: the catalog's for an `ApiError`; a network failure reads as Door43 unavailable. */
export const failureMessage = (failure: unknown): string => (failure instanceof ApiError ? failure.error.message : catalogMessage('door43_unavailable'));

let csrfToken: string | null = null;

/** Keeps the CSRF token a response carries, if any (A4). */
export function rememberCsrfToken(response: Response): void {
  const token = response.headers.get(CSRF_HEADER);
  if (token) csrfToken = token;
}

/** For tests: forgets the token, as a new page would. */
export function forgetCsrfToken(): void {
  csrfToken = null;
}

/** A mutation's request headers: the token, when the Worker has issued one. */
function mutationHeaders(headers: HeadersInit | undefined): Headers {
  const sent = new Headers(headers);
  if (csrfToken) sent.set(CSRF_HEADER, csrfToken);
  return sent;
}

/** An operation's path, its `{name}` segments filled from the input's fields of those names. */
export function operationPath(name: RoutedOperation, input: Readonly<Record<string, unknown>>): string {
  const route = (OPERATIONS[name] as OperationDefinition).route!;
  return route.path.replace(/\{([a-z_]+)\}/g, (_, field: string) => encodeURIComponent(String(input[field])));
}

/** One file of a multipart upload: its name, the mode the client read if any (a browser reads none), and its bytes. */
export interface MultipartFile {
  name: string;
  mode?: number | null | undefined;
  content: Uint8Array;
}

/**
 * A `multipart/form-data` body (operations.md §7, Q33): for the file at index `i` of `files`, the parts
 * `files.<i>.name`, `files.<i>.mode` (only when the client read one), and `files.<i>.content` (a file part with
 * the bytes); `confirmations` as one JSON part; any other field as a text part of its own name.
 */
export function multipartBody(fields: Readonly<Record<string, unknown>>): FormData {
  const form = new FormData();
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (field === 'files' && Array.isArray(value)) {
      (value as readonly MultipartFile[]).forEach((file, index) => {
        form.append(uploadPartName(index, 'name'), file.name);
        if (typeof file.mode === 'number') form.append(uploadPartName(index, 'mode'), String(file.mode));
        // A copy whose buffer is a plain ArrayBuffer, as a Blob part must be.
        form.append(uploadPartName(index, 'content'), new Blob([new Uint8Array(file.content)]), file.name.split('/').pop() || 'file');
      });
    } else if (field === UPLOAD_CONFIRMATIONS_PART) form.append(field, JSON.stringify(value));
    else form.append(field, String(value));
  }
  return form;
}

/** The request a call makes: path fields fill the route; the rest is the query of a GET, the JSON body of a POST, or the multipart body of a route that says so. */
export function operationRequest(name: RoutedOperation, input: Readonly<Record<string, unknown>>): { url: string; init: RequestInit } {
  const route = (OPERATIONS[name] as OperationDefinition).route!;
  const params = new Set(routeParams(route.path));
  const path = operationPath(name, input);
  const rest = Object.entries(input).filter(([field, value]) => !params.has(field) && value !== undefined);
  if (route.method === 'GET') {
    const query = new URLSearchParams(rest.filter(([, value]) => value !== null).map(([field, value]): [string, string] => [field, String(value)])).toString();
    return { url: query ? `${path}?${query}` : path, init: { method: 'GET', headers: { accept: 'application/json' } } };
  }
  // An apply names its plan in the body and as the idempotency key (operations.md §7).
  const headers: Record<string, string> = { accept: 'application/json' };
  if (typeof input.plan_id === 'string') headers[IDEMPOTENCY_HEADER] = input.plan_id;
  // A multipart body carries its own content type, with the boundary the browser chooses.
  if (route.body === 'multipart') return { url: path, init: { method: 'POST', headers, body: multipartBody(Object.fromEntries(rest)) } };
  headers['content-type'] = 'application/json';
  return { url: path, init: { method: 'POST', headers, body: JSON.stringify(Object.fromEntries(rest)) } };
}

/** The error a response without the catalog shape stands for (X2). */
function unexpected(requestId: string): OperationErrorShape {
  const entry = ERROR_CATALOG.unexpected;
  return {
    code: 'unexpected',
    message: catalogMessage('unexpected', undefined, { request_id: requestId }),
    retryable: entry.retryable,
    next_action: entry.next_action,
    request_id: requestId,
    details: {},
    invariant: entry.invariants[0],
  };
}

export async function callOperation<Name extends RoutedOperation>(
  name: Name,
  input: OperationInput<Name>,
  fetcher: Fetch = (url, init) => fetch(url, init),
): Promise<OperationOutput<Name>> {
  const { url, init } = operationRequest(name, input as Record<string, unknown>);
  return sendOperation(name, url, init, fetcher);
}

/**
 * Sends one operation's request as built, with the CSRF token on a `POST`, and reads its answer as `callOperation`
 * does: the output parsed by the operation's schema, or an `ApiError`. For a request the schema does not yet
 * describe whole, such as `upload.apply` with its files (`applyUpload` in `web/src/upload.ts`, #75).
 */
export async function sendOperation<Name extends RoutedOperation>(
  name: Name,
  url: string,
  init: RequestInit,
  fetcher: Fetch = (address, options) => fetch(address, options),
): Promise<OperationOutput<Name>> {
  const headers = init.method === 'POST' ? mutationHeaders(init.headers) : new Headers(init.headers);
  const response = await fetcher(url, { ...init, headers, credentials: 'same-origin' });
  rememberCsrfToken(response);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = OperationErrorShape.safeParse(body);
    const error = new ApiError(parsed.success ? parsed.data : unexpected(response.headers.get('x-request-id') ?? 'unknown'), response.status);
    // A project the manager lost write access to leaves the portfolio (A2, #14), whichever view made the call.
    if (error.error.code === 'permission_denied') reportPermissionDenied(url);
    throw error;
  }
  return (OPERATIONS[name] as OperationDefinition).output!.parse(body) as OperationOutput<Name>;
}

/** Ends the session (`POST /auth/logout`). A refusal is an `ApiError`; a network failure rejects as it is. */
export async function signOut(fetcher: Fetch = (url, init) => fetch(url, init)): Promise<void> {
  const response = await fetcher('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: mutationHeaders({ accept: 'application/json' }) });
  if (response.ok) {
    forgetCsrfToken();
    return;
  }
  const parsed = OperationErrorShape.safeParse(await response.json().catch(() => null));
  throw new ApiError(parsed.success ? parsed.data : unexpected(response.headers.get('x-request-id') ?? 'unknown'), response.status);
}
