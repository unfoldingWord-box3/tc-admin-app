// The Scripture Burrito writer (#29, #82): a new project's metadata.json, a
// Bible or Open Bible Stories, validates against the recorded Scripture
// Burrito schema (W1, E37, E44), names tC Admin as generator, carries the
// scope of its type, and lists its one ingredient with the size and md5 of
// the bytes that will be written (R10).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, test } from 'vitest';
import { BIBLE_BOOKS, NEW_TESTAMENT, OLD_TESTAMENT } from '../../src/model/books';
import {
  DCS_AUTHORITY,
  LICENSE_PATH,
  METADATA_PATH,
  README_PATH,
  currentScope,
  newProjectFiles,
  repositoryName,
  validRepositoryName,
} from '../../src/model/burrito';
import type { Generator, NewProject } from '../../src/model/burrito';
import { OBS_SCOPE } from '../../src/model/obs-scope';

const SCHEMA_DIR = new URL('../../../fixtures/scripture-burrito/2026-10-05/schema/', import.meta.url);
/** References three files the upstream repository lacks, and nothing a source burrito needs reaches it (the fixture README). */
const UNREACHABLE = 'scripture_flavor_type.schema.json';

function schemaFiles(dir: URL): URL[] {
  return readdirSync(dir).flatMap(name => {
    const entry = new URL(name, dir);
    if (statSync(entry).isDirectory()) return schemaFiles(new URL(`${name}/`, dir));
    return name.endsWith('.schema.json') && name !== UNREACHABLE ? [entry] : [];
  });
}

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
for (const file of schemaFiles(SCHEMA_DIR)) ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')) as object);
const validateSource = ajv.getSchema('https://burrito.bible/schema/source_metadata.schema.json')!;

const reference = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');

const generator: Generator = { name: 'tC Admin', version: '0.1.0', user: { login: 'tc-admin-qa', name: 'tc-admin-qa' } };
/** Overrides a test may give: every field but the type and its scope, which `project` and `stories` set. */
type Overrides = Partial<{ owner: string; repo_name: string; title: string; abbreviation: string; language: NewProject['language']; testament_scope: 'nt' | 'ot' | 'full' }>;
const project = (extra: Overrides = {}): NewProject => ({
  owner: 'tc-admin-qa-org',
  repo_name: 'id_tcap',
  project_type: 'bible',
  title: 'Alkitab Percobaan',
  abbreviation: 'TCAP',
  language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' },
  testament_scope: 'nt',
  license: 'cc-by-sa-4.0',
  ...extra,
});
const stories = (extra: Omit<Overrides, 'testament_scope'> = {}): NewProject => ({
  ...project(),
  project_type: 'obs',
  testament_scope: null,
  repo_name: 'id_obs',
  title: 'Cerita Alkitab Terbuka',
  abbreviation: 'OBS',
  ...extra,
});
const now = new Date('2026-10-05T15:00:00.000Z');
const upper = (books: readonly string[]) => books.map(book => book.toUpperCase());

