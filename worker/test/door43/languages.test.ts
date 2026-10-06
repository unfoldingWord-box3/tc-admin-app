// The language lists adapter (E25): Door43's entry shape mapped to glossary
// names, read strictly, and the owner-scoped list's `data: null` for an owner
// Door43 does not know.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import { door43Host } from '../../src/door43/host';
import { languageEntry, readLanguages, readOwnerLanguageCodes } from '../../src/door43/languages';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/2026-10-06/languages/', import.meta.url);
const recorded = <T>(name: string): T => (JSON.parse(readFileSync(new URL(name, fixtures), 'utf8')) as { response: { json: T } }).response.json;
const qa = door43Host('https://qa.door43.org');
const client = (fetch: Fetch) => ({ host: qa, token: 'test-only', fetch });

describe('one entry', () => {
  test('is mapped to code, title, English name, direction, and alternate names', () => {
    expect(languageEntry({ lc: 'ums', ln: 'Pendau', ang: 'Pendau', ld: 'ltr', alt: ['Ndaoe', 'Ndau', 'Umalasa'] })).toEqual({
      code: 'ums',
      title: 'Pendau',
      english: 'Pendau',
      direction: 'ltr',
      alternates: ['Ndaoe', 'Ndau', 'Umalasa'],
    });
    expect(languageEntry({ lc: 'ar', ln: 'العربية', ang: 'Arabic', ld: 'rtl', alt: [] })).toMatchObject({ direction: 'rtl' });
  });

  test('reads strictly: no tag or no native name is no entry; an unknown direction is null; non-strings are dropped', () => {
    expect(languageEntry({ ln: 'Nameless' })).toBeNull();
    expect(languageEntry({ lc: 'xx', ln: '' })).toBeNull();
    expect(languageEntry({ lc: ' xx ', ln: ' Name ', ang: 7, ld: 'ttb', alt: ['A', 3, '', null] })).toEqual({ code: 'xx', title: 'Name', english: '', direction: null, alternates: ['A'] });
  });
});

describe('the recorded lists (E25)', () => {
  const list = recorded<unknown[]>('langnames.json');
  const ownerList = (name: string) => recorded<unknown>(`catalog__list__languages__owner=${name}__stage=latest.json`);

  test('the full list is read from /languages/langnames.json with the session token and every entry is offered', async () => {
    const urls: string[] = [];
    const languages = await readLanguages(
      client(async (url, init) => {
        urls.push(url);
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-only');
        return Response.json(list);
      }),
    );
    expect(urls).toEqual(['https://qa.door43.org/api/v1/languages/langnames.json']);
    expect(languages).toHaveLength(9166);
    expect(languages.find(language => language.code === 'id')).toEqual({ code: 'id', title: 'Bahasa Indonesia', english: 'Indonesian', direction: 'ltr', alternates: [] });
    expect(languages.filter(language => language.direction === 'rtl')).toHaveLength(87);
    expect(languages.every(language => language.direction !== null)).toBe(true);
  });

  test('a list that is not a list is no languages, not a failure', async () => {
    expect(await readLanguages(client(async () => Response.json({ unexpected: true })))).toEqual([]);
  });

  test('an owner\'s languages are read from /catalog/list/languages with owner and stage=latest, as tags', async () => {
    const queries: string[] = [];
    const codes = await readOwnerLanguageCodes(
      client(async url => {
        const { pathname, searchParams } = new URL(url);
        expect(pathname).toBe('/api/v1/catalog/list/languages');
        queries.push(String(searchParams));
        return Response.json(ownerList('bahtraku'));
      }),
      'bahtraku',
    );
    expect(queries).toEqual(['owner=bahtraku&stage=latest']);
    expect(codes).toHaveLength(37);
    expect(codes).toContain('ums');
    expect(await readOwnerLanguageCodes(client(async () => Response.json(ownerList('tc-admin-qa-org'))), 'tc-admin-qa-org')).toEqual(['id']);
  });

  test('an owner Door43 does not know answers data: null, which is no languages', async () => {
    expect(ownerList('no-such-owner-xyz')).toEqual({ ok: true, data: null });
    expect(await readOwnerLanguageCodes(client(async () => Response.json(ownerList('no-such-owner-xyz'))), 'no-such-owner-xyz')).toEqual([]);
  });
});
