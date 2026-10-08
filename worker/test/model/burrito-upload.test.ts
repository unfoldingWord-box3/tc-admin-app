// The metadata an upload proposes (#74, product spec §8 "Metadata inference"):
// the default branch's metadata.json with the entries of the uploaded books or
// stories added or replaced, each carrying the size and md5 of the uploaded
// bytes (R10), written by the one metadata writer (W1) and valid against the
// recorded Scripture Burrito schema (E44); nothing else in the document moves.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import { METADATA_PATH, mergeUploadMetadata, metadataFile, newProjectFiles } from '../../src/model/burrito';
import { MetadataError, parseMetadata } from '../../src/model/burrito-reader';
import { confirmFile, identifyFile } from '../../src/model/upload';
import type { IdentifiedFile } from '../../src/model/upload';

const SCHEMA_DIR = new URL('../../../fixtures/scripture-burrito/2026-10-05/schema/', import.meta.url);
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
const encode = (text: string) => new TextEncoder().encode(text);
const zip = new Uint8Array(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip', import.meta.url)));

async function pendau() {
  const archive = openArchive(zip);
  return { archive, metadata: parseMetadata(await archive.bytes(METADATA_PATH)) };
}
const identified = (name: string, bytes: Uint8Array, type: 'bible' | 'obs' = 'bible'): IdentifiedFile => {
  const result = identifyFile({ name, bytes }, type);
  if (result.identified === null) throw new Error(`${name} did not identify: ${result.reason}`);
  return result;
};

describe('R10: the entries an upload proposes carry the size and md5 of the uploaded bytes', () => {
  test('R10, W1: over Pendau (E17), a replaced book keeps its entry with the new size and md5, a new book gets the writer\'s entry, and nothing else changes', async () => {
    const { archive, metadata } = await pendau();
    const mat = encode(new TextDecoder().decode(await archive.bytes('ingredients/MAT.usfm')).replace('\\v 1 ', '\\v 1 Revised: '));
    const gen = encode('\\id GEN\n\\c 1\n\\v 1 Pada mulanya\n');
    const { metadata: merged, entries } = mergeUploadMetadata(metadata, [identified('41-MAT.usfm', mat), identified('01-GEN.usfm', gen)]);

    expect(entries).toEqual([
      { path: 'ingredients/MAT.usfm', before: { checksum: { md5: '5ee344412572e540a257f79d80f8a126' }, mimeType: 'text/x-usfm', size: 154502, scope: { MAT: [] } }, after: { checksum: { md5: reference(mat) }, mimeType: 'text/x-usfm', size: mat.length, scope: { MAT: [] } } },
      { path: 'ingredients/GEN.usfm', before: null, after: { checksum: { md5: reference(gen) }, mimeType: 'text/x-usfm', size: gen.length, scope: { GEN: [] } } },
    ]);
    const ingredients = merged.ingredients as Record<string, unknown>;
    expect(ingredients['ingredients/MAT.usfm']).toEqual(entries[0]!.after);
    expect(ingredients['ingredients/GEN.usfm']).toEqual(entries[1]!.after);
    // Every other field and entry is the default branch's, as written; the scope and names are not touched (built behind, #74).
    const { ingredients: _merged, ...rest } = merged;
    const { ingredients: original, ...documentRest } = metadata.document as Record<string, unknown>;
    expect(rest).toEqual(documentRest);
    for (const [path, entry] of Object.entries(original as Record<string, unknown>)) if (path !== 'ingredients/MAT.usfm') expect(ingredients[path]).toEqual(entry);
    expect(Object.keys(ingredients)).toEqual([...Object.keys(original as object), 'ingredients/GEN.usfm']);
    // The writer is pure: the default branch's document is unchanged.
    expect((metadata.document.ingredients as Record<string, { size: number }>)['ingredients/MAT.usfm']!.size).toBe(154502);
    expect(validateSource(merged), JSON.stringify(validateSource.errors)).toBe(true);
  });

  test('R10, W1: a story added to an Open Bible Stories project gets a markdown entry with no scope, and the document stays valid', () => {
    const project = newProjectFiles(
      { owner: 'tc-admin-qa-org', repo_name: 'ums_obs', project_type: 'obs', testament_scope: null, title: 'Cerita', abbreviation: 'obs', language: { code: 'ums', title: 'Pendau' }, license: 'cc-by-sa-4.0' },
      { name: 'tC Admin', version: '0.1.0', user: { login: 'tc-admin-qa', name: 'tc-admin-qa' } },
      new Date('2026-10-07T12:00:00.000Z'),
    );
    const story = encode('# 1. Penciptaan\n');
    const { metadata, entries } = mergeUploadMetadata(parseMetadata(project.files[0]!.content), [identified('1.md', story, 'obs')]);
    expect(entries).toEqual([{ path: 'ingredients/content/01.md', before: null, after: { checksum: { md5: reference(story) }, mimeType: 'text/markdown', size: story.length } }]);
    expect(validateSource(metadata), JSON.stringify(validateSource.errors)).toBe(true);
  });

  test('R10: a confirmed file takes the entry of the unit confirmed, with its own bytes\' size and md5', async () => {
    const { metadata } = await pendau();
    const bytes = encode('\\id MAT\n\\c 1\n');
    const confirmed = confirmFile({ name: 'luke-draft.usfm', bytes }, { book: 'luk' }, 'bible');
    if (confirmed.identified === null) throw new Error('not confirmed');
    const { entries } = mergeUploadMetadata(metadata, [confirmed]);
    expect(entries[0]).toMatchObject({ path: 'ingredients/LUK.usfm', after: { checksum: { md5: reference(bytes) }, size: bytes.length, scope: { LUK: [] } } });
  });

  test('R10: metadata.json is written as two-space JSON with a final line feed, with the size and md5 of those bytes', () => {
    const file = metadataFile({ format: 'scripture burrito', ingredients: {} });
    expect(file.content).toBe('{\n  "format": "scripture burrito",\n  "ingredients": {}\n}\n');
    expect([file.path, file.size, file.md5]).toEqual([METADATA_PATH, file.bytes.length, reference(file.bytes)]);
  });
});

describe('R10: an upload never lists one book or story twice', () => {
  test('a book the metadata lists under another path, a path listed as another book, a unit of the other project type, or one unit twice is a MetadataError', async () => {
    const { metadata } = await pendau();
    const document = structuredClone(metadata.document) as { ingredients: Record<string, unknown> };
    document.ingredients['ingredients/41-MAT.usfm'] = document.ingredients['ingredients/MAT.usfm'];
    delete document.ingredients['ingredients/MAT.usfm'];
    const moved = parseMetadata(JSON.stringify(document));
    const mat = identified('MAT.usfm', encode('\\id MAT\n'));
    expect(() => mergeUploadMetadata(moved, [mat])).toThrow(MetadataError);
    expect(() => mergeUploadMetadata(moved, [mat])).toThrow('mat is listed at ingredients/41-MAT.usfm, not ingredients/MAT.usfm');

    const swapped = structuredClone(metadata.document) as { ingredients: Record<string, { scope?: unknown }> };
    swapped.ingredients['ingredients/MAT.usfm']!.scope = { MRK: [] };
    delete swapped.ingredients['ingredients/MRK.usfm'];
    expect(() => mergeUploadMetadata(parseMetadata(JSON.stringify(swapped)), [mat])).toThrow('ingredients/MAT.usfm is listed as mrk, not mat');

    expect(() => mergeUploadMetadata(metadata, [identified('01.md', encode('# 1\n'), 'obs')])).toThrow('01 is not a book of this project');
    expect(() => mergeUploadMetadata(metadata, [mat, mat])).toThrow('mat is added twice');
  });
});