describe('the metadata of a new Bible project', () => {
  test.each(['nt', 'ot', 'full'] as const)('W1: the generated metadata.json validates against the Scripture Burrito source schema (scope %s)', scope => {
    const { metadata, files } = newProjectFiles(project({ testament_scope: scope }), generator, now);
    expect(validateSource(metadata), JSON.stringify(validateSource.errors, null, 2)).toBe(true);
    const written = JSON.parse(files.find(file => file.path === METADATA_PATH)!.content) as unknown;
    expect(written).toEqual(metadata);
    expect(validateSource(written)).toBe(true);
  });

  test('W1: tC Admin is the generator, as the signed-in manager, and the flavor is scripture/textTranslation with no relationships', () => {
    const { metadata } = newProjectFiles(project(), generator, now);
    expect(metadata).toMatchObject({
      format: 'scripture burrito',
      meta: {
        version: '1.0.0',
        category: 'source',
        generator: { softwareName: 'tC Admin', softwareVersion: '0.1.0', userId: 'dcs::tc-admin-qa', userName: 'tc-admin-qa' },
        dateCreated: '2026-10-05T15:00:00.000Z',
        defaultLocale: 'en',
        normalization: 'NFC',
      },
      identification: { name: { en: 'Alkitab Percobaan' }, abbreviation: { en: 'TCAP' } },
      confidential: false,
      languages: [{ tag: 'id', name: { en: 'Bahasa Indonesia' }, scriptDirection: 'ltr' }],
      type: { flavorType: { name: 'scripture', flavor: { name: 'textTranslation', projectType: 'standard', translationType: 'firstTranslation', audience: 'common', usfmVersion: '3.0' } } },
    });
    expect(metadata).not.toHaveProperty('relationships');
    expect(metadata).not.toHaveProperty('localizedNames');
  });

  test('currentScope lists exactly the books of the testament scope, uppercase, in canonical order, each unrestricted', () => {
    expect(Object.keys(currentScope('nt'))).toEqual(upper(NEW_TESTAMENT));
    expect(Object.keys(currentScope('ot'))).toEqual(upper(OLD_TESTAMENT));
    expect(Object.keys(currentScope('full'))).toEqual(upper(BIBLE_BOOKS));
    expect(Object.keys(currentScope('nt'))).toHaveLength(27);
    expect(Object.keys(currentScope('ot'))).toHaveLength(39);
    expect(Object.keys(currentScope('full'))).toHaveLength(66);
    expect(Object.values(currentScope('full')).every(chapters => chapters.length === 0)).toBe(true);
    const { metadata } = newProjectFiles(project({ testament_scope: 'ot' }), generator, now);
    expect(Object.keys((metadata.type as { flavorType: { currentScope: object } }).flavorType.currentScope)).toEqual(upper(OLD_TESTAMENT));
  });

  test('E24: the dcs authority is declared without a trailing slash, and the primary identification names the repository under it', () => {
    expect(DCS_AUTHORITY.id).toBe('https://git.door43.org');
    const { metadata } = newProjectFiles(project(), generator, now);
    expect(metadata).toMatchObject({
      idAuthorities: { dcs: { id: 'https://git.door43.org', name: { en: 'Door43 Content Service' } } },
      identification: { primary: { dcs: { 'tc-admin-qa-org/id_tcap': { revision: 'master', timestamp: '2026-10-05T15:00:00.000Z' } } } },
    });
  });

  test('scriptDirection is written only when the language direction is known', () => {
    const { metadata } = newProjectFiles(project({ language: { code: 'ums', title: 'Pendau' } }), generator, now);
    expect((metadata.languages as object[])[0]).toEqual({ tag: 'ums', name: { en: 'Pendau' } });
    expect(validateSource(metadata)).toBe(true);
  });
});

describe('the metadata of a new Open Bible Stories project (#82)', () => {
  const myOrg = JSON.parse(readFileSync(new URL('../../../fixtures/door43/git.door43.org/2026-10-05/raw/MyOrg__en_obs__main__metadata.json', import.meta.url), 'utf8')) as {
    type: { flavorType: { currentScope: Record<string, string[]> } };
  };
  const enObs = JSON.parse(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-10-01/sb-archives/unfoldingWord__en_obs__v9.metadata.json', import.meta.url), 'utf8')) as {
    type: { flavorType: { currentScope: Record<string, string[]> } };
  };

  test('W1: the generated metadata.json validates against the Scripture Burrito source schema with the flavor gloss/textStories', () => {
    const { metadata, files } = newProjectFiles(stories(), generator, now);
    expect(validateSource(metadata), JSON.stringify(validateSource.errors, null, 2)).toBe(true);
    expect(validateSource(JSON.parse(files[0]!.content))).toBe(true);
    expect(metadata).toMatchObject({ type: { flavorType: { name: 'gloss', flavor: { name: 'textStories' } } } });
    expect((metadata.type as { flavorType: { flavor: object } }).flavorType.flavor).toEqual({ name: 'textStories' });
    expect(metadata).not.toHaveProperty('relationships');
  });

  test('E46: currentScope is the fixed scope Door43 writes for every Open Bible Stories repository: MyOrg/en_obs and unfoldingWord/en_obs v9 (E36) alike, 33 books', () => {
    expect(OBS_SCOPE).toEqual(myOrg.type.flavorType.currentScope);
    expect(OBS_SCOPE).toEqual(enObs.type.flavorType.currentScope);
    expect(Object.keys(OBS_SCOPE)).toHaveLength(33);
    const { metadata } = newProjectFiles(stories(), generator, now);
    expect((metadata.type as { flavorType: { currentScope: object } }).flavorType.currentScope).toEqual(OBS_SCOPE);
  });

  test('the rest of the file is as for a Bible: generator, authority, identification, the one license ingredient, and the README names Open Bible Stories', () => {
    const { metadata, files } = newProjectFiles(stories(), generator, now);
    expect(metadata).toMatchObject({
      meta: { generator: { softwareName: 'tC Admin' } },
      idAuthorities: { dcs: DCS_AUTHORITY },
      identification: { name: { en: 'Cerita Alkitab Terbuka' }, abbreviation: { en: 'OBS' }, primary: { dcs: { 'tc-admin-qa-org/id_obs': { revision: 'master' } } } },
      copyright: { licenses: [{ ingredient: LICENSE_PATH }] },
    });
    expect(Object.keys(metadata.ingredients as object)).toEqual([LICENSE_PATH]);
    expect(files.find(file => file.path === README_PATH)!.content).toContain('OBS · Bahasa Indonesia (id) · Open Bible Stories');
  });
});

