// The HTTP projection: routes come from the shared schema, inputs and outputs
// are validated against it, and every failure is the catalog's error shape.
import { IDEMPOTENCY_HEADER, OPERATIONS, OperationErrorShape } from '@tc-admin/shared/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env, KVNamespace } from '../../src/env';
import worker from '../../src/index';
import { HANDLERS } from '../../src/operations';

const kv: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const env = (extra: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SESSIONS: kv,
  PLANS: kv,
  DOOR43_ORIGIN: 'https://qa.door43.org',
  ...extra,
});
const call = (path: string, init: RequestInit = {}, extra: Partial<Env> = {}) => worker.fetch(new Request(`https://tc-admin.test${path}`, init), env(extra));

afterEach(() => vi.restoreAllMocks());

describe('situation.read', () => {
  test('reports the configured host and that no one is signed in', async () => {
    const response = await call('/api/situation');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(OPERATIONS['situation.read'].output.parse(body)).toEqual({
      account: null,
      host: { origin: 'https://qa.door43.org', name: 'QA', development: true },
      portfolio: null,
      configured: false,
    });
  });

  test('says sign-in is configured when a client id is set, and names production', async () => {
    const body = await (await call('/api/situation', {}, { DOOR43_ORIGIN: 'https://git.door43.org', DOOR43_CLIENT_ID: 'id' })).json();
    expect(body).toMatchObject({ host: { name: 'Production', development: false }, configured: true });
  });

  test('A1: no response carries the client id or secret', async () => {
    const response = await call('/api/situation', {}, { DOOR43_CLIENT_ID: 'client-id-value', DOOR43_CLIENT_SECRET: 'secret-value' });
    const text = await response.text();
    expect(text).not.toContain('client-id-value');
    expect(text).not.toContain('secret-value');
  });

  test('API responses are not cached and carry the request id', async () => {
    const response = await call('/api/situation');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('failures', () => {
  test('X2: a route that is no operation answers with the catalog error shape and a request id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await call('/api/nothing-here');
    const body = OperationErrorShape.parse(await response.json());
    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: 'unknown_operation', retryable: false, invariant: 'X2', details: { reason: 'no operation at this route' } });
    expect(body.message).toBe('This request is not an operation tC Admin offers.');
    expect(response.headers.get('x-request-id')).toBe(body.request_id);
  });

  test('X2: a catalog operation not built yet answers with the catalog error shape', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Every Milestone 1 operation is built (#26 built the last, project.read), so one is set aside for the test.
    const built = HANDLERS['project.read'];
    delete HANDLERS['project.read'];
    try {
      const body = OperationErrorShape.parse(await (await call('/api/projects/team/sw_ult')).json());
      expect(body).toMatchObject({ code: 'unknown_operation', details: { operation: 'project.read' } });
    } finally {
      if (built) HANDLERS['project.read'] = built;
    }
  });

  describe('with a stand-in for an operation', () => {
    const standIn = vi.fn<() => Promise<unknown>>(async () => ({ not: 'a plan' }));
    const built = HANDLERS['project.create.plan'];
    beforeEach(() => {
      HANDLERS['project.create.plan'] = standIn as never;
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      if (built) HANDLERS['project.create.plan'] = built;
      else delete HANDLERS['project.create.plan'];
    });
    // As a browser sends it: with its own origin (A4; csrf.test.ts has the refusals).
    const post = (body: string) => call('/api/projects/plan', { method: 'POST', headers: { origin: 'https://tc-admin.test' }, body });

    test('X2: a body that is not JSON is validation_failed with its message', async () => {
      const response = await post('{');
      expect(response.status).toBe(400);
      expect(OperationErrorShape.parse(await response.json())).toMatchObject({ code: 'validation_failed', message: 'The request body is not valid JSON.' });
    });

    test('X2: an input the schema refuses is validation_failed naming each field, and the operation does not run', async () => {
      standIn.mockClear();
      const body = OperationErrorShape.parse(await (await post(JSON.stringify({ owner: 'team', project_type: 'tn' }))).json());
      expect(body.code).toBe('validation_failed');
      expect(body.message).toContain('project_type');
      expect((body.details.fields as { path: string }[]).map(field => field.path)).toContain('abbreviation');
      expect(standIn).not.toHaveBeenCalled();
    });

    test('X2: an output that is not the catalog shape is never returned', async () => {
      const valid = { owner: 'team', project_type: 'bible', title: 'T', abbreviation: 'ult', language: { code: 'sw', title: 'Kiswahili' }, testament_scope: 'nt', license: 'cc-by-sa-4.0' };
      const response = await post(JSON.stringify(valid));
      expect(standIn).toHaveBeenCalled();
      expect(response.status).toBe(500);
      const body = OperationErrorShape.parse(await response.json());
      expect(body).toMatchObject({ code: 'unexpected', details: { reason: 'output does not match the schema' } });
      expect(JSON.stringify(body)).not.toContain('a plan');
    });
  });

  test('X2: a deployment that names an unknown Door43 host fails as unexpected, not with the host in the message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = OperationErrorShape.parse(await (await call('/api/situation', {}, { DOOR43_ORIGIN: 'https://example.org' })).json());
    expect(body.code).toBe('unexpected');
    expect(body.message).not.toContain('example.org');
    expect(log).toHaveBeenCalledOnce();
  });

  test('X3: the failure log carries the request id and code, not the thrown message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await call('/api/situation', {}, { DOOR43_ORIGIN: 'https://example.org' });
    const line = JSON.parse(String(log.mock.calls[0]![0]));
    expect(Object.keys(line).sort()).toEqual(['code', 'details', 'kind', 'request_id']);
    expect(JSON.stringify(line)).not.toContain('example.org');
  });
});

