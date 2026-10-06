// The Scripture Burrito writer (#29): a new Bible project's metadata.json
// validates against the recorded Scripture Burrito schema (W1, E37, E44),
// names tC Admin as generator, and lists its one ingredient with the size and
// md5 of the bytes that will be written (R10).
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
  newBibleProjectFiles,
  repositoryName,
  validRepositoryName,
} from '../../src/model/burrito';
import type { Generator, NewBibleProject } from '../../src/model/burrito';

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
const project = (extra: Partial<NewBibleProject> = {}): NewBibleProject => ({
  owner: 'tc-admin-qa-org',
  repo_name: 'id_tcap',
  title: 'Alkitab Percobaan',
  abbreviation: 'TCAP',
  language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' },
  testament_scope: 'nt',
  license: 'cc-by-sa-4.0',
  ...extra,
});
const now = new Date('2026-10-05T15:00:00.000Z');
const upper = (books: readonly string[]) => books.map(book => book.toUpperCase());

describe('the metadata of a new Bible project', () => {
  test.each(['nt', 'ot', 'full'] as const)('W1: the generated metadata.json validates against the Scripture Burrito source schema (scope %s)', scope => {
    const { metadata, files } = newBibleProjectFiles(project({ testament_scope: scope }), generator, now);
    expect(validateSource(metadata), JSON.stringify(validateSource.errors, null, 2)).toBe(true);
    const written = JSON.parse(files.find(file => file.path === METADATA_PATH)!.content) as unknown;
    expect(written).toEqual(metadata);
    expect(validateSource(written)).toBe(true);
  });

  test('W1: tC Admin is the generator, as the signed-in manager, and the flavor is scripture/textTranslation with no relationships', () => {
    const { metadata } = newBibleProjectFiles(project(), generator, now);
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
    const { metadata } = newBibleProjectFiles(project({ testament_scope: 'ot' }), generator, now);
    expect(Object.keys((metadata.type as { flavorType: { currentScope: object } }).flavorType.currentScope)).toEqual(upper(OLD_TESTAMENT));
  });

  test('E24: the dcs authority is declared without a trailing slash, and the primary identification names the repository under it', () => {
    expect(DCS_AUTHORITY.id).toBe('https://git.door43.org');
    const { metadata } = newBibleProjectFiles(project(), generator, now);
    expect(metadata).toMatchObject({
      idAuthorities: { dcs: { id: 'https://git.door43.org', name: { en: 'Door43 Content Service' } } },
      identification: { primary: { dcs: { 'tc-admin-qa-org/id_tcap': { revision: 'master', timestamp: '2026-10-05T15:00:00.000Z' } } } },
    });
  });

  test('scriptDirection is written only when the language direction is known', () => {
    const { metadata } = newBibleProjectFiles(project({ language: { code: 'ums', title: 'Pendau' } }), generator, now);
    expect((metadata.languages as object[])[0]).toEqual({ tag: 'ums', name: { en: 'Pendau' } });
    expect(validateSource(metadata)).toBe(true);
  });
});

describe('the files of the first commit', () => {
  test('R10: the license ingredient is the CC BY-SA 4.0 text Scribe writes, with the size and md5 of the file, and is the only ingredient, named in copyright.licenses', () => {
    const { metadata, files } = newBibleProjectFiles(project(), generator, now);
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
    const { files } = newBibleProjectFiles(project(), generator, now);
    expect(files.map(file => file.path)).toEqual([METADATA_PATH, LICENSE_PATH, README_PATH]);
    for (const file of files) {
      expect(file.bytes).toEqual(new TextEncoder().encode(file.content));
      expect(file.size, file.path).toBe(file.bytes.length);
      expect(file.md5, file.path).toBe(reference(file.bytes));
    }
  });

  test('the README names the project in glossary words and is not an ingredient', () => {
    const { metadata, files } = newBibleProjectFiles(project(), generator, now);
    const readme = files.find(file => file.path === README_PATH)!;
    expect(readme.content).toContain('# Alkitab Percobaan');
    expect(readme.content).toContain('TCAP · Bahasa Indonesia (id) · Bible');
    expect(Object.keys(metadata.ingredients as object)).not.toContain(README_PATH);
    expect(Object.keys(metadata.ingredients as object)).not.toContain(METADATA_PATH);
  });

  test('the metadata file is pretty-printed JSON ending in a newline', () => {
    const { metadata, files } = newBibleProjectFiles(project(), generator, now);
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
