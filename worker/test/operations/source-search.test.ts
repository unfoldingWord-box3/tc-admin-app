// `source.search` (#78): an owner's Bible and Open Bible Stories repositories as
// import sources, at their last release or their default branch, over the two
// catalog searches recorded on QA on 1 October 2026 (E35) with a stubbed fetch,
// and the reads of 7 October 2026 (E62), recorded as projections: the
// unfoldingWord search answers the same with and without `stage=prod`, so the
// 1 October recording, made without it, answers the `prod` request; the search
// honors `limit` and `page`; and past the last page, or for an owner with no
// entries, it answers an empty list.
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { sourceSearch } from '../../src/operations/source-search';

type Entry = Record<string, unknown> & { name: string; repo: Record<string, unknown> };
type Search = { ok: boolean; data: Entry[]; last_updated: string };

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/2026-10-01/catalog/', import.meta.url);
const recordedSearch = (name: string): Search => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8')) as Search;
const UNFOLDINGWORD = recordedSearch('search__owner=unfoldingWord__flavor=textTranslation,textStories.json');
const BAHTRAKU = recordedSearch('search__owner=bahtraku__flavor=textTranslation,textStories__stage=latest.json');
const recordedEntry = (search: Search, name: string): Entry => structuredClone(search.data.find(entry => entry.name === name)!);

/** A 7 October 2026 answer, reduced to the fields that bear on it (E62). */
type Projection = { ok: boolean; data: { repo: string; branch_or_tag_name: string; stage: string; commit_sha: string }[] };
const probes = new URL('../../../fixtures/door43/qa.door43.org/2026-10-07/sources/', import.meta.url);
const projection = (name: string): Projection => JSON.parse(readFileSync(new URL(name, probes), 'utf8')) as Projection;
/** The recorded empty answers: the page after the last, and an owner with no entries (E62). */
const PAST_LAST_PAGE = projection('search__uw__prod_p2.json');
const NO_ENTRIES = projection('search__none__latest.json');

const noPlans: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const NOW = new Date('2026-10-07T16:00:00.000Z');

/** Door43 stubbed by owner and stage: page 1 is the answer, every later page the recorded empty one; an owner without an answer has no entries (E62). */
function door43(answers: Record<string, Search | Response>, calls: string[] = [], empty: unknown = PAST_LAST_PAGE): Fetch {
  return async url => {
    const { pathname, searchParams } = new URL(url);
    calls.push(`${pathname}?${searchParams}`);
    if (pathname !== '/api/v1/catalog/search') return new Response('', { status: 404 });
    const answer = answers[`${searchParams.get('owner')}:${searchParams.get('stage')}`];
    if (answer instanceof Response) return answer;
    if (!answer) return Response.json(NO_ENTRIES);
    return Response.json(searchParams.get('page') === '1' ? answer : empty);
  };
}
const context = (fetch: Fetch, token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', token, noPlans);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch } : null, now: () => NOW };
};
const run = async (input: unknown, fetch: Fetch, token?: string | null) =>
  OPERATIONS['source.search'].output.parse(await sourceSearch(OPERATIONS['source.search'].input.parse(input), context(fetch, token)));
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as CatalogError);

