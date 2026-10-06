// The typed client builds each operation's request from the shared schema and
// returns either the parsed output or the catalog error.
import { CSRF_HEADER } from '@tc-admin/shared/schema';
import { afterEach, describe, expect, test } from 'vitest';
import { ApiError, callOperation, forgetCsrfToken, operationRequest, signOut } from '../src/api/client';
import type { Fetch } from '../src/api/client';

describe('requests', () => {
  test('path fields fill the route and a GET takes the rest as its query', () => {
    expect(operationRequest('release.lookup', { owner: 'bahtraku', repo: 'id_tb1', tag: 'v1974' }).url).toBe('/api/projects/bahtraku/id_tb1/releases/v1974');
    expect(operationRequest('source.search', { owner: 'unfoldingWord', stage: 'prod' }).url).toBe('/api/sources?owner=unfoldingWord&stage=prod');
    expect(operationRequest('owner.search', { q: null }).url).toBe('/api/owners');
    expect(operationRequest('project.read', { owner: 'a b', repo: 'c/d' }).url).toBe('/api/projects/a%20b/c%2Fd');
  });

  test('an apply names its plan as the Idempotency-Key header too', () => {
    expect(new Headers(operationRequest('project.create.apply', { plan_id: 'p1' }).init.headers).get('idempotency-key')).toBe('p1');
    expect(new Headers(operationRequest('project.create.plan', { owner: 'o', project_type: 'bible', title: 't', abbreviation: 'a', language: { code: 'en', title: 'English' }, testament_scope: 'nt', license: 'cc-by-sa-4.0' }).init.headers).has('idempotency-key')).toBe(false);
  });

  test('a POST sends the fields that are not in the path as a JSON body', () => {
    const { url, init } = operationRequest('release.prepare', { owner: 'o', repo: 'r', plan_id: 'p1', selection: { mat: 'include' }, unknown_included: [], version: null });
    expect(url).toBe('/api/projects/o/r/preparations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ plan_id: 'p1', selection: { mat: 'include' }, unknown_included: [], version: null });
  });
});

describe('responses', () => {
  const situation = { account: null, host: { origin: 'https://qa.door43.org', name: 'QA', development: true }, portfolio: null, configured: false };

  test('the output is parsed against the operation schema', async () => {
    const result = await callOperation('situation.read', {}, async () => new Response(JSON.stringify(situation)));
    expect(result.host.name).toBe('QA');
    await expect(callOperation('situation.read', {}, async () => new Response(JSON.stringify({ host: 'qa' })))).rejects.toMatchObject({ name: 'ZodError' });
  });

  test('X2: a failure is an ApiError carrying the catalog error', async () => {
    const error = { code: 'session_expired', message: 'Your Door43 session expired. Please sign in again.', retryable: true, next_action: 'sign in', request_id: 'r1', details: {}, invariant: 'A1' };
    const failure = await callOperation('situation.read', {}, async () => new Response(JSON.stringify(error), { status: 401 })).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).error.code).toBe('session_expired');
  });

  test('X2: a failure without the catalog shape becomes unexpected with the request id', async () => {
    const failure = await callOperation('situation.read', {}, async () => new Response('Bad gateway', { status: 502, headers: { 'x-request-id': 'r2' } })).catch((e: unknown) => e);
    expect((failure as ApiError).error).toMatchObject({ code: 'unexpected', message: 'Something went wrong. Reference r2.', request_id: 'r2' });
  });
});

describe('the CSRF token (A4)', () => {
  afterEach(() => forgetCsrfToken());
  const situation = { account: { login: 'm', name: 'M' }, host: { origin: 'https://qa.door43.org', name: 'QA', development: true }, portfolio: null, configured: true };
  const lookup = { found: false, release: null };

  /** A Worker that issues `token` on every response and records what it was sent; an apply is answered outside its schema, which the caller ignores. */
  const worker = (token: string) => {
    const sent: { url: string; headers: Headers }[] = [];
    const fetcher: Fetch = async (url, init) => {
      sent.push({ url, headers: new Headers(init?.headers) });
      const headers = token ? { [CSRF_HEADER]: token } : {};
      if (url === '/auth/logout') return new Response(null, { status: 204, headers });
      return new Response(JSON.stringify(url === '/api/situation' ? situation : lookup), { status: 200, headers });
    };
    return { sent, fetcher };
  };
  const apply = (fetcher: Fetch) => callOperation('project.create.apply', { plan_id: 'p1' }, fetcher).catch(() => null);

  test('A4: the token a response carries is sent on every later POST, and on no GET', async () => {
    const { sent, fetcher } = worker('issued-token');
    await callOperation('situation.read', {}, fetcher);
    expect(sent[0]!.headers.has(CSRF_HEADER)).toBe(false);
    await apply(fetcher);
    expect(sent[1]!.headers.get(CSRF_HEADER)).toBe('issued-token');
    await callOperation('release.lookup', { owner: 'o', repo: 'r', tag: 'v1' }, fetcher);
    expect(sent[2]!.headers.has(CSRF_HEADER)).toBe(false);
    await signOut(fetcher);
    expect(sent[3]!.headers.get(CSRF_HEADER)).toBe('issued-token');
  });

  test('A1: a page that has not read a response sends no token, and signing out forgets it', async () => {
    const { sent, fetcher } = worker('issued-token');
    await apply(fetcher);
    expect(sent[0]!.headers.has(CSRF_HEADER)).toBe(false);
    await apply(fetcher);
    expect(sent[1]!.headers.get(CSRF_HEADER)).toBe('issued-token');
    await signOut(fetcher);
    const { sent: later, fetcher: next } = worker('');
    await apply(next);
    expect(later[0]!.headers.has(CSRF_HEADER)).toBe(false);
  });
});
