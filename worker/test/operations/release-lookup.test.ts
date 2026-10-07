// `release.lookup` (#40): the release under a tag with the commit it targets,
// from the recorded releases (E21, E27, E29); none is found, not a failure.
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import { door43Host } from '../../src/door43/host';
import { readReleaseByTag, releaseShape } from '../../src/door43/releases';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { releaseLookup } from '../../src/operations/release-lookup';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const recorded = <T>(path: string): T => {
  const file = JSON.parse(readFileSync(new URL(path, fixtures), 'utf8')) as { response?: { json: T } } & T;
  return file.response ? file.response.json : file;
};
const pendau = recorded<object>('2026-09-21/releases/bahtraku__Perjanjian-Baru-Pendau__tags__v1.2.json');
const probe = recorded<object>('2026-09-22/probe-write/14-lookup-by-tag.json');
const afterDelete = recorded<object>('2026-09-22/probe-write/16-lookup-after-delete.json');

const noPlans: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {} };
const context = (fetch: Fetch, token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', token, noPlans);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch } : null };
};
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));

describe('the release by tag', () => {
  test('R6: a release made on Door43\'s site targets a branch name, so the commit comes from the catalog entry on the release (E20)', () => {
    expect(releaseShape(pendau)).toEqual({
      id: 10987611,
      tag: 'v1.2',
      url: 'https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/releases/tag/v1.2',
      prerelease: false,
      draft: false,
      target_sha: '2d9dbd1ee09b5a1c28edd8668462f6a64029619b',
    });
  });

  test('E27, E29: a release tC Admin makes targets the snapshot commit, and is still found after its temporary branch is deleted', () => {
    expect(releaseShape(probe)).toMatchObject({ tag: 'v1.1.0', target_sha: '1c1db84a847f000ca1da672081a8a1c951504b1a', prerelease: false });
    expect(releaseShape(afterDelete)).toEqual(releaseShape(probe));
    expect(releaseShape({ id: 1, tag_name: 'v9', target_commitish: 'main' })).toMatchObject({ target_sha: '', url: '' });
    expect(releaseShape({ tag_name: 'v9' })).toBeNull();
  });

  test('A3: the read goes to /releases/tags/{tag} with the session token; a 404 is no release, not a failure', async () => {
    const urls: string[] = [];
    const client = { host: door43Host('https://qa.door43.org'), token: 'test-only' };
    const found = await readReleaseByTag({ ...client, fetch: async (url, init) => ((urls.push(url), expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-only')), Response.json(pendau)) }, 'bahtraku', 'Perjanjian-Baru-Pendau', 'v1.2');
    expect(urls).toEqual(['https://qa.door43.org/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/releases/tags/v1.2']);
    expect(found?.tag).toBe('v1.2');
    expect(await readReleaseByTag({ ...client, fetch: async () => new Response('', { status: 404 }) }, 'o', 'r', 'v9')).toBeNull();
    expect((await failure(readReleaseByTag({ ...client, fetch: async () => Response.json({ odd: true }) }, 'o', 'r', 'v9')))?.code).toBe('door43_unavailable');
  });
});

describe('release.lookup', () => {
  test('R6: answers found with the tag, url, pre-release flag, and target commit, or not found, in the catalog\'s shape, writing nothing', async () => {
    const calls: string[] = [];
    const fetch: Fetch = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      return new URL(url).pathname.endsWith('/v1.2') ? Response.json(pendau) : new Response('', { status: 404 });
    };
    const found = OPERATIONS['release.lookup'].output.parse(await releaseLookup({ owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau', tag: 'v1.2' }, context(fetch)));
    expect(found).toEqual({ found: true, release: { tag: 'v1.2', url: 'https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/releases/tag/v1.2', prerelease: false, target_sha: '2d9dbd1ee09b5a1c28edd8668462f6a64029619b' } });
    const missing = OPERATIONS['release.lookup'].output.parse(await releaseLookup({ owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau', tag: 'v1.3.0' }, context(fetch)));
    expect(missing).toEqual({ found: false, release: null });
    expect(calls.every(call => call.startsWith('GET '))).toBe(true);
  });

  test('X2: no session is session_expired, and Door43 is not asked; a Door43 outage is door43_unavailable', async () => {
    const calls: string[] = [];
    expect((await failure(releaseLookup({ owner: 'o', repo: 'r', tag: 'v1' }, context(async url => ((calls.push(url), Response.json(pendau))), null))))?.code).toBe('session_expired');
    expect(calls).toEqual([]);
    expect((await failure(releaseLookup({ owner: 'o', repo: 'r', tag: 'v1' }, context(async () => new Response('', { status: 503 })))))?.code).toBe('door43_unavailable');
  });
});
