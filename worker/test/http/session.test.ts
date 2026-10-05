// Sign-in and sessions (#12): the code exchange in the Worker, the session in
// Workers KV, and the cookie the browser holds. Door43 is stubbed; `/user`
// answers with the recorded QA response for the test user.
import { readFileSync } from 'node:fs';
import { OPERATIONS, OperationErrorShape } from '@tc-admin/shared/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env, KVNamespace } from '../../src/env';
import worker from '../../src/index';

const recordedUser = JSON.parse(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-09-22/probe-write/01-user.json', import.meta.url), 'utf8')) as {
  response: { json: { id: number; login: string } };
};

const TOKEN = 'door43-token-value';
const SECRET = 'client-secret-value';
const ORIGIN = 'https://tc-admin-qa.unfoldingword.workers.dev';

class MemoryKV implements KVNamespace {
  readonly entries = new Map<string, string>();
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.entries.set(key, value);
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
}

let sessions: MemoryKV;
let door43Calls: { url: string; init: RequestInit | undefined }[];
let userStatus: number;

const env = (extra: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SESSIONS: sessions,
  PLANS: new MemoryKV(),
  DOOR43_ORIGIN: 'https://qa.door43.org',
  DOOR43_CLIENT_ID: 'client-id',
  DOOR43_CLIENT_SECRET: SECRET,
  ...extra,
});

const call = (path: string, init: RequestInit = {}, extra: Partial<Env> = {}, origin = ORIGIN) => worker.fetch(new Request(`${origin}${path}`, { redirect: 'manual', ...init }), env(extra));

/** Every `Set-Cookie` header, by cookie name. */
function cookies(response: Response): Map<string, string> {
  return new Map(response.headers.getSetCookie().map(line => [line.slice(0, line.indexOf('=')), line]));
}
const cookieValue = (line: string | undefined) => line?.slice(line.indexOf('=') + 1, line.indexOf(';'));

