// A4 (#13): every browser mutation is same-origin and carries the session's
// CSRF token; a request that fails either check is `csrf_rejected` and the
// operation never runs. Door43 is stubbed as in session.test.ts.
import { readFileSync } from 'node:fs';
import { CSRF_HEADER, OperationErrorShape } from '@tc-admin/shared/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env, KVNamespace } from '../../src/env';
import { sameString } from '../../src/http/csrf';
import worker from '../../src/index';
import { HANDLERS } from '../../src/operations';

const recordedUser = JSON.parse(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-09-22/probe-write/01-user.json', import.meta.url), 'utf8')) as {
  response: { json: { id: number; login: string } };
};

const TOKEN = 'door43-token-value';
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
  async list(options: { prefix: string }) {
    return { keys: [...this.entries.keys()].filter(name => name.startsWith(options.prefix)).map(name => ({ name })), list_complete: true };
  }
}

let sessions: MemoryKV;
let door43Calls: string[];
const applied: unknown[] = [];
/** The real apply, if built, restored after each test. */
const built = HANDLERS['project.create.apply'];

const env = (): Env => ({
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SESSIONS: sessions,
  PLANS: new MemoryKV(),
  DOOR43_ORIGIN: 'https://qa.door43.org',
  DOOR43_CLIENT_ID: 'client-id',
});

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }), env());

