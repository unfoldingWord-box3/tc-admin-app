// Same-origin and CSRF-token checks ahead of every browser mutation (A4,
// architecture §8). A `POST` is refused unless its `Origin` header is the
// Worker's own origin, and, when the request carries a session, unless it
// also carries that session's token in the `x-csrf-token` header. The token
// is a random value made at sign-in and held in the session record
// (`operations/sign-in.ts`); the Worker issues it to the signed-in browser in
// the `x-csrf-token` header of every `/api/` response, so the browser holds it
// in memory only, never in storage (A1). Reads need neither check. A request
// without a session passes the token check: there is no session a cross-site
// request could use, and the operation's own session check answers
// `session_expired`.

import { CSRF_HEADER, CatalogError } from '@tc-admin/shared/schema';
import type { MiddlewareHandler } from 'hono';
import type { App } from './app';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Compares two strings in time independent of where they differ. */
export function sameString(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}

export const csrf: MiddlewareHandler<App> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header('origin');
  if (origin === undefined) throw new CatalogError('csrf_rejected', { details: { reason: 'no origin' } });
  if (origin !== new URL(c.req.url).origin) throw new CatalogError('csrf_rejected', { details: { reason: 'foreign origin' } });
  const session = c.get('session');
  if (session) {
    const token = c.req.header(CSRF_HEADER);
    if (token === undefined) throw new CatalogError('csrf_rejected', { details: { reason: 'no token' } });
    if (!sameString(token, session.record.csrf)) throw new CatalogError('csrf_rejected', { details: { reason: 'wrong token' } });
  }
  await next();
};