beforeEach(() => {
  sessions = new MemoryKV();
  door43Calls = [];
  userStatus = 200;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    door43Calls.push({ url, init });
    if (url === 'https://qa.door43.org/login/oauth/access_token') return Response.json({ access_token: TOKEN, expires_in: 3600 });
    if (url === 'https://qa.door43.org/api/v1/user') return userStatus === 200 ? Response.json(recordedUser.response.json) : new Response('', { status: userStatus });
    return new Response('', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Starts a sign-in and returns the OAuth state and the login cookie the browser was given. */
async function startLogin(extra: Partial<Env> = {}, origin = ORIGIN) {
  const response = await call('/auth/login', {}, extra, origin);
  const location = new URL(response.headers.get('location')!);
  return { response, location, state: location.searchParams.get('state')!, loginCookie: cookies(response).get('tca_login') };
}

/** A complete sign-in; returns the callback response and the session cookie value. */
async function signIn() {
  const { state } = await startLogin();
  const response = await call(`/auth/callback?code=the-code&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
  return { response, session: cookieValue(cookies(response).get('tca_session'))! };
}

describe('sign-in', () => {
  test('A1: /auth/login sends the browser to Door43 with exactly the four scopes (Q10, Q28) and PKCE, and binds the state to this browser', async () => {
    const { response, location, state, loginCookie } = await startLogin();
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe('https://qa.door43.org/login/oauth/authorize');
    expect(location.searchParams.getAll('scope')).toHaveLength(1);
    expect(location.searchParams.get('scope')!.split(' ').sort()).toEqual(['read:user', 'write:organization', 'write:repository', 'write:user']);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(location.searchParams.has('client_secret')).toBe(false);
    expect(cookieValue(loginCookie)).toBe(state);
    expect(loginCookie).toMatch(/HttpOnly/);
    expect(loginCookie).toMatch(/Secure/);
    expect(loginCookie).toMatch(/SameSite=Lax/);
    expect(loginCookie).toMatch(/Path=\/auth/);
  });

  test('A1: the callback exchanges the code server-side, stores the token in KV only, and sets an opaque HttpOnly session cookie', async () => {
    const { response, session } = await signIn();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    const line = cookies(response).get('tca_session')!;
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const exchange = door43Calls.find(entry => entry.url.endsWith('/login/oauth/access_token'))!;
    expect(new URLSearchParams(String(exchange.init?.body)).get('client_secret')).toBe(SECRET);
    // The store holds the token under a hash of the cookie, never under the cookie itself.
    const keys = [...sessions.entries.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^session:[0-9a-f]{64}$/);
    expect(keys[0]).not.toContain(session);
    expect(JSON.parse(sessions.entries.get(keys[0]!)!)).toMatchObject({ token: TOKEN, account: { login: 'tc-admin-qa', name: 'tc-admin-qa' }, userId: recordedUser.response.json.id });
  });

  test('situation.read names the signed-in account, read from Door43 /user', async () => {
    const { session } = await signIn();
    const response = await call('/api/situation', { headers: { cookie: `tca_session=${session}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account: { login: 'tc-admin-qa', name: 'tc-admin-qa' }, configured: true });
  });

  test('A1: no response, header, redirect, or log line of a sign-in and a session carries the token or the client secret', async () => {
    const logged: unknown[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => logged.push(...args));
    const seen: string[] = [];
    const record = async (response: Response) => {
      seen.push(JSON.stringify([...response.headers]), await response.text());
    };
    const { response: login, state } = await startLogin();
    await record(login);
    const { response: callback, session } = await signIn();
    await record(callback);
    await record(await call('/api/situation', { headers: { cookie: `tca_session=${session}` } }));
    userStatus = 401;
    await record(await call('/api/situation', { headers: { cookie: `tca_session=${session}` } }));
    userStatus = 500;
    const { state: failing } = await startLogin();
    await record(await call(`/auth/callback?code=c&state=${failing}`, { headers: { cookie: `tca_login=${failing}` } }));
    const everything = seen.join('\n') + JSON.stringify(logged);
    expect(state).toBeTruthy();
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(SECRET);
  });

  test('portfolio.list reads the signed-in account\'s repository search with the session\'s token', async () => {
    const { session } = await signIn();
    door43Calls = [];
    const stubbed = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!url.startsWith('https://qa.door43.org/api/v1/repos/search')) return stubbed(url, init);
      door43Calls.push({ url, init });
      const page = new URL(url).searchParams.get('page');
      const data = page === '1' ? [{ id: 1, name: 'en_obs', full_name: 'team/en_obs', owner: { login: 'team' }, metadata_type: 'sb', flavor: 'textStories', permissions: { push: true } }] : [];
      return Response.json({ ok: true, data });
    });
    const response = await call('/api/portfolio', { headers: { cookie: `tca_session=${session}` } });
    expect(response.status).toBe(200);
    const body = OPERATIONS['portfolio.list'].output.parse(await response.json());
    expect(body.organizations).toMatchObject([{ name: 'team', projects: [{ ref: { repo: 'en_obs' }, editability: { state: 'editable' } }] }]);
    const search = new URL(door43Calls.find(entry => entry.url.includes('/repos/search'))!.url);
    expect(search.searchParams.get('uid')).toBe(String(recordedUser.response.json.id));
    expect(new Headers(door43Calls.at(-1)!.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  test('A3: every Door43 request a session makes carries its bearer token and no other credential', async () => {
    const { session } = await signIn();
    door43Calls = [];
    await call('/api/situation', { headers: { cookie: `tca_session=${session}` } });
    expect(door43Calls.length).toBeGreaterThan(0);
    for (const { url, init } of door43Calls) {
      expect(new URL(url).origin).toBe('https://qa.door43.org');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(headers.has('cookie')).toBe(false);
      expect(String(init?.body ?? '')).not.toContain(SECRET);
      expect(url).not.toContain(TOKEN);
    }
  });

  test('a callback without this browser\'s login cookie, or a replayed one, starts over with session_expired', async () => {
    const { state } = await startLogin();
    const foreign = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: 'tca_login=someone-else' } });
    expect(foreign.headers.get('location')).toBe('/?sign_in=session_expired');
    const first = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(first.headers.get('location')).toBe('/');
    const replay = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(replay.headers.get('location')).toBe('/?sign_in=session_expired');
    expect(cookies(replay).has('tca_session')).toBe(false);
  });

  test('a sign-in older than ten minutes starts over', async () => {
    const { state } = await startLogin();
    const key = `login:${state}`;
    sessions.entries.set(key, JSON.stringify({ ...JSON.parse(sessions.entries.get(key)!), createdAt: Date.now() - 601_000 }));
    const response = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(response.headers.get('location')).toBe('/?sign_in=session_expired');
  });

  test('declining on Door43 returns to the app with no session and no error', async () => {
    const { state } = await startLogin();
    const response = await call(`/auth/callback?error=access_denied&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(response.headers.get('location')).toBe('/');
    expect(cookies(response).has('tca_session')).toBe(false);
    expect(door43Calls.some(entry => entry.url.endsWith('/access_token'))).toBe(false);
  });

  test('Door43 unreachable during the exchange returns door43_unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { state } = await startLogin();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network');
    });
    const response = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(response.headers.get('location')).toBe('/?sign_in=door43_unavailable');
    expect(sessions.entries.size).toBe(0);
  });

  test('sign-in is refused, not attempted, when no client id is configured', async () => {
    const response = await call('/auth/login', {}, { DOOR43_CLIENT_ID: '' });
    expect(response.headers.get('location')).toBe('/?sign_in=door43_unavailable');
    expect(sessions.entries.size).toBe(0);
  });

  test('plain-HTTP local development gets cookies without Secure', async () => {
    const { loginCookie } = await startLogin({}, 'http://127.0.0.1:8787');
    expect(loginCookie).not.toMatch(/Secure/);
    expect(loginCookie).toMatch(/HttpOnly/);
  });
});

describe('session end', () => {
  test('A1: a token Door43 refuses ends the session: session_expired, the KV record removed, the cookie cleared', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { session } = await signIn();
    userStatus = 401;
    const response = await call('/api/situation', { headers: { cookie: `tca_session=${session}` } });
    expect(response.status).toBe(401);
    expect(OperationErrorShape.parse(await response.json()).code).toBe('session_expired');
    expect(sessions.entries.size).toBe(0);
    expect(cookies(response).get('tca_session')).toMatch(/Max-Age=0/);
  });

  test('A1: an expired session is removed and reads as no one signed in', async () => {
    const { session } = await signIn();
    const [key] = [...sessions.entries.keys()];
    sessions.entries.set(key!, JSON.stringify({ ...JSON.parse(sessions.entries.get(key!)!), expiresAt: Date.now() - 1 }));
    door43Calls = [];
    const response = await call('/api/situation', { headers: { cookie: `tca_session=${session}` } });
    expect(await response.json()).toMatchObject({ account: null });
    expect(door43Calls).toHaveLength(0);
    expect(sessions.entries.size).toBe(0);
    expect(cookies(response).get('tca_session')).toMatch(/Max-Age=0/);
  });

  test('A1: logout removes the session and its token from KV and clears the cookie', async () => {
    const { session } = await signIn();
    const response = await call('/auth/logout', { method: 'POST', headers: { cookie: `tca_session=${session}` } });
    expect(response.status).toBe(204);
    expect(sessions.entries.size).toBe(0);
    expect(cookies(response).get('tca_session')).toMatch(/Max-Age=0/);
    expect(await (await call('/api/situation', { headers: { cookie: `tca_session=${session}` } })).json()).toMatchObject({ account: null });
  });

  test('signing in again replaces the earlier session', async () => {
    const { session: first } = await signIn();
    const { state } = await startLogin();
    await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}; tca_session=${first}` } });
    expect([...sessions.entries.keys()].filter(key => key.startsWith('session:'))).toHaveLength(1);
    expect(await (await call('/api/situation', { headers: { cookie: `tca_session=${first}` } })).json()).toMatchObject({ account: null });
  });
});

