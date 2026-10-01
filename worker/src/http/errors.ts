// Every failure becomes the catalog's error shape (X2): a `CatalogError` keeps
// its code and message; anything else thrown is `unexpected`, with a message
// that carries only the request id. Logs carry the request id, the code, and
// the redacted details, never a token or file contents (X3).

import { CatalogError, ERROR_CATALOG, catalogMessage } from '@tc-admin/shared/schema';
import type { ErrorEntry, OperationErrorShape } from '@tc-admin/shared/schema';

export interface ErrorResponse {
  status: number;
  body: OperationErrorShape;
}

export function errorResponse(error: unknown, requestId: string): ErrorResponse {
  const known = error instanceof CatalogError ? error : null;
  const code = known?.code ?? 'unexpected';
  const entry: ErrorEntry = ERROR_CATALOG[code];
  const message = known && code !== 'unexpected' ? known.message : catalogMessage('unexpected', undefined, { request_id: requestId });
  return {
    status: entry.http ?? 500,
    body: {
      code,
      message,
      retryable: entry.retryable,
      next_action: entry.next_action,
      request_id: requestId,
      details: known ? { ...known.details } : {},
      invariant: entry.invariants[0] ?? null,
    },
  };
}

export function logFailure(error: unknown, response: ErrorResponse): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(JSON.stringify({ request_id: response.body.request_id, code: response.body.code, details: response.body.details, kind }));
}
