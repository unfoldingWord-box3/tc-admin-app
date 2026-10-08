// `owner.search` (#77): the account's organizations from `GET /user/orgs`
// (E43, E61), listed first and always, then every owner with a catalog entry
// whose name contains the search, all of them in one answer (E35, E61), with
// the read's freshness (P3).
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { ownerSearch } from '../../src/operations/owner-search';
import { recorded, recordedText } from '../support/recorded';

/** A recording stored as the body Door43 answered, inflated when gzipped. */
const body = <T = unknown>(path: string): T => JSON.parse(recordedText(path)) as T;
/** `GET /api/v1/user/orgs` for `tc-admin-qa` on QA, 5 October 2026: one organization. */
const organizations = recorded<unknown[]>('2026-10-05/user/user__orgs.json');
/** `GET /api/v1/catalog/list/owners?stage=latest&limit=50&owner=unfold&partialMatch=1` on QA, 1 October 2026 (E35). */
const unfold = body('2026-10-01/catalog/list__owners__unfold__partialMatch.json');
/** QA, 7 October 2026 (E61): `GET /user/orgs?page=1&limit=50` (two organizations) and `page=2` (`[]`). */
const orgPages = [body<unknown[]>('2026-10-07/owners/user-orgs__page1.json'), body<unknown[]>('2026-10-07/owners/user-orgs__page2.json')];
/** QA, 7 October 2026 (E61): `owner=zzqxnomatch`, no match, answered `{ ok: true, data: null }`. */
const noMatch = body('2026-10-07/owners/list-owners__nomatch.json');
/** QA, 7 October 2026 (E61): `owner=a`, every one of 1,656 owners in one answer whatever `limit` and `page` say; reduced to `login` and `full_name`. */
const everyA = body<{ data: { login: string }[] }>('2026-10-07/owners/list-owners__a__partialMatch__login-fullname.json.gz');

const noPlans: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const NOW = new Date('2026-10-07T12:00:00.000Z');
let calls: string[];
let pages: unknown[][];
let catalog: Record<string, unknown>;
let status: { orgs: number; owners: number };
const door43: Fetch = async url => {
  const { pathname, searchParams } = new URL(url);
  calls.push(pathname + (searchParams.size ? `?${searchParams}` : ''));
  if (pathname === '/api/v1/user/orgs') {
    if (status.orgs !== 200) return new Response('', { status: status.orgs });
    return Response.json(pages[Number(searchParams.get('page') ?? '1') - 1] ?? []);
  }
  if (pathname === '/api/v1/catalog/list/owners') {
    if (status.owners !== 200) return new Response('', { status: status.owners });
    return Response.json(catalog[searchParams.get('owner') ?? ''] ?? noMatch);
  }
  return new Response('', { status: 404 });
};
const context = (token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', token, noPlans);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch: door43 } : null, now: () => NOW };
};
const search = async (input: unknown) => OPERATIONS['owner.search'].output.parse(await ownerSearch(OPERATIONS['owner.search'].input.parse(input), context()));
const failure = (input: unknown, token?: string | null) =>
  ownerSearch(OPERATIONS['owner.search'].input.parse(input), context(token)).then(
    () => null,
    (error: unknown) => error as CatalogError,
  );
const org = (username: string, id: number, fullName = '') => ({ id, name: username, username, full_name: fullName });
/** An owner as the catalog lists it: Gitea's user shape, for an organization as for a user account (E35). */
const user = (login: string, fullName = '') => ({ id: 1, login, username: login, full_name: fullName });

const reset = () => {
  calls = [];
  pages = [organizations];
  catalog = { unfold };
  status = { orgs: 200, owners: 200 };
};

