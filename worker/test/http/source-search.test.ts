// `source.search` through the HTTP projection: `GET /api/sources?owner=&stage=`
// (operations.md §7), its query string as the input, validated against the
// shared schema before the operation runs, and the catalog error shape (X2).
import { OPERATIONS, OperationErrorShape } from '@tc-admin/shared/schema';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Env, KVNamespace } from '../../src/env';
import worker from '../../src/index';
import { HANDLERS } from '../../src/operations';

const kv: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {} };
const env: Env = {
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SESSIONS: kv,
  PLANS: kv,
  DOOR43_ORIGIN: 'https://qa.door43.org',
};
const call = (path: string) => worker.fetch(new Request(`https://tc-admin.test${path}`), env);

const built = HANDLERS['source.search'];
afterEach(() => {
  if (built) HANDLERS['source.search'] = built;
  else delete HANDLERS['source.search'];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/sources', () => {
  test('is source.search, and its query string is the input', async () => {
    expect(OPERATIONS['source.search'].route).toEqual({ method: 'GET', path: '/api/sources' });
    const seen: unknown[] = [];
    const answer = { sources: [], freshness: { read_at: '2026-10-07T16:00:00.000Z', source: 'live', age_seconds: 0 } };
    HANDLERS['source.search'] = (async (input: unknown) => (seen.push(input), answer)) as never;
    const response = await call('/api/sources?owner=unfoldingWord&stage=latest');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer);
    expect(seen).toEqual([{ owner: 'unfoldingWord', stage: 'latest' }]);
  });

  test('X2: a stage other than prod or latest, or no owner, is validation_failed naming the field, and the operation does not run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const standIn = vi.fn<() => Promise<unknown>>();
    HANDLERS['source.search'] = standIn as never;
    const badStage = await call('/api/sources?owner=unfoldingWord&stage=preprod');
    expect(badStage.status).toBe(400);
    expect(OperationErrorShape.parse(await badStage.json())).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'stage' }] } });
    const noOwner = OperationErrorShape.parse(await (await call('/api/sources?stage=prod')).json());
    expect(noOwner).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'owner' }] } });
    expect(standIn).not.toHaveBeenCalled();
  });

  test('without a session it is session_expired, and Door43 is not asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const response = await call('/api/sources?owner=unfoldingWord&stage=prod');
    expect(response.status).toBe(401);
    expect(OperationErrorShape.parse(await response.json()).code).toBe('session_expired');
    expect(fetch).not.toHaveBeenCalled();
  });
});