describe('the idempotency key', () => {
  const seen: unknown[] = [];
  beforeEach(() => {
    seen.length = 0;
    HANDLERS['project.create.apply'] = (async (input: unknown) => (seen.push(input), { not: 'a receipt' })) as never;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    delete HANDLERS['project.create.apply'];
  });
  const apply = (headers: Record<string, string>) => call('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://tc-admin.test', ...headers }, body: JSON.stringify({ plan_id: 'p1' }) });

  test('an Idempotency-Key that names another plan is validation_failed before the operation runs', async () => {
    const body = OperationErrorShape.parse(await (await apply({ [IDEMPOTENCY_HEADER]: 'p2' })).json());
    expect(body.code).toBe('validation_failed');
    expect(body.message).toContain('Idempotency-Key');
    expect(seen).toEqual([]);
  });

  test('a matching key, or none, lets the operation run', async () => {
    await apply({ [IDEMPOTENCY_HEADER]: 'p1' });
    await apply({});
    expect(seen).toEqual([{ plan_id: 'p1' }, { plan_id: 'p1' }]);
  });
});

describe('routing', () => {
  test('a path segment fills its input field, decoded', async () => {
    const seen: unknown[] = [];
    HANDLERS['release.lookup'] = (async (input: unknown) => (seen.push(input), { found: false, release: null })) as never;
    try {
      expect((await call('/api/projects/bahtraku/Perjanjian-Baru-Pendau/releases/v1.2')).status).toBe(200);
      expect((await call('/api/projects/a%20b/c/releases/v1')).status).toBe(200);
    } finally {
      delete HANDLERS['release.lookup'];
    }
    expect(seen).toEqual([
      { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau', tag: 'v1.2' },
      { owner: 'a b', repo: 'c', tag: 'v1' },
    ]);
  });

  test('project.create.retry takes its project from the path and its plan from the body, and refuses an Idempotency-Key that names another plan (#31)', async () => {
    const seen: unknown[] = [];
    const built = HANDLERS['project.create.retry'];
    HANDLERS['project.create.retry'] = (async (input: unknown) => (seen.push(input), { not: 'a receipt' })) as never;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retry = (key: string) =>
      call('/api/projects/tc-admin-qa-org/id_tcap/setup/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://tc-admin.test', [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify({ plan_id: 'p1' }),
      });
    try {
      expect(OperationErrorShape.parse(await (await retry('p2')).json()).code).toBe('validation_failed');
      expect(seen).toEqual([]);
      await retry('p1');
      expect(seen).toEqual([{ owner: 'tc-admin-qa-org', repo: 'id_tcap', plan_id: 'p1' }]);
    } finally {
      if (built) HANDLERS['project.create.retry'] = built;
      else delete HANDLERS['project.create.retry'];
    }
  });

  test('portfolio.list without a session is session_expired, and Door43 is not asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    try {
      const response = await call('/api/portfolio');
      expect(response.status).toBe(401);
      expect(OperationErrorShape.parse(await response.json()).code).toBe('session_expired');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('X2: a method the route does not take is no operation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = OperationErrorShape.parse(await (await call('/api/projects/plan')).json());
    expect(body).toMatchObject({ code: 'unknown_operation', details: { reason: 'no operation at this route' } });
  });

  test('everything outside /api/ is the web app', async () => {
    const response = await call('/projects/team/sw_ult');
    expect(response.headers.get('content-type')).toBe('text/html');
  });
});
