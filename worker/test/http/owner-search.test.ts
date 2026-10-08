// `GET /api/owners` is `owner.search` (operations.md §7): the search comes from
// the query string, the session's token reads Door43, and the answer is the
// catalog shape. Door43 is stubbed with the recordings of E35 and E43.
import { readFileSync } from 'node:fs';
import { OPERATIONS, OperationErrorShape } from '@tc-admin/shared/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env, KVNamespace } from '../../src/env';
import worker from '../../src/index';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, fixtures), 'utf8'));
const user = (read('2026-10-05/user/user.json') as { response: { json: unknown } }).response.json;
const organizations = (read('2026-10-05/user/user__orgs.json') as { response: { json: unknown[] } }).response.json;
const unfold = read('2026-10-01/catalog/list__owners__unfold__partialMatch.json');

const TOKEN = 'door43-token-value';
const ORIGIN = 'https://tc-admin.test';

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
const env = (): Env => ({
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SESSIONS: sessions,
  PLANS: new MemoryKV(),
  DOOR43_ORIGIN: 'https://qa.door43.org',
  DOOR43_CLIENT_ID: 'client-id',
  DOOR43_CLIENT_SECRET: 'client-secret-value',
});
const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }), env());

beforeEach(() => {
  sessions = new MemoryKV();
  door43Calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    door43Calls.push({ url, init });
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/login/oauth/access_token') return Response.json({ access_token: TOKEN, expires_in: 3600 });
    if (pathname === '/api/v1/user') return Response.json(user);
    if (pathname === '/api/v1/user/orgs') return Response.json(searchParams.get('page') === '1' ? organizations : []);
    if (pathname === '/api/v1/catalog/list/owners') return Response.json(searchParams.get('owner') === 'unfold' ? unfold : { ok: true, data: [] });
    return new Response('', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A complete sign-in, as the browser makes it; returns the session cookie value. */
async function signIn(): Promise<string> {
  const login = await call('/auth/login');
  const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
  const callback = await call(`/auth/callback?code=the-code&state=${state}`, { headers: { cookie: `tca_login=${state}` } });
  const line = callback.headers.getSetCookie().find(cookie => cookie.startsWith('tca_session='))!;
  return line.slice(line.indexOf('=') + 1, line.indexOf(';'));
}

describe('GET /api/owners', () => {
  test('E35: the search in the query string reaches the catalog with the session\'s token; the account\'s organizations come first, with the read\'s freshness (P3)', async () => {
    const session = await signIn();
    door43Calls = [];
    const response = await call('/api/owners?q=unfold', { headers: { cookie: `tca_session=${session}` } });
    expect(response.status).toBe(200);
    const body = OPERATIONS['owner.search'].output.parse(await response.json());
    expect(body.own).toEqual([{ login: 'tc-admin-qa-org', name: 'tc-admin-qa-org' }]);
    expect(body.matches).toEqual([{ login: 'unfoldingWord', name: 'unfoldingWord®' }]);
    expect(body.freshness.source).toBe('live');
    const owners = door43Calls.find(entry => entry.url.includes('/catalog/list/owners'))!;
    expect(new URL(owners.url).searchParams.get('owner')).toBe('unfold');
    expect(door43Calls.every(entry => new Headers(entry.init?.headers).get('authorization') === `Bearer ${TOKEN}`)).toBe(true);
  });

  test('P3: without a search, the organizations only, and the catalog is not asked; /api/owners/writable is still owner.list', async () => {
    const session = await signIn();
    door43Calls = [];
    const body = OPERATIONS['owner.search'].output.parse(await (await call('/api/owners', { headers: { cookie: `tca_session=${session}` } })).json());
    expect(body.own.map(owner => owner.login)).toEqual(['tc-admin-qa-org']);
    expect(body.matches).toEqual([]);
    expect(door43Calls.some(entry => entry.url.includes('/catalog/'))).toBe(false);
    door43Calls = [];
    await call('/api/owners/writable', { headers: { cookie: `tca_session=${session}` } });
    expect(door43Calls.some(entry => entry.url.includes('/user/teams'))).toBe(true);
    expect(door43Calls.some(entry => entry.url.includes('/user/orgs'))).toBe(false);
  });

  test('A1: without a session it is session_expired, and Door43 is not asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await call('/api/owners?q=unfold');
    expect(response.status).toBe(401);
    expect(OperationErrorShape.parse(await response.json()).code).toBe('session_expired');
    expect(door43Calls).toEqual([]);
  });
});
