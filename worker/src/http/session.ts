// Sign-in and sessions (ADR 0001, architecture §3 Authentication). The Door43
// token lives only in Workers KV under a hash of the session id; the browser
// holds the opaque id in an HttpOnly cookie and nothing else (A1). The routes
// sit under `/auth/`, outside the catalog, because the browser follows them:
// `/auth/login` sends it to Door43, `/auth/callback` exchanges the code and
// starts the session, `/auth/logout` ends it. A failed sign-in returns to the
// app with a catalog code in `?sign_in=`, never with Door43's own text:
// `session_expired` only when Door43 refused the code or the token, or the
// sign-in did not start in this browser in the last ten minutes;
// `door43_unavailable` when Door43 could not be reached or answered
// unreadably; `unexpected` with `&reference=<request id>` for anything else,
// such as the session store failing (app.ts error handler).

import { CatalogError } from '@tc-admin/shared/schema';
import type { ErrorCode } from '@tc-admin/shared/schema';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env, KVNamespace } from '../env';
import { beginSignIn, completeSignIn, newSessionId } from '../operations/sign-in';
import type { PendingSignIn, SessionRecord, SignInConfig } from '../operations/sign-in';
import type { App } from './app';
import { errorResponse, logFailure } from './errors';

const SESSION_COOKIE = 'tca_session';
/** Binds the callback to the browser that started the sign-in: it holds the OAuth `state`. */
const LOGIN_COOKIE = 'tca_login';
/** A sign-in not completed in ten minutes starts over (carried over from the prototype). */
const LOGIN_SECONDS = 600;
/** Workers KV refuses an expiration sooner than a minute ahead. */
const MIN_KV_TTL = 60;

export interface ActiveSession {
  /** The KV key: a hash of the cookie value, so the store never holds a usable cookie. */
  key: string;
  record: SessionRecord;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const sessionKey = async (id: string) => `session:${await sha256(id)}`;
const loginKey = (state: string) => `login:${state}`;
const ttl = (expiresAt: number, now: number) => Math.max(MIN_KV_TTL, Math.ceil((expiresAt - now) / 1000));

/** Secure everywhere but plain-HTTP local development (`wrangler dev` on 127.0.0.1). */
const secure = (c: Context<App>) => new URL(c.req.url).protocol === 'https:';

const signInConfig = (env: Env): SignInConfig => ({ door43Origin: env.DOOR43_ORIGIN, clientId: env.DOOR43_CLIENT_ID, clientSecret: env.DOOR43_CLIENT_SECRET });

/** The session the request's cookie names, or `null` when there is none or it has expired. */
export async function readSession(c: Context<App>, now = Date.now()): Promise<ActiveSession | null> {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return null;
  const key = await sessionKey(id);
  const record = parseRecord(await c.env.SESSIONS.get(key));
  if (!record || record.expiresAt <= now) {
    await endSession(c, key);
    return null;
  }
  return { key, record };
}

/** A stored record that does not parse, or lacks a token or an expiry, is no session. */
function parseRecord(stored: string | null): SessionRecord | null {
  if (!stored) return null;
  try {
    const record = JSON.parse(stored) as Partial<SessionRecord> | null;
    return typeof record?.token === 'string' && typeof record.expiresAt === 'number' && record.account ? (record as SessionRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Removes the session and its credential from the store and the cookie from the browser.
 * The cookie is cleared even when the store fails, so the browser stops sending a dead
 * session; the failure still propagates, and the record expires on its own TTL.
 */
export async function endSession(c: Context<App>, key: string | null): Promise<void> {
  try {
    if (key) await c.env.SESSIONS.delete(key);
  } finally {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secure(c) });
  }
}

const backToApp = (c: Context<App>, failure?: ErrorCode) => c.redirect(failure ? `/?sign_in=${failure}` : '/', 302);

/** Back to the app after a failure the error handler caught: the code, and the request id the message quotes. */
export function signInFailed(c: Context<App>, code: ErrorCode, requestId: string): Response {
  c.header('x-request-id', requestId);
  c.header('cache-control', 'no-store');
  return code === 'unexpected' ? c.redirect(`/?sign_in=unexpected&reference=${encodeURIComponent(requestId)}`, 302) : backToApp(c, code);
}

/** The failures a callback reports as such; anything else is `unexpected`. */
const REPORTED: readonly ErrorCode[] = ['session_expired', 'door43_unavailable'];

async function takePending(store: KVNamespace, state: string): Promise<PendingSignIn | null> {
  const stored = await store.get(loginKey(state));
  if (!stored) return null;
  await store.delete(loginKey(state));
  return JSON.parse(stored) as PendingSignIn;
}

export const auth = new Hono<App>();

auth.use('*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'no-referrer');
});

auth.get('/login', async c => {
  const pending = await beginSignIn(signInConfig(c.env), `${new URL(c.req.url).origin}/auth/callback`);
  if (!pending) return backToApp(c, 'door43_unavailable');
  await c.env.SESSIONS.put(loginKey(pending.state), JSON.stringify(pending), { expirationTtl: LOGIN_SECONDS });
  setCookie(c, LOGIN_COOKIE, pending.state, { path: '/auth', httpOnly: true, secure: secure(c), sameSite: 'Lax', maxAge: LOGIN_SECONDS });
  return c.redirect(pending.url, 302);
});

auth.get('/callback', async c => {
  const state = c.req.query('state');
  const bound = getCookie(c, LOGIN_COOKIE);
  deleteCookie(c, LOGIN_COOKIE, { path: '/auth', secure: secure(c) });
  // A callback from another browser, a replay, or a sign-in older than ten minutes starts over.
  if (!state || state !== bound) return backToApp(c, 'session_expired');
  const pending = await takePending(c.env.SESSIONS, state);
  if (!pending || Date.now() - pending.createdAt > LOGIN_SECONDS * 1000) return backToApp(c, 'session_expired');
  const code = c.req.query('code');
  // The manager declined on Door43: nothing failed, nothing to report.
  if (c.req.query('error') || !code) return backToApp(c);
  try {
    const record = await completeSignIn(signInConfig(c.env), pending, code);
    const previous = getCookie(c, SESSION_COOKIE);
    if (previous) await c.env.SESSIONS.delete(await sessionKey(previous));
    const id = newSessionId();
    const now = Date.now();
    await c.env.SESSIONS.put(await sessionKey(id), JSON.stringify(record), { expirationTtl: ttl(record.expiresAt, now) });
    setCookie(c, SESSION_COOKIE, id, { path: '/', httpOnly: true, secure: secure(c), sameSite: 'Lax', maxAge: ttl(record.expiresAt, now) });
    return backToApp(c);
  } catch (error) {
    // A Door43 refusal or outage is reported as such; a failure of tC Admin's own goes to the error handler as `unexpected`.
    if (!(error instanceof CatalogError) || !REPORTED.includes(error.code)) throw error;
    logFailure(error, errorResponse(error, c.get('requestId')));
    return backToApp(c, error.code);
  }
});

auth.post('/logout', async c => {
  const id = getCookie(c, SESSION_COOKIE);
  await endSession(c, id ? await sessionKey(id) : null);
  return c.body(null, 204);
});
