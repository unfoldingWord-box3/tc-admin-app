// The HTTP projection of the operation catalog (operations.md §7), on Hono:
// one route per operation, generated from `shared/schema`. Each request's
// input is validated against the operation's schema, the operation runs, its
// output is validated, and the answer is the output or the error shape (X2).
// A route that takes file bytes reads a multipart body (multipart.ts, Q33).
// Sign-in is `/auth/` (session.ts); every `/api/` request carries the session
// its cookie names, if any, and every `POST` passes the same-origin and CSRF
// token checks first (csrf.ts, A4). Everything else is the built web app.

import { CSRF_HEADER, CatalogError, OPERATIONS, OPERATION_NAMES } from '@tc-admin/shared/schema';
import type { OperationDefinition, Route, RoutedOperation } from '@tc-admin/shared/schema';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { Env } from '../env';
import { HANDLERS, operationContext } from '../operations';
import type { OperationContext } from '../operations';
import { csrf } from './csrf';
import { errorResponse, logFailure } from './errors';
import { checkIdempotencyKey } from './idempotency';
import { readMultipartInput } from './multipart';
import { auth, endSession, readSession, signInFailed } from './session';
import type { ActiveSession } from './session';

export type App = { Bindings: Env; Variables: { requestId: string; session: ActiveSession | null } };

const HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

function answer(c: Context<App>, status: number, body: unknown): Response {
  return c.json(body, status as 200, { ...HEADERS, 'x-request-id': c.get('requestId') ?? '' });
}

/** `{name}` in a catalog route is `:name` in Hono. */
export const honoPath = (path: string) => path.replace(/\{([a-z_]+)\}/g, ':$1');

async function readInput(c: Context<App>, route: Route): Promise<Record<string, unknown>> {
  const params = c.req.param() as Record<string, string>;
  if (c.req.method === 'GET') return { ...c.req.query(), ...params };
  // An operation that takes file bytes reads them from a multipart body (Q33); every other POST from JSON.
  if (route.body === 'multipart') return { ...(await readMultipartInput(c)), ...params };
  const text = await c.req.text();
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

async function runOperation(c: Context<App>, name: RoutedOperation): Promise<Response> {
  const context: OperationContext = operationContext(
    { door43Origin: c.env.DOOR43_ORIGIN, door43ClientId: c.env.DOOR43_CLIENT_ID },
    c.get('requestId'),
    c.get('session')?.record.token ?? null,
    c.env.PLANS,
  );
  const handler = HANDLERS[name] as ((input: unknown, context: OperationContext) => Promise<unknown>) | undefined;
  // Until every Milestone 1 operation is built, an unbuilt one answers as no operation (Q26).
  if (!handler) throw new CatalogError('unknown_operation', { details: { reason: 'operation not built yet', operation: name } });
  const definition: OperationDefinition = OPERATIONS[name];
  const parsed = definition.input!.safeParse(await readInput(c, definition.route!));
  if (!parsed.success) throw validationError(parsed.error);
  checkIdempotencyKey(c, parsed.data as Record<string, unknown>);
  const output = definition.output!.safeParse(await handler(parsed.data, context));
  if (!output.success) throw new CatalogError('unexpected', { details: { reason: 'output does not match the schema', operation: name } });
  return answer(c, 200, output.data);
}

export const app = new Hono<App>();

// Every request the Worker answers itself carries a request id (X2); sign-in routes too.
app.use('/auth/*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.set('session', null);
  await next();
});

// Logout is the one mutation under `/auth/`: it ends the session the request carries (A4).
app.use('/auth/logout', async (c, next) => {
  c.set('session', await readSession(c));
  await next();
});
app.use('/auth/logout', csrf);

/**
 * A request a browser marks as its own site, or one no browser sent. Browsers send
 * `Sec-Fetch-Site` on every request; a cross-site one is never issued the token, so a
 * CORS rule added later could not hand it to another site's script (A4).
 */
function sameSite(site: string | undefined): boolean {
  return site === undefined || site === 'same-origin' || site === 'none';
}

app.use('/api/*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  const session = await readSession(c);
  c.set('session', session);
  // The signed-in browser learns its CSRF token from any same-site API response (A4); it is never in a cookie or a body.
  if (session && sameSite(c.req.header('sec-fetch-site'))) c.header(CSRF_HEADER, session.record.csrf);
  await next();
});
app.use('/api/*', csrf);

app.route('/auth', auth);

for (const name of OPERATION_NAMES) {
  const route = (OPERATIONS[name] as OperationDefinition).route;
  if (route) app.on(route.method, honoPath(route.path), c => runOperation(c, name as RoutedOperation));
}

// An `/api/` address that is no operation, or an operation with another method (Q26).
app.all('/api/*', () => {
  throw new CatalogError('unknown_operation', { details: { reason: 'no operation at this route' } });
});

app.all('*', c => c.env.ASSETS.fetch(c.req.raw));

app.onError(async (error, c) => {
  if (!c.get('requestId')) c.set('requestId', crypto.randomUUID());
  const response = errorResponse(error, c.get('requestId'));
  logFailure(error, response);
  // Door43 refused the session's token: the session is over here too (architecture §3).
  const session = c.get('session');
  if (response.body.code === 'session_expired' && session) {
    try {
      await endSession(c, session.key);
    } catch (cause) {
      logFailure(cause, errorResponse(cause, c.get('requestId')));
    }
  }
  // The browser follows sign-in routes: it goes back to the app, which shows the catalog message.
  if (c.req.method === 'GET' && new URL(c.req.url).pathname.startsWith('/auth/')) return signInFailed(c, response.body.code, response.body.request_id);
  return answer(c, response.status, response.body);
});
