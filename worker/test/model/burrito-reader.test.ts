// The Scripture Burrito reader (#17): every recorded metadata.json reads, in
// all four formats (E1) and Open Bible Stories (E36), and what tC Admin writes
// reads back; ingredients are classified as book, story, or administrative.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import { newProjectFiles } from '../../src/model/burrito';
import { OBS_SCOPE } from '../../src/model/obs-scope';
import { coverage } from '../../src/model/project';
import { MetadataError, administrativeIngredients, classifyIngredient, parseMetadata, readMetadata, unitIngredients } from '../../src/model/burrito-reader';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, fixtures), 'utf8');
const FILES = {
  sb: '2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.metadata.json',
  rc: '2026-09-21/sb-archives/bahtraku__id_tb1__master.metadata.json',
  ts: '2026-10-07/sb-archives/birch__es-419_tit_text_reg__master.metadata.json',
  tc: '2026-10-07/sb-archives/birch__en_web_mrk_book__master.metadata.json',
  obs: '2026-10-01/sb-archives/unfoldingWord__en_obs__v9.metadata.json',
} as const;

describe('Open Bible Stories in its archive (E36, #83)', () => {
  test('H5, E36: en_obs v9\'s archive holds the 50 stories at ingredients/content/<NN>.md, front.md and back.md are administrative, and coverage reads 50 of 50 with nothing missing', async () => {
    const archive = openArchive(new Uint8Array(readFileSync(new URL('2026-10-01/sb-archives/unfoldingWord__en_obs__v9.zip', fixtures))));
    const metadata = parseMetadata(await archive.bytes('metadata.json'));
    const stories = [...unitIngredients(metadata).values()];
    const paths = new Set(archive.entries.map(entry => entry.path));
    expect(stories.map(story => story.path).sort()).toEqual(Array.from({ length: 50 }, (_, i) => `ingredients/content/${String(i + 1).padStart(2, '0')}.md`));
    expect(stories.every(story => paths.has(story.path))).toBe(true);
    expect(administrativeIngredients(metadata).map(ingredient => ingredient.path)).toEqual(expect.arrayContaining(['ingredients/content/front.md', 'ingredients/content/back.md']));
    // Coverage from the archive, as a commit's receipt counts it (basis archive): each listed story present when the archive holds its path.
    const ingredients = stories.map(story => ({ id: story.unit!, path: story.path, exists: paths.has(story.path), is_dir: false, title: '' }));
    const counted = coverage({ flavor: 'textStories', metadata_format: 'sb', ingredients }, 'obs');
    expect(counted).toMatchObject({ present: 50, target: 50, scope: 'obs' });
    expect(counted.units.every(unit => unit.present)).toBe(true);
  });
});