describe('sign-in failures are named for what failed', () => {
  /** A store whose `put` fails for keys with this prefix. */
  const failingPut = (prefix: string) => {
    const put = sessions.put.bind(sessions);
    sessions.put = async (key: string, value: string) => {
      if (key.startsWith(prefix)) throw new Error('store unavailable');
      return put(key, value);
    };
  };
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  test('X2: Door43 refusing the code is session_expired', async () => {
    quiet();
    const { state } = await startLogin();
    vi.stubGlobal('fetch', async () => new Response('', { status: 400 }));
    const response = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(response.headers.get('location')).toBe('/?sign_in=session_expired');
  });

  test('X2: Door43 refusing the new token at /user is session_expired', async () => {
    quiet();
    userStatus = 401;
    const { state } = await startLogin();
    const response = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(response.headers.get('location')).toBe('/?sign_in=session_expired');
  });

  test('X2: the session store failing after Door43 accepted the sign-in is unexpected, with the reference the message quotes, never session_expired', async () => {
    const log = quiet();
    const { state } = await startLogin();
    failingPut('session:');
    const response = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!, ORIGIN);
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('sign_in')).toBe('unexpected');
    const reference = location.searchParams.get('reference');
    expect(reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('x-request-id')).toBe(reference);
    expect(cookies(response).has('tca_session')).toBe(false);
    const line = JSON.parse(String(log.mock.calls.at(-1)![0]));
    expect(line).toMatchObject({ request_id: reference, code: 'unexpected' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  test('X2: the session store failing at /auth/login is answered, not a crash: back to the app with unexpected', async () => {
    quiet();
    failingPut('login:');
    const response = await call('/auth/login');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^\/\?sign_in=unexpected&reference=[0-9a-f-]{36}$/);
  });

  test('X2: a corrupt pending sign-in is unexpected, not a crash', async () => {
    quiet();
    const { state } = await startLogin();
    sessions.entries.set(`login:${state}`, '{not json');
    const response = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
    expect(response.headers.get('location')).toMatch(/^\/\?sign_in=unexpected&reference=/);
  });

  test('X2: the store failing at /auth/logout answers with the catalog error shape and a request id', async () => {
    quiet();
    const { session } = await signIn();
    sessions.delete = async () => {
      throw new Error('store unavailable');
    };
    const response = await call('/auth/logout', { method: 'POST', headers: { cookie: `tca_session=${session}` } });
    expect(response.status).toBe(500);
    const body = OperationErrorShape.parse(await response.json());
    expect(body.code).toBe('unexpected');
    expect(response.headers.get('x-request-id')).toBe(body.request_id);
    expect(cookies(response).get('tca_session')).toMatch(/Max-Age=0/);
  });

  test('A1: the store failing while an expired session is removed still clears the cookie', async () => {
    quiet();
    const { session } = await signIn();
    const [key] = [...sessions.entries.keys()];
    sessions.entries.set(key!, JSON.stringify({ ...JSON.parse(sessions.entries.get(key!)!), expiresAt: Date.now() - 1 }));
    sessions.delete = async () => {
      throw new Error('store unavailable');
    };
    const response = await call('/api/situation', { headers: { cookie: `tca_session=${session}` } });
    expect(OperationErrorShape.parse(await response.json()).code).toBe('unexpected');
    expect(cookies(response).get('tca_session')).toMatch(/Max-Age=0/);
  });

  test('A1: the store failing while a refused token ends the session still answers session_expired and clears the cookie', async () => {
    quiet();
    const { session } = await signIn();
    userStatus = 401;
    sessions.delete = async () => {
      throw new Error('store unavailable');
    };
    const response = await call('/api/situation', { headers: { cookie: `tca_session=${session}` } });
    expect(OperationErrorShape.parse(await response.json()).code).toBe('session_expired');
    expect(cookies(response).get('tca_session')).toMatch(/Max-Age=0/);
  });

  test('sign-in responses are not cached and send no referrer', async () => {
    const { response } = await startLogin();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('stored sessions', () => {
  test('A1: a session record that does not parse is no session: removed, the cookie cleared, and the API still answers', async () => {
    const { session } = await signIn();
    const [key] = [...sessions.entries.keys()];
    sessions.entries.set(key!, '{not json');
    const response = await call('/api/situation', { headers: { cookie: `tca_session=${session}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account: null });
    expect(sessions.entries.size).toBe(0);
    expect(cookies(response).get('tca_session')).toMatch(/Max-Age=0/);
  });
});