describe('the files of the first commit', () => {
  test('R10: the license ingredient is the CC BY-SA 4.0 text Scribe writes, with the size and md5 of the file, and is the only ingredient, named in copyright.licenses', () => {
    const { metadata, files } = newProjectFiles(project(), generator, now);
    const license = files.find(file => file.path === LICENSE_PATH)!;
    // Scribe's license ingredient in bahtraku/Perjanjian-Baru-Pendau (E17, the recorded metadata).
    expect(license.size).toBe(18535);
    expect(license.md5).toBe('0bf7ef1533f6486c8362dcb8bc19bdd1');
    expect(license.md5).toBe(reference(license.bytes));
    expect(license.content.startsWith('# Creative Commons Attribution-ShareAlike 4.0 International')).toBe(true);
    expect(metadata.ingredients).toEqual({
      [LICENSE_PATH]: { checksum: { md5: license.md5 }, mimeType: 'text/markdown', size: license.size, role: 'x-license' },
    });
    expect(metadata.copyright).toEqual({ licenses: [{ ingredient: LICENSE_PATH }] });
  });

  test('R10: every file carries the size and md5 of the bytes that will be written', () => {
    const { files } = newProjectFiles(project(), generator, now);
    expect(files.map(file => file.path)).toEqual([METADATA_PATH, LICENSE_PATH, README_PATH]);
    for (const file of files) {
      expect(file.bytes).toEqual(new TextEncoder().encode(file.content));
      expect(file.size, file.path).toBe(file.bytes.length);
      expect(file.md5, file.path).toBe(reference(file.bytes));
    }
  });

  test('the README names the project in glossary words and is not an ingredient', () => {
    const { metadata, files } = newProjectFiles(project(), generator, now);
    const readme = files.find(file => file.path === README_PATH)!;
    expect(readme.content).toContain('# Alkitab Percobaan');
    expect(readme.content).toContain('TCAP · Bahasa Indonesia (id) · Bible');
    expect(Object.keys(metadata.ingredients as object)).not.toContain(README_PATH);
    expect(Object.keys(metadata.ingredients as object)).not.toContain(METADATA_PATH);
  });

  test('the metadata file is pretty-printed JSON ending in a newline', () => {
    const { metadata, files } = newProjectFiles(project(), generator, now);
    expect(files[0]!.content).toBe(`${JSON.stringify(metadata, null, 2)}\n`);
  });
});

describe('the repository name', () => {
  test('is <language>_<abbreviation> in lowercase', () => {
    expect(repositoryName('en', 'ULT')).toBe('en_ult');
    expect(repositoryName('es-419', ' Reg ')).toBe('es-419_reg');
    expect(repositoryName('ID', 'TB1')).toBe('id_tb1');
  });

  test('is valid when Door43 would accept it', () => {
    expect(validRepositoryName('en_ult')).toBe(true);
    expect(validRepositoryName('es-419_reg.v2')).toBe(true);
    expect(validRepositoryName('en_my ult')).toBe(false);
    expect(validRepositoryName('.en_ult')).toBe(false);
    expect(validRepositoryName('en_ult.git')).toBe(false);
    expect(validRepositoryName('en_')).toBe(true);
    expect(validRepositoryName('')).toBe(false);
    expect(validRepositoryName('a'.repeat(101))).toBe(false);
  });
});