describe('the recorded files', () => {
  test.each([
    ['sb', 'Scribe', 'bible', 27, ['ingredients/versification.json', 'ingredients/license.md', 'ingredients/scribe-settings.json'], 27],
    ['rc', 'go-rc2sb', 'bible', 66, ['ingredients/LICENSE.md'], 66],
    ['ts', 'go-rc2sb', 'bible', 1, ['ingredients/LICENSE.md'], 1],
    ['tc', 'go-rc2sb', 'bible', 1, ['ingredients/LICENSE.md'], 1],
    ['obs', 'go-rc2sb', 'obs', 50, ['ingredients/LICENSE.md', 'ingredients/content/back.md', 'ingredients/content/front.md'], 33],
  ] as const)('%s, written by %s: a %s project with its books or stories, its administrative ingredients, and its scope', (format, generator, type, units, administrative, scopeBooks) => {
    const metadata = parseMetadata(read(FILES[format]));
    expect(metadata.format).toBe('scripture burrito');
    expect(metadata.generator?.name).toBe(generator);
    expect(metadata.project_type).toBe(type);
    expect(metadata.flavor).toBe(type === 'obs' ? 'textStories' : 'textTranslation');
    expect(unitIngredients(metadata).size).toBe(units);
    expect(administrativeIngredients(metadata).map(ingredient => ingredient.path).sort()).toEqual([...administrative].sort());
    expect(metadata.ingredients.filter(ingredient => ingredient.kind === 'other')).toEqual([]);
    expect(Object.keys(metadata.current_scope)).toHaveLength(scopeBooks);
    expect(metadata.languages).toHaveLength(1);
    expect(metadata.identification.primary).not.toBeNull();
  });

  test('a Bible book carries its scope and the size and md5 as written (E5: possibly stale, never trusted, R10)', () => {
    const metadata = parseMetadata(read(FILES.sb));
    expect(unitIngredients(metadata).get('mat')).toEqual({
      path: 'ingredients/MAT.usfm',
      size: 154502,
      md5: '5ee344412572e540a257f79d80f8a126',
      mime_type: 'text/x-usfm',
      role: null,
      scope: { MAT: [] },
      kind: 'book',
      unit: 'mat',
    });
    expect(metadata.ingredients.find(ingredient => ingredient.path === 'ingredients/versification.json')).toMatchObject({ kind: 'administrative', unit: null, role: 'x-versification', scope: null });
    expect(metadata.identification).toEqual({
      name: { en: 'Perjanjian Baru Pendau' },
      abbreviation: { en: 'PBP' },
      description: {},
      primary: { authority: 'scribe', ids: [{ id: '82c767d9-8f1a-5fa4-87e8-7e45a25dcf8d', revision: '2', timestamp: '2026-07-08T17:02:31+09:00' }] },
    });
    expect(metadata.languages).toEqual([{ tag: 'ums', name: { en: 'Pendau' }, direction: 'ltr' }]);
    expect(metadata.current_scope.MAT).toEqual([]);
    expect(metadata.document.copyright).toEqual({ licenses: [{ ingredient: 'license.md' }] });
  });

  test('E36: a story is ingredients/content/<NN>.md, and its scope names the passages it draws on, not the story', () => {
    const metadata = parseMetadata(read(FILES.obs));
    const first = unitIngredients(metadata).get('01');
    expect(first).toMatchObject({ path: 'ingredients/content/01.md', kind: 'story', unit: '01', scope: { GEN: ['1-2'] }, mime_type: 'text/markdown' });
    expect(unitIngredients(metadata).get('50')?.path).toBe('ingredients/content/50.md');
    expect(metadata.ingredients.find(ingredient => ingredient.path === 'ingredients/content/front.md')).toMatchObject({ kind: 'administrative', scope: null });
    expect(metadata.identification.primary).toEqual({ authority: 'dcs', ids: [{ id: 'unfoldingWord/en_obs', revision: 'd39a1dc7a7557ac54e4a8fecc3462147fe7eec3b', timestamp: '2026-10-01T16:28:34.503Z' }] });
    expect(metadata.current_scope['1KI']).toEqual(['1-6', '11-12', '16-18']);
  });

  test('the converted Resource Container Bible keys its primary id by the original repository with the commit as revision (E17)', () => {
    const metadata = parseMetadata(read(FILES.rc));
    expect(metadata.identification.primary).toEqual({ authority: 'dcs', ids: [{ id: 'Indonesian-Bible-Society/id_tb1', revision: '6ac2aeb0dbaf97f1d71278c8ac4e5d5dc170dd6f', timestamp: '2026-09-21T13:49:36.139Z' }] });
    expect(metadata.identification.description).toEqual({ en: 'Alkitab Terjemahan Baru' });
    expect(unitIngredients(metadata).get('gen')).toMatchObject({ path: 'ingredients/GEN.usfm', mime_type: 'text/plain' });
    expect(metadata.document.localizedNames).toHaveProperty('book-gen');
  });

  test('metadata read straight from an archive is the same as the file beside it', async () => {
    const archive = openArchive(new Uint8Array(readFileSync(new URL('2026-10-07/sb-archives/birch__en_web_mrk_book__master.zip', fixtures))));
    const metadata = parseMetadata(await archive.bytes('metadata.json'));
    expect(metadata).toEqual(parseMetadata(read(FILES.tc)));
    expect(unitIngredients(metadata).get('mrk')?.size).toBe(archive.entries.find(entry => entry.path === 'ingredients/MRK.usfm')?.size);
  });
});