describe('source.search at the last release (prod)', () => {
  const answers = { 'unfoldingWord:prod': UNFOLDINGWORD };

  test('E35, E62: one catalog search for the owner and both flavors at the stage, read to the empty page past the last, live with its freshness (P3)', async () => {
    const calls: string[] = [];
    const output = await run({ owner: 'unfoldingWord', stage: 'prod' }, door43(answers, calls));
    expect(calls).toEqual([
      '/api/v1/catalog/search?owner=unfoldingWord&flavor=textTranslation&flavor=textStories&stage=prod&page=1&limit=50',
      '/api/v1/catalog/search?owner=unfoldingWord&flavor=textTranslation&flavor=textStories&stage=prod&page=2&limit=50',
    ]);
    expect(output.freshness).toEqual({ read_at: '2026-10-07T16:00:00.000Z', source: 'live', age_seconds: 0 });
  });

  test('E62: stage=prod is the search\'s default, so the recording made without it is the prod answer, ref for ref and commit for commit', async () => {
    const prod = projection('search__uw__prod.json');
    expect(projection('search__uw__nostage.json')).toEqual(prod);
    const { sources } = await run({ owner: 'unfoldingWord', stage: 'prod' }, door43(answers));
    expect(sources.map(s => ({ repo: `${s.ref.owner}/${s.ref.repo}`, revision: s.revision }))).toEqual(
      prod.data.map(entry => ({ repo: entry.repo, revision: { tag: entry.branch_or_tag_name, sha: entry.commit_sha } })),
    );
  });

  test('E62: the search is read page by page, in Door43\'s order, until the empty page past the last', async () => {
    const pages = [projection('search__uw__prod_l3_p1.json'), projection('search__uw__prod_l3_p2.json')].map(page => page.data.map(entry => entry.repo));
    const named = new Set(pages.flat());
    // Pages 1 and 2 hold the repositories the recorded pages of three name; the rest of the ten stand in for the pages after (not recorded).
    const full = (repos: string[]) => ({ ...UNFOLDINGWORD, data: repos.map(repo => recordedEntry(UNFOLDINGWORD, repo.split('/')[1]!)) });
    const rest = UNFOLDINGWORD.data.map(entry => `unfoldingWord/${entry.name}`).filter(repo => !named.has(repo));
    const answers = [full(pages[0]!), full(pages[1]!), full(rest), PAST_LAST_PAGE];
    const calls: string[] = [];
    const paged: Fetch = async url => {
      calls.push(url);
      return Response.json(answers[Number(new URL(url).searchParams.get('page')) - 1]);
    };
    const { sources } = await run({ owner: 'unfoldingWord', stage: 'prod' }, paged);
    expect(calls).toHaveLength(4);
    expect(sources.map(s => `${s.ref.owner}/${s.ref.repo}`)).toEqual([...pages.flat(), ...rest]);
    expect(sources).toHaveLength(10);
  });

  test('E35: unfoldingWord yields its ten Bible and Open Bible Stories repositories, each at its release tag with the commit', async () => {
    const { sources } = await run({ owner: 'unfoldingWord', stage: 'prod' }, door43(answers));
    expect(sources.map(s => s.ref.repo)).toEqual(['el-x-koine_ugnt', 'BHP', 'en_ult', 'en_ust', 'en_t4t', 'en_ueb', 'en_obs', 'fr_ulb', 'fr_obs', 'hbo_uhb']);
    expect(new Set(sources.map(s => s.project_type))).toEqual(new Set(['bible', 'obs']));
    expect(sources.every(s => s.stage === 'prod' && s.released && 'tag' in s.revision && s.revision.sha.length === 40)).toBe(true);
    expect(sources.find(s => s.ref.repo === 'en_ult')).toMatchObject({
      ref: { owner: 'unfoldingWord', repo: 'en_ult' },
      title: 'unfoldingWord® Literal Text',
      language: { code: 'en', title: 'English' },
      project_type: 'bible',
      metadata_format: 'rc',
      revision: { tag: 'v91', sha: '35d215957f3203fd2e2fac5702ce14902d417f9d' },
      released: true,
    });
  });

  test('E35: en_ult itemizes 60 ingredients, the 59 books among them listed in canonical order with their titles; front matter is not a book', async () => {
    const { sources } = await run({ owner: 'unfoldingWord', stage: 'prod' }, door43(answers));
    const books = sources.find(s => s.ref.repo === 'en_ult')!.books!;
    expect((recordedEntry(UNFOLDINGWORD, 'en_ult').ingredients as unknown[]).length).toBe(60);
    expect(books).toHaveLength(59);
    expect(books[0]).toEqual({ id: 'gen', title: 'Genesis' });
    expect(books.at(-1)).toEqual({ id: 'rev', title: 'Revelation' });
    expect(books.map(book => book.id)).not.toContain('frt');
  });

  test('H3, E36: a Resource Container Open Bible Stories repository lists only its content container, so its books are null, never empty', async () => {
    const { sources } = await run({ owner: 'unfoldingWord', stage: 'prod' }, door43(answers));
    expect(sources.find(s => s.ref.repo === 'en_obs')).toEqual({
      ref: { owner: 'unfoldingWord', repo: 'en_obs' },
      title: 'unfoldingWord® Open Bible Stories',
      language: { code: 'en', title: 'English' },
      project_type: 'obs',
      metadata_format: 'rc',
      stage: 'prod',
      revision: { tag: 'v9', sha: 'd39a1dc7a7557ac54e4a8fecc3462147fe7eec3b' },
      released: true,
      books: null,
    });
    expect(sources.find(s => s.ref.repo === 'fr_obs')?.books).toBeNull();
  });

  test('Q23: the Greek and Hebrew Bibles are Bibles by their flavor, whatever subject Door43 gives them', async () => {
    const { sources } = await run({ owner: 'unfoldingWord', stage: 'prod' }, door43(answers));
    expect(sources.find(s => s.ref.repo === 'el-x-koine_ugnt')).toMatchObject({ project_type: 'bible', books: expect.arrayContaining([{ id: 'mat', title: 'Matthew' }]) });
    expect(sources.find(s => s.ref.repo === 'el-x-koine_ugnt')?.books).toHaveLength(27);
    expect(sources.find(s => s.ref.repo === 'hbo_uhb')).toMatchObject({ project_type: 'bible' });
    expect(sources.find(s => s.ref.repo === 'hbo_uhb')?.books).toHaveLength(39);
  });

  test('a prod search never offers a branch: an entry for a default branch is not a release', async () => {
    const unreleased = recordedEntry(BAHTRAKU, 'PB-Loli-Edisi-Percobaan');
    const search: Search = { ...UNFOLDINGWORD, data: [recordedEntry(UNFOLDINGWORD, 'en_ult'), unreleased] };
    const { sources } = await run({ owner: 'unfoldingWord', stage: 'prod' }, door43({ 'unfoldingWord:prod': search }));
    expect(sources.map(s => s.ref.repo)).toEqual(['en_ult']);
  });
});