/** A signed-in browser: its session cookie and the CSRF token the Worker issued it. */
async function signIn(): Promise<{ cookie: string; csrf: string }> {
  const login = await call('/auth/login');
  const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
  const callback = await call(`/auth/callback?code=the-code&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
  const line = callback.headers.getSetCookie().find(entry => entry.startsWith('tca_session='))!;
  const cookie = line.slice(0, line.indexOf(';'));
  const situation = await call('/api/situation', { headers: { cookie } });
  return { cookie, csrf: situation.headers.get(CSRF_HEADER)! };
}

/** A `POST` of an apply, as a browser would send it, with whatever headers the case leaves out or changes. */
const apply = (headers: Record<string, string>) =>
  call('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ plan_id: 'p1' }) });

const rejected = async (response: Response) => {
  expect(response.status).toBe(403);
  const body = OperationErrorShape.parse(await response.json());
  expect(body).toMatchObject({ code: 'csrf_rejected', retryable: false, next_action: 'reload', invariant: 'A4' });
  expect(body.message).toBe('This request could not be verified. Reload and try again.');
  return body;
};

beforeEach(() => {
  sessions = new MemoryKV();
  door43Calls = [];
  applied.length = 0;
  HANDLERS['project.create.apply'] = (async (input: unknown) => {
    applied.push(input);
    return { not: 'a receipt' };
  }) as never;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (url: string) => {
    door43Calls.push(url);
    if (url === 'https://qa.door43.org/login/oauth/access_token') return Response.json({ access_token: TOKEN, expires_in: 3600 });
    if (url === 'https://qa.door43.org/api/v1/user') return Response.json(recordedUser.response.json);
    return new Response('', { status: 404 });
  });
});

afterEach(() => {
  if (built) HANDLERS['project.create.apply'] = built;
  else delete HANDLERS['project.create.apply'];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the token', () => {
  test('A4: a signed-in browser is issued its token on every API response, and no one else is', async () => {
    const anonymous = await call('/api/situation');
    expect(anonymous.headers.has(CSRF_HEADER)).toBe(false);
    const { cookie, csrf } = await signIn();
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const again = await call('/api/portfolio', { headers: { cookie } });
    expect(again.headers.get(CSRF_HEADER)).toBe(csrf);
  });

  test('A1: the token is neither the session cookie nor the Door43 token, and is in no response body', async () => {
    const { cookie, csrf } = await signIn();
    expect(cookie).not.toContain(csrf);
    expect(csrf).not.toBe(TOKEN);
    const body = await (await call('/api/situation', { headers: { cookie } })).text();
    expect(body).not.toContain(csrf);
    expect(body).not.toContain(TOKEN);
  });

  test('A4: a request a browser marks cross-site is never issued the token; same-site, same-origin, and non-browser requests are', async () => {
    const { cookie } = await signIn();
    for (const [site, issued] of [['cross-site', false], ['same-site', false], ['same-origin', true], ['none', true]] as const) {
      const response = await call('/api/situation', { headers: { cookie, 'sec-fetch-site': site } });
      expect(response.status, site).toBe(200);
      expect(response.headers.has(CSRF_HEADER), site).toBe(issued);
    }
    expect((await call('/api/situation', { headers: { cookie } })).headers.has(CSRF_HEADER)).toBe(true);
  });

  test('two sign-ins get two tokens', async () => {
    const first = await signIn();
    const second = await signIn();
    expect(first.csrf).not.toBe(second.csrf);
  });

  test('sameString compares whole strings', () => {
    expect(sameString('abc', 'abc')).toBe(true);
    expect(sameString('abc', 'abd')).toBe(false);
    expect(sameString('abc', 'ab')).toBe(false);
    expect(sameString('', '')).toBe(true);
  });
});

describe('a browser mutation', () => {
  test('A4: a POST without an Origin header is csrf_rejected and the operation does not run', async () => {
    const { cookie, csrf } = await signIn();
    door43Calls = [];
    const body = await rejected(await apply({ cookie, [CSRF_HEADER]: csrf }));
    expect(body.details).toEqual({ reason: 'no origin' });
    expect(applied).toEqual([]);
    expect(door43Calls).toEqual([]);
  });

  test('A4: a POST from a foreign origin is csrf_rejected and the operation does not run', async () => {
    const { cookie, csrf } = await signIn();
    door43Calls = [];
    for (const origin of ['https://evil.example', 'null', 'https://tc-admin.unfoldingword.workers.dev', 'http://tc-admin-qa.unfoldingword.workers.dev']) {
      const body = await rejected(await apply({ cookie, origin, [CSRF_HEADER]: csrf }));
      expect(body.details).toEqual({ reason: 'foreign origin' });
    }
    expect(applied).toEqual([]);
    expect(door43Calls).toEqual([]);
  });

  test('A4: a same-origin POST without the token is csrf_rejected and the operation does not run', async () => {
    const { cookie } = await signIn();
    door43Calls = [];
    const body = await rejected(await apply({ cookie, origin: ORIGIN }));
    expect(body.details).toEqual({ reason: 'no token' });
    expect(applied).toEqual([]);
    expect(door43Calls).toEqual([]);
  });

  test('A4: a same-origin POST with the wrong token is csrf_rejected, the operation does not run, and the log does not carry the tokens', async () => {
    const { cookie, csrf } = await signIn();
    const other = await signIn();
    door43Calls = [];
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const wrong of ['nonsense', other.csrf, csrf.slice(0, -1), `${csrf}x`, '']) {
      const body = await rejected(await apply({ cookie, origin: ORIGIN, [CSRF_HEADER]: wrong }));
      expect(body.details).toEqual({ reason: 'wrong token' });
    }
    expect(applied).toEqual([]);
    expect(door43Calls).toEqual([]);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(csrf);
    expect(logged).not.toContain(other.csrf);
    expect(logged).not.toContain(TOKEN);
  });

  test('A4: a same-origin POST with the session\'s token reaches the operation', async () => {
    const { cookie, csrf } = await signIn();
    const response = await apply({ cookie, origin: ORIGIN, [CSRF_HEADER]: csrf });
    // The stand-in answers outside the schema, which is `unexpected`; what matters is that it ran.
    expect(response.status).toBe(500);
    expect(applied).toEqual([{ plan_id: 'p1' }]);
  });

  test('a same-origin POST without a session passes to the operation, whose own session check answers', async () => {
    const response = await apply({ origin: ORIGIN });
    expect(response.status).toBe(500);
    expect(applied).toEqual([{ plan_id: 'p1' }]);
  });

  test('a POST without a session from a foreign origin is still csrf_rejected', async () => {
    await rejected(await apply({ origin: 'https://evil.example' }));
    expect(applied).toEqual([]);
  });

  test('reads need neither an Origin nor the token', async () => {
    const { cookie } = await signIn();
    expect((await call('/api/situation', { headers: { cookie } })).status).toBe(200);
    expect((await call('/api/situation')).status).toBe(200);
  });
});

describe('logout', () => {
  const logout = (headers: Record<string, string>) => call('/auth/logout', { method: 'POST', headers });

  test('A4: signing out needs the same origin and the token; a foreign or tokenless request is csrf_rejected and the session stays', async () => {
    const { cookie, csrf } = await signIn();
    await rejected(await logout({ cookie, [CSRF_HEADER]: csrf }));
    await rejected(await logout({ cookie, origin: 'https://evil.example', [CSRF_HEADER]: csrf }));
    await rejected(await logout({ cookie, origin: ORIGIN }));
    expect([...sessions.entries.keys()].filter(key => key.startsWith('session:'))).toHaveLength(1);
    const response = await logout({ cookie, origin: ORIGIN, [CSRF_HEADER]: csrf });
    expect(response.status).toBe(204);
    expect([...sessions.entries.keys()].filter(key => key.startsWith('session:'))).toHaveLength(0);
  });

  test('signing out with no session needs no token and answers 204 from the Worker\'s origin, csrf_rejected from another', async () => {
    expect((await logout({ origin: ORIGIN })).status).toBe(204);
    await rejected(await logout({ origin: 'https://evil.example' }));
  });
});

describe('stored sessions', () => {
  test('A4: a session record without a CSRF token is no session', async () => {
    const { cookie } = await signIn();
    const [key] = [...sessions.entries.keys()].filter(entry => entry.startsWith('session:'));
    const { csrf: _csrf, ...rest } = JSON.parse(sessions.entries.get(key!)!) as Record<string, unknown>;
    sessions.entries.set(key!, JSON.stringify(rest));
    const response = await call('/api/situation', { headers: { cookie } });
    expect(await response.json()).toMatchObject({ account: null });
    expect(response.headers.has(CSRF_HEADER)).toBe(false);
  });
});