describe('owner.search', () => {
  test('E35: `unfold` matches unfoldingWord in the catalog; the account\'s organizations come first in `own`, live, with the read\'s freshness (P3)', async () => {
    reset();
    const output = await search({ q: 'unfold' });
    expect(output.own).toEqual([{ login: 'tc-admin-qa-org', name: 'tc-admin-qa-org' }]);
    expect(output.matches).toEqual([{ login: 'unfoldingWord', name: 'unfoldingWord®' }]);
    expect(output.freshness).toEqual({ read_at: '2026-10-07T12:00:00.000Z', source: 'live', age_seconds: 0 });
    // The catalog is asked once, as E35 recorded it less the `limit` it ignores (E61); the organizations are read to their empty last page.
    expect(calls.filter(call => call.startsWith('/api/v1/catalog/'))).toEqual(['/api/v1/catalog/list/owners?owner=unfold&partialMatch=1&stage=latest']);
    expect(calls.filter(call => call.startsWith('/api/v1/user/'))).toEqual(['/api/v1/user/orgs?page=1&limit=50', '/api/v1/user/orgs?page=2&limit=50']);
  });

  test('P3: without a search, or with a blank one, the organizations only, and the catalog is not asked', async () => {
    for (const input of [{}, { q: null }, { q: '' }, { q: '   ' }]) {
      reset();
      const output = await search(input);
      expect(output).toEqual({ own: [{ login: 'tc-admin-qa-org', name: 'tc-admin-qa-org' }], matches: [], freshness: { read_at: '2026-10-07T12:00:00.000Z', source: 'live', age_seconds: 0 } });
      expect(calls.some(call => call.startsWith('/api/v1/catalog/'))).toBe(false);
    }
  });

  test('E61: a search with no match, which Door43 answers `data: null`, returns an empty `matches`, and the organizations still', async () => {
    reset();
    catalog = { zzqxnomatch: noMatch, 'empty-list': { ok: true, data: [] } };
    for (const q of ['zzqxnomatch', 'empty-list']) {
      const output = await search({ q });
      expect(output.matches).toEqual([]);
      expect(output.own).toEqual([{ login: 'tc-admin-qa-org', name: 'tc-admin-qa-org' }]);
    }
    expect(calls).toContain('/api/v1/catalog/list/owners?owner=zzqxnomatch&partialMatch=1&stage=latest');
  });

  test('E61: the catalog answers every match at once, so a match list far longer than fifty is taken whole from one request', async () => {
    reset();
    catalog = { a: everyA };
    const output = await search({ q: 'a' });
    expect(everyA.data).toHaveLength(1656);
    expect(output.matches).toHaveLength(1656);
    expect(output.matches).toContainEqual({ login: 'bahtraku', name: 'Yayasan BahtraKu' });
    expect(calls.filter(call => call.startsWith('/api/v1/catalog/'))).toEqual(['/api/v1/catalog/list/owners?owner=a&partialMatch=1&stage=latest']);
  });

  test('E61: the organizations are read page by page to the empty page Door43 ends on, by name, with their display names', async () => {
    reset();
    pages = orgPages;
    expect((await search({})).own).toEqual([
      { login: 'bahtraku', name: 'Yayasan BahtraKu' },
      { login: 'tc-admin-qa-org', name: 'tc-admin-qa-org' },
    ]);
    expect(calls).toEqual(['/api/v1/user/orgs?page=1&limit=50', '/api/v1/user/orgs?page=2&limit=50']);
  });

  test('a search is sent trimmed', async () => {
    reset();
    expect((await search({ q: '  unfold ' })).matches.map(owner => owner.login)).toEqual(['unfoldingWord']);
  });

  test('an organization after a full first page is listed; each owner once, by name, with its display name', async () => {
    reset();
    pages = [Array.from({ length: 50 }, (_, i) => org(i % 2 ? 'Zeta-Org' : 'zeta-org', i + 1)), [org('alpha-org', 100, ' The Alpha Organization ')]];
    expect((await search({})).own).toEqual([
      { login: 'alpha-org', name: 'The Alpha Organization' },
      { login: 'zeta-org', name: 'zeta-org' },
    ]);
    expect(calls).toEqual(['/api/v1/user/orgs?page=1&limit=50', '/api/v1/user/orgs?page=2&limit=50', '/api/v1/user/orgs?page=3&limit=50']);
  });

  test('E35: matches are organizations and user accounts alike, by name, each once; an organization of the account that matches is in both lists', async () => {
    reset();
    catalog = { qa: { ok: true, data: [user('tc-admin-qa'), user('tc-admin-qa-org'), user('Bahtraku-QA', 'Bahtraku'), user('bahtraku-qa'), { full_name: 'no login' }] } };
    const output = await search({ q: 'qa' });
    expect(output.own).toEqual([{ login: 'tc-admin-qa-org', name: 'tc-admin-qa-org' }]);
    expect(output.matches).toEqual([
      { login: 'Bahtraku-QA', name: 'Bahtraku' },
      { login: 'tc-admin-qa', name: 'tc-admin-qa' },
      { login: 'tc-admin-qa-org', name: 'tc-admin-qa-org' },
    ]);
  });

  test('X2: an answer that is not an owner list is door43_unavailable, never no match', async () => {
    reset();
    catalog = { odd: { ok: true }, worse: ['not', 'the', 'shape'] };
    expect((await failure({ q: 'odd' }))?.code).toBe('door43_unavailable');
    expect((await failure({ q: 'worse' }))?.code).toBe('door43_unavailable');
  });

  test('X2: Door43 failing or refusing either read is door43_unavailable, and an expired token is session_expired', async () => {
    for (const [which, code, expected] of [
      ['orgs', 500, 'door43_unavailable'],
      ['owners', 502, 'door43_unavailable'],
      ['orgs', 404, 'door43_unavailable'],
      ['owners', 403, 'door43_unavailable'],
      ['orgs', 401, 'session_expired'],
      ['owners', 401, 'session_expired'],
    ] as const) {
      reset();
      status[which] = code;
      const error = await failure({ q: 'unfold' });
      expect(error).toBeInstanceOf(CatalogError);
      expect(error?.code).toBe(expected);
    }
  });

  test('A1: session_expired without a session, and Door43 is not asked', async () => {
    reset();
    const error = await failure({ q: 'unfold' }, null);
    expect(error).toBeInstanceOf(CatalogError);
    expect(error?.code).toBe('session_expired');
    expect(calls).toEqual([]);
  });
});