describe('source.search at the default branch (latest)', () => {
  const answers = { 'bahtraku:latest': BAHTRAKU };

  test('E35, Q25: every one of the owner\'s 41 repositories is offered at its default branch with the head commit, released or not, in both formats', async () => {
    const calls: string[] = [];
    const { sources } = await run({ owner: 'bahtraku', stage: 'latest' }, door43(answers, calls));
    expect(calls[0]).toBe('/api/v1/catalog/search?owner=bahtraku&flavor=textTranslation&flavor=textStories&stage=latest&page=1&limit=50');
    expect(sources).toHaveLength(41);
    expect(new Set(sources.map(s => `${s.ref.owner}/${s.ref.repo}`)).size).toBe(41);
    for (const s of sources) {
      const repo = recordedEntry(BAHTRAKU, s.ref.repo).repo as { catalog: { latest: { commit_sha: string } } };
      expect(s.stage).toBe('latest');
      expect(s.revision).toEqual({ branch: 'master', sha: repo.catalog.latest.commit_sha });
    }
    expect(new Set(sources.map(s => s.metadata_format))).toEqual(new Set(['sb', 'rc']));
  });

  test('Q25: an unreleased repository is a source, marked as not released, with the books its default branch itemizes', async () => {
    const { sources } = await run({ owner: 'bahtraku', stage: 'latest' }, door43(answers));
    const loli = sources.find(s => s.ref.repo === 'PB-Loli-Edisi-Percobaan')!;
    expect(loli).toMatchObject({
      title: 'Perjanjian Baru Loli Edisi Percobaan',
      language: { code: 'wew-x-loli', title: 'Loli' },
      project_type: 'bible',
      metadata_format: 'sb',
      revision: { branch: 'master', sha: 'da7e16f8b864e8b2820c674853338d6612f76d8a' },
      released: false,
    });
    expect(loli.books).toHaveLength(27);
    expect(loli.books![0]).toEqual({ id: 'mat', title: 'Matthew' });
    expect(sources.filter(s => !s.released).map(s => s.ref.repo)).toEqual(['PB-Loli-Edisi-Percobaan']);
  });

  test('H3: a released repository whose default branch has the release commit offers the release\'s books for it', async () => {
    const { sources } = await run({ owner: 'bahtraku', stage: 'latest' }, door43(answers));
    expect(sources.find(s => s.ref.repo === 'PB-Adang-Edisi-Percobaan')).toMatchObject({
      revision: { branch: 'master', sha: '9068061de2c6bc811b6284c4f60d71e67414623f' },
      released: true,
    });
    expect(sources.find(s => s.ref.repo === 'PB-Adang-Edisi-Percobaan')?.books).toHaveLength(27);
  });

  test('H3, E62: when the default branch has moved since the release the entry describes, its books are null (unknown), not the release\'s, though E62 saw id_gst itemize alike at both', async () => {
    const [branch, release] = ['entry__bahtraku__id_gst__gst_master.json', 'entry__bahtraku__id_gst__gst_release.json'].map(
      name => JSON.parse(readFileSync(new URL(name, probes), 'utf8')) as { commit_sha: string; ingredients: unknown[] },
    );
    // One repository whose branch and release itemize alike is not a rule; the search answer says nothing about the branch's books.
    expect(branch!.commit_sha).not.toBe(release!.commit_sha);
    expect(branch!.ingredients).toEqual(release!.ingredients);
    const { sources } = await run({ owner: 'bahtraku', stage: 'latest' }, door43(answers));
    expect(sources.find(s => s.ref.repo === 'id_gst')).toMatchObject({
      metadata_format: 'rc',
      revision: { branch: 'master', sha: '1609d62c6f7fb1f02907bc7fe9c66d8d51ec8afa' },
      released: true,
      books: null,
    });
    expect(sources.find(s => s.ref.repo === 'id_obs')).toMatchObject({ project_type: 'obs', books: null });
  });
});

