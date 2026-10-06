// The typed client: one call per catalog operation, with its route, input,
// and output taken from `shared/schema` (operations.md §7). A failure is an
// `ApiError` carrying the catalog error shape; the client branches on `code`,
// never on `message`. The Worker issues the signed-in browser's CSRF token in
// a response header; the client keeps it in memory only and sends it on every
// `POST` (A4, A1).

import { CSRF_HEADER, ERROR_CATALOG, OPERATIONS, OperationErrorShape, catalogMessage, routeParams } from '@tc-admin/shared/schema';
import type { OperationDefinition, OperationInput, OperationOutput, RoutedOperation } from '@tc-admin/shared/schema';

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

/** The request a call makes: path fields fill the route; the rest is the query of a GET or the JSON body of a POST. */
export function operationRequest(name: RoutedOperation, input: Readonly<Record<string, unknown>>): { url: string; init: RequestInit } {
  const route = (OPERATIONS[name] as OperationDefinition).route!;
  const params = new Set(routeParams(route.path));
  const path = route.path.replace(/\{([a-z_]+)\}/g, (_, field: string) => encodeURIComponent(String(input[field])));
  const rest = Object.entries(input).filter(([field, value]) => !params.has(field) && value !== undefined);
  if (route.method === 'GET') {
    const query = new URLSearchParams(rest.filter(([, value]) => value !== null).map(([field, value]): [string, string] => [field, String(value)])).toString();
    return { url: query ? `${path}?${query}` : path, init: { method: 'GET', headers: { accept: 'application/json' } } };
  }
  return {
    url: path,
    init: { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(rest)) },
  };
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
  const headers = init.method === 'POST' ? mutationHeaders(init.headers) : new Headers(init.headers);
  const response = await fetcher(url, { ...init, headers, credentials: 'same-origin' });
  rememberCsrfToken(response);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = OperationErrorShape.safeParse(body);
    throw new ApiError(parsed.success ? parsed.data : unexpected(response.headers.get('x-request-id') ?? 'unknown'), response.status);
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
