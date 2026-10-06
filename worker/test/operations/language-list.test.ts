// `language.list` (#28): every language Door43 lists, each marked with whether
// the Scripture Burrito schema accepts its tag (Q30), the owner's languages when
// an owner is named, and the read's freshness (P3).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { languageList } from '../../src/operations/language-list';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/2026-10-06/languages/', import.meta.url);
/** A recording, inflated when it is stored gzipped (the full list is 1.5 MB). */
const recorded = <T>(name: string): T => {
  const bytes = readFileSync(new URL(name, fixtures));
  return (JSON.parse((name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as { response: { json: T } }).response.json;
};
const list = recorded<unknown[]>('langnames.json.gz');
const owners: Record<string, unknown> = {
  'tc-admin-qa-org': recorded('catalog__list__languages__owner=tc-admin-qa-org__stage=latest.json'),
  bahtraku: recorded('catalog__list__languages__owner=bahtraku__stage=latest.json'),
};

const noPlans: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {} };
const NOW = new Date('2026-10-06T16:00:00.000Z');
let calls: string[];
const door43: Fetch = async url => {
  const { pathname, searchParams } = new URL(url);
  calls.push(pathname + (searchParams.size ? `?${searchParams}` : ''));
  if (pathname === '/api/v1/languages/langnames.json') return Response.json(list);
  if (pathname === '/api/v1/catalog/list/languages') return Response.json(owners[searchParams.get('owner') ?? ''] ?? { ok: true, data: null });
  return new Response('', { status: 404 });
};
const context = (token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', token, noPlans);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch: door43 } : null, now: () => NOW };
};
const parsed = (input: unknown) => OPERATIONS['language.list'].input.parse(input);

describe('language.list', () => {
  test('P3: lists every language with its tag, names, direction, and alternates, live, with its freshness, and no owner languages without an owner', async () => {
    calls = [];
    const output = OPERATIONS['language.list'].output.parse(await languageList(parsed({}), context()));
    expect(calls).toEqual(['/api/v1/languages/langnames.json']);
    expect(output.languages).toHaveLength(9166);
    expect(output.languages.find(language => language.code === 'ums')).toEqual({ code: 'ums', title: 'Pendau', english: 'Pendau', direction: 'ltr', alternates: ['Ndaoe', 'Ndau', 'Umalasa'], tag_accepted: true });
    expect(output.owner_languages).toBeNull();
    expect(output.freshness).toEqual({ read_at: '2026-10-06T16:00:00.000Z', source: 'live', age_seconds: 0 });
  });

  test('Q30: a tag the Scripture Burrito schema refuses is listed and marked, never silently dropped and never offered as accepted', async () => {
    calls = [];
    const { languages } = await languageList(parsed({}), context());
    const refused = languages.filter(language => !language.tag_accepted);
    expect(refused).toHaveLength(472);
    expect(refused.map(language => language.code)).toContain('xdy-x-dayaklaur');
    expect(languages.find(language => language.code === '-x-')).toMatchObject({ title: "Amarenga y'Ikinyarwanda", tag_accepted: false });
    expect(languages.find(language => language.code === 'bkr-x-pajuepat')?.tag_accepted).toBe(true);
  });

  test('with an owner, the owner\'s languages are read too and returned as tags', async () => {
    calls = [];
    const output = await languageList(parsed({ owner: ' bahtraku ' }), context());
    expect(calls).toEqual(['/api/v1/languages/langnames.json', '/api/v1/catalog/list/languages?owner=bahtraku&stage=latest']);
    expect(output.owner_languages).toHaveLength(37);
    expect(output.owner_languages).toContain('ums');
    expect((await languageList(parsed({ owner: 'tc-admin-qa-org' }), context())).owner_languages).toEqual(['id']);
    expect((await languageList(parsed({ owner: 'nobody-here' }), context())).owner_languages).toEqual([]);
    expect((await languageList(parsed({ owner: '' }), context())).owner_languages).toBeNull();
  });

  test('session_expired without a session, and Door43 is not asked', async () => {
    calls = [];
    const failure = await languageList(parsed({}), context(null)).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(CatalogError);
    expect((failure as CatalogError).code).toBe('session_expired');
    expect(calls).toEqual([]);
  });
});
