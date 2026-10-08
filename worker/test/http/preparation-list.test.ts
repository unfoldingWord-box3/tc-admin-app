// `GET /api/projects/{owner}/{repo}/preparations` is `preparation.list`
// (operations.md §7, #125): the same path as `release.prepare`'s POST, told
// apart by the method; the session's token reads the permission, and the
// answer is the catalog shape. Door43 is stubbed with recordings.
import { OPERATIONS, OperationErrorShape, Preparation } from '@tc-admin/shared/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env, KVNamespace } from '../../src/env';
import worker from '../../src/index';
import { planStore } from '../../src/operations/plans';
import { recorded } from '../support/recorded';

type Repo = { catalog: { latest: { commit_sha: string } | null }; permissions: { push: boolean; admin: boolean; pull: boolean } };
const user = recorded<unknown>('2026-10-05/user/user.json');
const repoView = recorded<Repo>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const TOKEN = 'door43-token-value';
const ORIGIN = 'https://tc-admin.test';

class MemoryKV implements KVNamespace {
  readonly entries = new Map<string, string>();
  readonly lists: string[] = [];
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
    this.lists.push(options.prefix);
    return { keys: [...this.entries.keys()].filter(name => name.startsWith(options.prefix)).map(name => ({ name })), list_complete: true };
  }
}

let sessions: MemoryKV;
let plans: MemoryKV;
let door43Calls: string[];
const env = (): Env => ({
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SESSIONS: sessions,
  PLANS: plans,
  DOOR43_ORIGIN: 'https://qa.door43.org',
  DOOR43_CLIENT_ID: 'client-id',
  DOOR43_CLIENT_SECRET: 'client-secret-value',
});
const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }), env());

const preparation = Preparation.parse({
  id: 'v1.1.0',
  project_ref: { owner: 'tc-admin-qa-org', repo: 'id_obs1948' },
  state: 'health_checking',
  bound_to: { default_branch_sha: repoView.catalog.latest!.commit_sha, release_tag: null, release_tag_sha: null },
  selection: { new: [], revised: [], unknown_included: [] },
  snapshot: { branch: 'temp-tca-release/v1.1.0', commit_sha: 'e000000000000000000000000000000000000001', files: [] },
  health: { state: 'checking', severity_raw: null, ref: 'temp-tca-release/v1.1.0', checked_at: null, issue_count: null, issues: null, source: 'door43' },
  requires_acknowledgement: false,
  version: { baseline_tag: 'v1.0.0', proposed: 'v1.1.0', confirmed: 'v1.1.0' },
  notes: { draft: 'Release v1.1.0', confirmed: null },
  release: null,
  last_error: null,
  history: [{ at: '2026-10-08T10:00:00.000Z', from: 'snapshot_prepared', to: 'health_checking', event: 'push confirmed' }],
  freshness: { read_at: '2026-10-08T10:00:00.000Z', source: 'live', age_seconds: 0 },
});

beforeEach(async () => {
  sessions = new MemoryKV();
  plans = new MemoryKV();
  door43Calls = [];
  await planStore(plans).putPreparation('tc-admin-qa-org', 'id_obs1948', 'v1.1.0', preparation);
  vi.stubGlobal('fetch', async (url: string) => {
    const { pathname } = new URL(url);
    door43Calls.push(pathname);
    if (pathname === '/login/oauth/access_token') return Response.json({ access_token: TOKEN, expires_in: 3600 });
    if (pathname === '/api/v1/user') return Response.json(user);
    if (/^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname)) return Response.json({ ...repoView, permissions: { ...repoView.permissions, push: true } });
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

describe('GET /api/projects/{owner}/{repo}/preparations', () => {
  test('is preparation.list: the project\'s stored preparations in the catalog shape, after the permission read with the session\'s token (A2)', async () => {
    const cookie = await signIn();
    door43Calls.length = 0;
    const response = await call('/api/projects/tc-admin-qa-org/id_obs1948/preparations', { headers: { cookie: `tca_session=${cookie}` } });
    expect(response.status).toBe(200);
    const body = OPERATIONS['preparation.list'].output.parse(await response.json());
    expect(body.preparations.map(found => [found.id, found.state, found.snapshot?.branch])).toEqual([['v1.1.0', 'health_checking', 'temp-tca-release/v1.1.0']]);
    expect(door43Calls).toEqual(['/api/v1/repos/tc-admin-qa-org/id_obs1948']);
    expect(plans.lists).toEqual(['preparation:tc-admin-qa-org/id_obs1948/']);
  });

  test('A2: without a session it is session_expired, and neither Door43 nor the store is asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await call('/api/projects/tc-admin-qa-org/id_obs1948/preparations');
    expect(response.status).toBe(401);
    expect(OperationErrorShape.parse(await response.json()).code).toBe('session_expired');
    expect(door43Calls).toEqual([]);
    expect(plans.lists).toEqual([]);
  });
});