describe('what is never a source', () => {
  test('Q23: nothing outside the two flavors is returned, whatever the owner holds', async () => {
    const words = { ...recordedEntry(UNFOLDINGWORD, 'en_ult'), id: 9001, name: 'en_tw', flavor_type: 'peripheral', flavor: 'x-peripheralArticles' };
    const none = { ...recordedEntry(UNFOLDINGWORD, 'en_ust'), id: 9002, name: 'en_none', flavor: null };
    const search: Search = { ...UNFOLDINGWORD, data: [words, recordedEntry(UNFOLDINGWORD, 'en_obs'), none] };
    const { sources } = await run({ owner: 'unfoldingWord', stage: 'prod' }, door43({ 'unfoldingWord:prod': search }));
    expect(sources.map(s => s.ref.repo)).toEqual(['en_obs']);
  });

  test('E62: an owner with no catalog entries has no sources: Door43 answers it an empty list', async () => {
    const calls: string[] = [];
    expect((await run({ owner: 'zzqxnoowner', stage: 'latest' }, door43({}, calls))).sources).toEqual([]);
    expect(calls).toEqual(['/api/v1/catalog/search?owner=zzqxnoowner&flavor=textTranslation&flavor=textStories&stage=latest&page=1&limit=50']);
  });
});

describe('failures', () => {
  test('session_expired without a session, and Door43 is not asked', async () => {
    const calls: string[] = [];
    const error = await failure(sourceSearch({ owner: 'unfoldingWord', stage: 'prod' }, context(door43({}, calls), null)));
    expect(error).toBeInstanceOf(CatalogError);
    expect(error?.code).toBe('session_expired');
    expect(calls).toEqual([]);
  });

  test('validation_failed for a blank owner, and Door43 is not asked', async () => {
    const calls: string[] = [];
    const error = await failure(sourceSearch({ owner: '   ', stage: 'prod' }, context(door43({}, calls))));
    expect(error?.code).toBe('validation_failed');
    expect(error?.message).toContain('owner');
    expect(calls).toEqual([]);
  });

  test('door43_unavailable when Door43 fails, answers something that is not a list (null included, which E62 never saw), or repeats a page, never a partial list', async () => {
    const code = async (answer: Response | Search, empty?: unknown) =>
      (await failure(run({ owner: 'unfoldingWord', stage: 'prod' }, door43({ 'unfoldingWord:prod': answer }, [], empty))))?.code;
    expect(await code(new Response('', { status: 500 }))).toBe('door43_unavailable');
    expect(await code(Response.json({ ok: true, data: { not: 'a list' } }))).toBe('door43_unavailable');
    expect(await code(Response.json({ ok: true, data: null }))).toBe('door43_unavailable');
    expect(await code(UNFOLDINGWORD, { ok: true, data: null })).toBe('door43_unavailable');
    expect(await code(UNFOLDINGWORD, UNFOLDINGWORD)).toBe('door43_unavailable');
  });

  test('session_expired when Door43 refuses the token', async () => {
    const error = await failure(run({ owner: 'unfoldingWord', stage: 'prod' }, door43({ 'unfoldingWord:prod': new Response('', { status: 401 }) })));
    expect(error?.code).toBe('session_expired');
  });
});
