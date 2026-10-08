// The metadata an import proposes (#79, product spec §8 "Import from an
// existing repository"): what an upload proposes for the imported books or
// stories (R10), plus one `source` relationship for the source repository and
// revision and the `dcs` authority it refers to (E24), written by the one
// metadata writer (W1) and valid against the recorded Scripture Burrito schema
// (E44), whose relationship schema allows a `source` only `textTranslation`,
// `audioTranslation`, or a custom `x-` flavor (Q34).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import { DCS_AUTHORITY, METADATA_PATH, SOURCE_RELATIONSHIP_FLAVOR, mergeImportMetadata, newProjectFiles, sourceRelationship } from '../../src/model/burrito';
import { MetadataError, parseMetadata } from '../../src/model/burrito-reader';
import { identifyFile } from '../../src/model/upload';
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
const validateRelationship = ajv.getSchema('https://burrito.bible/schema/relationship.schema.json')!;

const reference = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const encode = (text: string) => new TextEncoder().encode(text);
const zip = new Uint8Array(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip', import.meta.url)));
const pendau = async () => parseMetadata(await openArchive(zip).bytes(METADATA_PATH));
const identified = (name: string, bytes: Uint8Array, type: 'bible' | 'obs' = 'bible'): IdentifiedFile => {
  const result = identifyFile({ name, bytes }, type);
  if (result.identified === null) throw new Error(`${name} did not identify: ${result.reason}`);
  return result;
};
const obsProject = () =>
  parseMetadata(
    newProjectFiles(
      { owner: 'tc-admin-qa-org', repo_name: 'ums_obs', project_type: 'obs', testament_scope: null, title: 'Cerita', abbreviation: 'OBS', language: { code: 'ums', title: 'Pendau' }, license: 'cc-by-sa-4.0' },
      { name: 'tC Admin', version: '0.1.0', user: { login: 'tc-admin-qa', name: 'tc-admin-qa' } },
      new Date('2026-10-07T12:00:00.000Z'),
    ).files[0]!.content,
  );
const TB1 = { owner: 'bahtraku', repo: 'id_tb1', revision: '1974' };

describe('E24, W1: an import adds one source relationship and the dcs authority, and the document stays valid', () => {
  test('R10, W1: over Pendau (E17), the imported books\' entries are an upload\'s, the relationship names the source and revision, and the document validates', async () => {
    const metadata = await pendau();
    const gen = encode('\\id GEN\n\\c 1\n\\v 1 Pada mulanya\n');
    const { metadata: merged, entries, relationships } = mergeImportMetadata(metadata, [identified('GEN.usfm', gen)], TB1);
    expect(entries).toEqual([{ path: 'ingredients/GEN.usfm', before: null, after: { checksum: { md5: reference(gen) }, mimeType: 'text/x-usfm', size: gen.length, scope: { GEN: [] } } }]);
    expect(relationships).toEqual([{ id: 'dcs::bahtraku/id_tb1', relationType: 'source', flavor: 'textTranslation', revision: '1974' }]);
    expect(merged.relationships).toEqual(relationships);
    expect(validateSource(merged), JSON.stringify(validateSource.errors)).toBe(true);
    // Pendau, written by Scribe, declares the `scribe` authority only (E17): `dcs` is added beside it, and `scribe` kept as written.
    expect(merged.idAuthorities).toEqual({ ...(metadata.document.idAuthorities as object), dcs: DCS_AUTHORITY });
    expect(Object.keys(merged.idAuthorities as object)).toEqual(['scribe', 'dcs']);
    // Nothing else moves: every other top-level field is the default branch's.
    const { ingredients: _a, relationships: _b, idAuthorities: _d, ...rest } = merged;
    const { ingredients: _c, idAuthorities: _e, ...documentRest } = metadata.document as Record<string, unknown>;
    expect(rest).toEqual(documentRest);
    expect(metadata.document.relationships).toBeUndefined();
  });

  test('E24: a document without the dcs authority gains it as tC Admin spells it; one that spells it otherwise keeps its own', async () => {
    const metadata = await pendau();
    const without = structuredClone(metadata.document) as Record<string, unknown>;
    delete without.idAuthorities;
    const added = mergeImportMetadata(parseMetadata(JSON.stringify(without)), [identified('GEN.usfm', encode('\\id GEN\n'))], TB1).metadata;
    expect(added.idAuthorities).toEqual({ dcs: DCS_AUTHORITY });
    // The writer is pure: the default branch's authorities are not written to when dcs is added beside them.
    const before = structuredClone(metadata.document.idAuthorities);
    mergeImportMetadata(metadata, [identified('GEN.usfm', encode('\\id GEN\n'))], TB1);
    expect(metadata.document.idAuthorities).toEqual(before);
    expect(Object.keys(metadata.document.idAuthorities as object)).toEqual(['scribe']);
    expect(validateSource(added), JSON.stringify(validateSource.errors)).toBe(true);

    const slash = structuredClone(metadata.document) as { idAuthorities: Record<string, unknown> };
    slash.idAuthorities = { dcs: { id: 'https://git.door43.org/', name: { en: 'Door43 Content Service' } } };
    const kept = mergeImportMetadata(parseMetadata(JSON.stringify(slash)), [identified('GEN.usfm', encode('\\id GEN\n'))], TB1).metadata;
    expect(kept.idAuthorities).toEqual(slash.idAuthorities);
  });

  test('E24: a relationship the document already lists, field for field, is not added again; a different revision of the same source is', async () => {
    const metadata = await pendau();
    const first = mergeImportMetadata(metadata, [identified('GEN.usfm', encode('\\id GEN\n'))], TB1).metadata;
    const again = mergeImportMetadata(parseMetadata(JSON.stringify(first)), [identified('EXO.usfm', encode('\\id EXO\n'))], TB1);
    expect(again.relationships).toEqual([]);
    expect(again.metadata.relationships).toHaveLength(1);
    const later = mergeImportMetadata(parseMetadata(JSON.stringify(first)), [identified('EXO.usfm', encode('\\id EXO\n'))], { ...TB1, revision: '1975' });
    expect(later.relationships).toEqual([{ id: 'dcs::bahtraku/id_tb1', relationType: 'source', flavor: 'textTranslation', revision: '1975' }]);
    expect(later.metadata.relationships).toHaveLength(2);
    expect(validateSource(later.metadata), JSON.stringify(validateSource.errors)).toBe(true);
  });

  test('E24: the relationship\'s id and revision match the schema\'s prefixed id and revision string for a tag, a bare year, and a commit', () => {
    for (const revision of ['v1.2', '1974', 'a'.repeat(40), 'v105']) {
      const relationship = sourceRelationship('bible', { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau', revision });
      expect(validateRelationship(relationship), JSON.stringify(validateRelationship.errors)).toBe(true);
    }
  });

  test('Q34, W1: an Open Bible Stories import carries x-textStories, decided 8 October 2026, since the schema allows a source no story flavor; textStories and glossedTextStory are refused', () => {
    const story = encode('# 1. Penciptaan\n');
    const { metadata, relationships } = mergeImportMetadata(obsProject(), [identified('1.md', story, 'obs')], { owner: 'unfoldingWord', repo: 'en_obs', revision: 'v9' });
    expect(relationships).toEqual([{ id: 'dcs::unfoldingWord/en_obs', relationType: 'source', flavor: SOURCE_RELATIONSHIP_FLAVOR.obs, revision: 'v9' }]);
    expect(SOURCE_RELATIONSHIP_FLAVOR.obs).toBe('x-textStories');
    expect(validateSource(metadata), JSON.stringify(validateSource.errors)).toBe(true);
    // The catalog's reading, the project's flavor as the type names it, is what the schema refuses (Q34).
    expect(validateRelationship({ id: 'dcs::unfoldingWord/en_obs', relationType: 'source', flavor: 'textStories', revision: 'v9' })).toBe(false);
    expect(validateRelationship({ id: 'dcs::unfoldingWord/en_obs', relationType: 'source', flavor: 'glossedTextStory', revision: 'v9' })).toBe(false);
  });

  test('a project of another type, or a unit the project cannot hold, is a MetadataError as for an upload', async () => {
    const metadata = await pendau();
    const other = structuredClone(metadata.document) as { type: { flavorType: { flavor: { name: string } } } };
    other.type.flavorType.flavor.name = 'textNotes';
    expect(() => mergeImportMetadata(parseMetadata(JSON.stringify(other)), [], TB1)).toThrow(MetadataError);
    expect(() => mergeImportMetadata(metadata, [identified('1.md', encode('# 1\n'), 'obs')], TB1)).toThrow('01 is not a book of this project');
  });
});
