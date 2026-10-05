// The prototype's Door43 client tests, carried over (#7): origin isolation,
// the token in the authorization header only, session expiry, and pagination.
import { CatalogError } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { door43Request, readDoor43, readPages } from '../../src/door43/api';
import type { Door43Client, Fetch } from '../../src/door43/api';
import { door43Host } from '../../src/door43/host';

const qa = door43Host('https://qa.door43.org');
const client = (fetch: Fetch): Door43Client => ({ host: qa, token: 'test-only', fetch });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const code = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error.code : error));

describe('the configured host', () => {
  test('QA and production are the only hosts, with their names', () => {
    expect(door43Host('https://qa.door43.org/')).toEqual({ origin: 'https://qa.door43.org', name: 'QA', development: true });
    expect(door43Host('https://git.door43.org')).toEqual({ origin: 'https://git.door43.org', name: 'Production', development: false });
    expect(() => door43Host('https://example.org')).toThrow(/DOOR43_ORIGIN/);
  });

  test('a request to another origin is refused before anything is sent', async () => {
    let sent = false;
    const fetch: Fetch = async () => ((sent = true), json({}));
    expect(await code(door43Request(qa, 'https://git.door43.org/api/v1/user', {}, fetch))).toBe('unexpected');
    expect(sent).toBe(false);
  });
});

describe('reads', () => {
  test('A3: API reads target the configured origin only and carry the session token in the authorization header', async () => {
    const fetch: Fetch = async (url, init) => {
      expect(new URL(url).origin).toBe('https://qa.door43.org');
      expect(new URL(url).pathname).toBe('/api/v1/user');
      expect(new URL(url).search).toBe('');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-only');
      // `error` is what Node allows and the Workers runtime refuses (E39).
      expect(init?.redirect).toBe('manual');
      return json({ id: 1, login: 'tester' });
    };
    expect(await readDoor43(client(fetch), '/user')).toEqual({ id: 1, login: 'tester' });
  });

  test('A1: a redirect from Door43 is refused, never followed', async () => {
    const calls: string[] = [];
    const redirecting: Fetch = async url => {
      calls.push(url);
      return new Response('', { status: 302, headers: { location: 'https://example.org/elsewhere' } });
    };
    expect(await code(readDoor43(client(redirecting), '/user'))).toBe('door43_unavailable');
    expect(calls).toEqual(['https://qa.door43.org/api/v1/user']);
  });

  test('A1: an expired Door43 session requires a new sign-in', async () => {
    expect(await code(readDoor43(client(async () => new Response('', { status: 401 })), '/user'))).toBe('session_expired');
  });

  test('Door43 statuses become catalog codes', async () => {
    const status = (n: number) => code(readDoor43(client(async () => new Response('', { status: n })), '/user'));
    expect(await status(403)).toBe('permission_denied');
    expect(await status(404)).toBe('not_found');
    expect(await status(500)).toBe('door43_unavailable');
    expect(await code(readDoor43(client(async () => Promise.reject(new TypeError('network'))), '/user'))).toBe('door43_unavailable');
  });
});

describe('pagination', () => {
  test('every page is read until an empty one', async () => {
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }], []];
    const fetch: Fetch = async url => json({ ok: true, data: pages[Number(new URL(url).searchParams.get('page')) - 1] });
    expect((await readPages(client(fetch), '/repos/search')).map(item => item.id)).toEqual([1, 2, 3]);
  });

  test('an array query value repeats the parameter on every page', async () => {
    const seen: string[][] = [];
    const fetch: Fetch = async url => {
      const query = new URL(url).searchParams;
      seen.push(query.getAll('flavor'));
      return json({ ok: true, data: query.get('page') === '1' ? [{ id: 1 }] : [] });
    };
    await readPages(client(fetch), '/repos/search', { flavor: ['textTranslation', 'textStories'] });
    expect(seen).toEqual([
      ['textTranslation', 'textStories'],
      ['textTranslation', 'textStories'],
    ]);
  });

  test('pagination rejects repeated pages rather than loading forever', async () => {
    expect(await code(readPages(client(async () => json({ data: [{ id: 1 }] })), '/repos/search'))).toBe('door43_unavailable');
  });

  test('P1: a list longer than the read limit fails whole rather than as a partial portfolio', async () => {
    const fetch: Fetch = async url => json({ data: [{ id: Number(new URL(url).searchParams.get('page')) }] });
    expect(await code(readPages(client(fetch), '/repos/search', {}, 3))).toBe('portfolio_too_large');
  });
});