describe('what tC Admin writes', () => {
  const generator = { name: 'tC Admin', version: '0.1.0', user: { login: 'tc-admin-qa', name: 'tc-admin-qa' } };
  const base = { owner: 'tc-admin-qa-org', repo_name: 'id_tcap', title: 'Alkitab Percobaan', abbreviation: 'TCAP', language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' as const }, license: 'cc-by-sa-4.0' as const };

  test('W1: a new Bible and a new Open Bible Stories project read back as written: the license as the one administrative ingredient, the scope of the type', () => {
    const bible = parseMetadata(newProjectFiles({ ...base, project_type: 'bible', testament_scope: 'nt' }, generator, new Date('2026-10-05T15:00:00Z')).files[0]!.content);
    expect(bible).toMatchObject({ project_type: 'bible', flavor_type: 'scripture', flavor: 'textTranslation', generator: { name: 'tC Admin', version: '0.1.0' } });
    expect(bible.ingredients).toEqual([{ path: 'ingredients/license.md', size: 18535, md5: '0bf7ef1533f6486c8362dcb8bc19bdd1', mime_type: 'text/markdown', role: 'x-license', scope: null, kind: 'administrative', unit: null }]);
    expect(Object.keys(bible.current_scope)).toHaveLength(27);
    expect(bible.identification.primary).toEqual({ authority: 'dcs', ids: [{ id: 'tc-admin-qa-org/id_tcap', revision: 'main', timestamp: '2026-10-05T15:00:00.000Z' }] });
    const stories = parseMetadata(newProjectFiles({ ...base, project_type: 'obs', testament_scope: null, abbreviation: 'OBS', repo_name: 'id_obs' }, generator, new Date()).files[0]!.content);
    expect(stories).toMatchObject({ project_type: 'obs', flavor: 'textStories' });
    expect(unitIngredients(stories).size).toBe(0);
    expect(stories.current_scope).toEqual(OBS_SCOPE);
    expect(administrativeIngredients(stories)).toHaveLength(1);
  });
});

describe('classification and refusals', () => {
  test('a book needs a scope naming exactly one book; a story its numbered path; no scope is administrative; a many-book scope is other', () => {
    expect(classifyIngredient('ingredients/MAT.usfm', { MAT: [] }, 'bible')).toEqual({ kind: 'book', unit: 'mat' });
    expect(classifyIngredient('anything.usfm', { JON: ['1-2'] }, 'bible')).toEqual({ kind: 'book', unit: 'jon' });
    expect(classifyIngredient('ingredients/license.md', null, 'bible')).toEqual({ kind: 'administrative', unit: null });
    expect(classifyIngredient('ingredients/bible.usfm', { GEN: [], EXO: [] }, 'bible')).toEqual({ kind: 'other', unit: null });
    expect(classifyIngredient('ingredients/x.usfm', { XYZ: [] }, 'bible')).toEqual({ kind: 'other', unit: null });
    expect(classifyIngredient('ingredients/content/07.md', { GEN: ['1'] }, 'obs')).toEqual({ kind: 'story', unit: '07' });
    expect(classifyIngredient('ingredients/content/7.md', null, 'obs')).toEqual({ kind: 'story', unit: '07' });
    expect(classifyIngredient('ingredients/content/51.md', null, 'obs')).toEqual({ kind: 'administrative', unit: null });
    expect(classifyIngredient('ingredients/content/front.md', { GEN: ['1'] }, 'obs')).toEqual({ kind: 'other', unit: null });
    expect(classifyIngredient('ingredients/MAT.usfm', { MAT: [] }, 'other')).toEqual({ kind: 'other', unit: null });
  });

  test('a document that is not Scripture Burrito tC Admin can read is a MetadataError that says why', () => {
    expect(() => readMetadata(null)).toThrow(MetadataError);
    expect(() => readMetadata({ format: 'resource container' })).toThrow(/format is "resource container"/);
    expect(() => readMetadata({ format: 'scripture burrito', ingredients: {} })).toThrow(/no type.flavorType/);
    expect(() => readMetadata({ format: 'scripture burrito', type: { flavorType: { name: 'scripture', flavor: { name: 'textTranslation' } } } })).toThrow(/no ingredients/);
    expect(() => parseMetadata('{not json')).toThrow(/not JSON/);
    // Structure is refused, never coerced: a bad scope, a non-object entry, a primary that is not one id, bytes that are not UTF-8.
    const type = { flavorType: { name: 'scripture', flavor: { name: 'textTranslation' } } };
    expect(() => readMetadata({ format: 'scripture burrito', type, ingredients: { 'ingredients/MAT.usfm': { scope: { MAT: 'bad' } } } })).toThrow(/scope\.MAT is not an array of strings/);
    expect(() => readMetadata({ format: 'scripture burrito', type, ingredients: { 'ingredients/MAT.usfm': { scope: 'MAT' } } })).toThrow(/scope is not an object/);
    expect(() => readMetadata({ format: 'scripture burrito', type: { flavorType: { ...type.flavorType, currentScope: ['MAT'] } }, ingredients: {} })).toThrow(/currentScope is not an object/);
    expect(() => readMetadata({ format: 'scripture burrito', type, ingredients: { 'a.usfm': 'not an entry' } })).toThrow(/ingredient "a.usfm" is not an object/);
    expect(() => readMetadata({ format: 'scripture burrito', type, identification: { primary: { a: { x: {} }, b: { y: {} } } }, ingredients: {} })).toThrow(/exactly one authority/);
    expect(() => readMetadata({ format: 'scripture burrito', type, identification: { primary: { dcs: {} } }, ingredients: {} })).toThrow(/at least one id/);
    // Several ids under the one authority are schema-valid (E44) and are all kept, none chosen (bench round 2).
    const several = readMetadata({ format: 'scripture burrito', type, identification: { primary: { dcs: { 'a/b': { revision: '1' }, 'c/d': { revision: '2', timestamp: 't' } } } }, ingredients: {} });
    expect(several.identification.primary).toEqual({ authority: 'dcs', ids: [{ id: 'a/b', revision: '1', timestamp: null }, { id: 'c/d', revision: '2', timestamp: 't' }] });
    expect(() => parseMetadata(new Uint8Array([0x7b, 0xff, 0x7d]))).toThrow(/not UTF-8/);
    const twice = readMetadata({ format: 'scripture burrito', type: { flavorType: { name: 'gloss', flavor: { name: 'textStories' } } }, ingredients: { 'ingredients/content/7.md': {}, 'ingredients/content/07.md': {} } });
    expect(() => unitIngredients(twice)).toThrow(/both 07/);
    // Lenient where the schema is optional: no identification, no languages, no scope, an odd size.
    const sparse = readMetadata({ format: 'scripture burrito', type, ingredients: { 'ingredients/MAT.usfm': { scope: { MAT: [] }, size: -1 } } });
    expect(sparse.identification).toEqual({ name: {}, abbreviation: {}, description: {}, primary: null });
    expect(sparse.languages).toEqual([]);
    expect(sparse.generator).toBeNull();
    expect(sparse.current_scope).toEqual({});
    expect(sparse.ingredients).toEqual([{ path: 'ingredients/MAT.usfm', size: null, md5: null, mime_type: null, role: null, scope: { MAT: [] }, kind: 'book', unit: 'mat' }]);
  });
});
