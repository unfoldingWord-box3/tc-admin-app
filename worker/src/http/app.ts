// The HTTP projection of the operation catalog (operations.md §7): match the
// route, validate the input against the shared schema, run the operation,
// validate its output, and answer with the output or the error shape (X2).
// Sign-in, sessions, and CSRF (#12, #13) join here.

import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { OperationDefinition } from '@tc-admin/shared/schema';
import type { z } from 'zod';
import type { Env } from '../env';
import { HANDLERS, operationContext } from '../operations';
import type { OperationContext } from '../operations';
import { errorResponse, logFailure } from './errors';
import { matchRoute } from './router';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

function json(status: number, body: unknown, requestId: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'x-request-id': requestId } });
}

async function readInput(request: Request, url: URL, params: Record<string, string>): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return { ...Object.fromEntries(url.searchParams), ...params };
  const text = await request.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new CatalogError('validation_failed', { message: 'The request body is not valid JSON.' });
    }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CatalogError('validation_failed', { message: 'The request body must be a JSON object.' });
  }
  return { ...body, ...params };
}

function validationError(error: z.ZodError): CatalogError {
  const fields = error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
  const message = fields.map(field => (field.path ? `${field.path}: ${field.message}` : field.message)).join('; ');
  return new CatalogError('validation_failed', { message, details: { fields } });
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(request.url);
    const context: OperationContext = operationContext({ door43Origin: env.DOOR43_ORIGIN, door43ClientId: env.DOOR43_CLIENT_ID }, requestId);
    const match = matchRoute(request.method, url.pathname);
    // Q26: the catalog has no code for a route that is not an operation, or an operation not built yet.
    if (!match) throw new CatalogError('unexpected', { details: { reason: 'no operation at this route' } });
    const handler = HANDLERS[match.operation] as ((input: unknown, context: OperationContext) => Promise<unknown>) | undefined;
    if (!handler) throw new CatalogError('unexpected', { details: { reason: 'operation not built yet', operation: match.operation } });

    const definition: OperationDefinition = OPERATIONS[match.operation];
    const parsed = definition.input!.safeParse(await readInput(request, url, match.params));
    if (!parsed.success) throw validationError(parsed.error);
    const output = definition.output!.safeParse(await handler(parsed.data, context));
    if (!output.success) throw new CatalogError('unexpected', { details: { reason: 'output does not match the schema', operation: match.operation } });
    return json(200, output.data, requestId);
  } catch (error) {
    const response = errorResponse(error, requestId);
    logFailure(error, response);
    return json(response.status, response.body, requestId);
  }
}
