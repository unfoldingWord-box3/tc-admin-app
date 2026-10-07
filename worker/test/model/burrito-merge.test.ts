// The release metadata merge (#35, ADR 0010): entries from the previous release
// for carried-forward books and from the default branch for the rest, every
// top-level field from the default branch (Q8), the scope set to the released
// books (Q7), size and md5 from the snapshot's bytes, never from a base whose
// checksums are stale (E5, R10), and every removal listed (R2).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import { mergeReleaseMetadata } from '../../src/model/burrito';
import type { SnapshotFile } from '../../src/model/burrito';
import { MetadataError, parseMetadata, readMetadata } from '../../src/model/burrito-reader';
import type { ProjectMetadata } from '../../src/model/burrito-reader';
import { md5 } from '../../src/model/md5';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const SCHEMA_DIR = new URL('../../../fixtures/scripture-burrito/2026-10-05/schema/', import.meta.url);
const schemaFiles = (dir: URL): URL[] =>
  readdirSync(dir).flatMap(name => {
    const entry = new URL(name, dir);
    if (statSync(entry).isDirectory()) return schemaFiles(new URL(`${name}/`, dir));
    return name.endsWith('.schema.json') && name !== 'scripture_flavor_type.schema.json' ? [entry] : [];
  });
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
for (const file of schemaFiles(SCHEMA_DIR)) ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')) as object);
const validateSource = ajv.getSchema('https://burrito.bible/schema/source_metadata.schema.json')!;

/** Pendau's archive (E17): the metadata with its stale checksums (E5), and every ingredient file with the size and md5 of its bytes. */
async function pendau(): Promise<{ metadata: ProjectMetadata; files: SnapshotFile[] }> {
  const archive = openArchive(new Uint8Array(readFileSync(new URL('2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip', fixtures))));
  const metadata = parseMetadata(await archive.bytes('metadata.json'));
  const files: SnapshotFile[] = [];
  for (const entry of archive.entries) {
    if (!entry.path.startsWith('ingredients/')) continue;
    const bytes = await archive.bytes(entry.path);
    files.push({ path: entry.path, size: bytes.length, md5: md5(bytes) });
  }
  return { metadata, files };
}

/** The same document with a change: a book's bytes differ (its stale entry too), and the title was edited on the default branch. */
function edited(metadata: ProjectMetadata, changes: (document: Record<string, unknown>) => void): ProjectMetadata {
  const document = JSON.parse(JSON.stringify(metadata.document)) as Record<string, unknown>;
  changes(document);
  return readMetadata(document);
}
const everyBook = (metadata: ProjectMetadata, state: 'include' | 'carry_forward') => Object.fromEntries(metadata.ingredients.filter(i => i.unit).map(i => [i.unit!, state]));
const scopeOf = (metadata: Record<string, unknown>) => (metadata.type as { flavorType: { currentScope: Record<string, string[]> } }).flavorType.currentScope;
const ingredientsOf = (metadata: Record<string, unknown>) => metadata.ingredients as Record<string, { size: number; checksum: { md5: string }; mimeType?: string; scope?: unknown; role?: string }>;

describe('a later release of Pendau (baseline v1.2)', () => {
  test('R10: every entry carries the size and md5 of the file in the snapshot, not the stale ones the base declares (E5)', async () => {
    const { metadata, files } = await pendau();
    const { metadata: merged } = mergeReleaseMetadata({ current: metadata, base: metadata, selection: everyBook(metadata, 'carry_forward'), files });
    const entries = ingredientsOf(merged);
    expect(Object.keys(entries).sort()).toEqual(files.map(file => file.path).sort());
    for (const file of files) expect([entries[file.path]!.size, entries[file.path]!.checksum.md5], file.path).toEqual([file.size, file.md5]);
    const stale = metadata.ingredients.filter(i => i.size !== files.find(f => f.path === i.path)?.size || i.md5 !== files.find(f => f.path === i.path)?.md5);
    expect(stale.length).toBeGreaterThanOrEqual(20);
    // The rest of each entry is kept as written: mime type, role, scope.
    expect(entries['ingredients/MAT.usfm']).toMatchObject({ mimeType: 'text/x-usfm', scope: { MAT: [] } });
    expect(entries['ingredients/versification.json']).toMatchObject({ role: 'x-versification' });
  });

  test('R2, Q7: every book of the previous release is present when carried forward, and the scope is exactly the released books; one left out is removed and gone from both', async () => {
    const { metadata, files } = await pendau();
    const all = mergeReleaseMetadata({ current: metadata, base: metadata, selection: everyBook(metadata, 'carry_forward'), files });
    expect(all.released).toHaveLength(27);
    expect(all.removed).toEqual([]);
    expect(Object.keys(scopeOf(all.metadata))).toEqual(all.released.map(id => id.toUpperCase()));
    expect(all.released.slice(0, 3)).toEqual(['mat', 'mrk', 'luk']);
    const without = mergeReleaseMetadata({ current: metadata, base: metadata, selection: { ...everyBook(metadata, 'carry_forward'), mat: 'leave_out' }, files: files.filter(file => file.path !== 'ingredients/MAT.usfm') });
    expect(without.removed).toEqual(['mat']);
    expect(without.released).toHaveLength(26);
    expect(scopeOf(without.metadata)).not.toHaveProperty('MAT');
    expect(ingredientsOf(without.metadata)).not.toHaveProperty('ingredients/MAT.usfm');
    expect(ingredientsOf(without.metadata)).toHaveProperty('ingredients/MRK.usfm');
  });

  test('Q8: the top-level fields come from the default branch, where the title was edited; an included book takes the default branch\'s entry, a carried one the release\'s', async () => {
    const { metadata: base, files } = await pendau();
    const current = edited(base, document => {
      (document.identification as { name: Record<string, string> }).name.en = 'Perjanjian Baru Pendau, edisi kedua';
      (document.ingredients as Record<string, { mimeType: string }>)['ingredients/MAT.usfm']!.mimeType = 'text/usfm';
      (document.localizedNames as Record<string, unknown>).MAT = { short: { en: 'Matthew' }, abbr: { en: 'Mt' }, long: { en: 'Matthew' } };
    });
    const { metadata: merged } = mergeReleaseMetadata({ current, base, selection: { ...everyBook(base, 'carry_forward'), mat: 'include' }, files });
    expect((merged.identification as { name: { en: string } }).name.en).toBe('Perjanjian Baru Pendau, edisi kedua');
    expect((merged.localizedNames as Record<string, { abbr: { en: string } }>).MAT!.abbr.en).toBe('Mt');
    expect(merged.meta).toEqual(current.document.meta);
    expect(merged.copyright).toEqual(current.document.copyright);
    expect(ingredientsOf(merged)['ingredients/MAT.usfm']!.mimeType).toBe('text/usfm');
    expect(ingredientsOf(merged)['ingredients/MRK.usfm']!.mimeType).toBe('text/x-usfm');
  });

  test('a new book included takes its entry from the default branch and joins the scope, in canonical order', async () => {
    const { metadata: base, files } = await pendau();
    const current = edited(base, document => {
      (document.ingredients as Record<string, unknown>)['ingredients/GEN.usfm'] = { checksum: { md5: 'stale' }, mimeType: 'text/x-usfm', size: 1, scope: { GEN: ['1-3'] } };
      (document.type as { flavorType: { currentScope: Record<string, string[]> } }).flavorType.currentScope.GEN = ['1-3'];
    });
    const gen = { path: 'ingredients/GEN.usfm', size: 42, md5: '0'.repeat(32) };
    const { metadata: merged, released } = mergeReleaseMetadata({ current, base, selection: { ...everyBook(base, 'carry_forward'), gen: 'include' }, files: [...files, gen] });
    expect(released[0]).toBe('gen');
    expect(Object.keys(scopeOf(merged))[0]).toBe('GEN');
    expect(scopeOf(merged).GEN).toEqual(['1-3']);
    expect(ingredientsOf(merged)['ingredients/GEN.usfm']).toEqual({ checksum: { md5: '0'.repeat(32) }, mimeType: 'text/x-usfm', size: 42, scope: { GEN: ['1-3'] } });
  });

  test('W1: the merged document validates against the recorded schema (E44), as the base does', async () => {
    const { metadata, files } = await pendau();
    expect(validateSource(metadata.document), JSON.stringify(validateSource.errors)).toBe(true);
    const { metadata: merged } = mergeReleaseMetadata({ current: metadata, base: metadata, selection: { ...everyBook(metadata, 'carry_forward'), mat: 'leave_out' }, files: files.filter(file => file.path !== 'ingredients/MAT.usfm') });
    expect(validateSource(merged), JSON.stringify(validateSource.errors)).toBe(true);
  });
});

describe('a first release', () => {
  test('R4: everything comes from the default branch; every included book is released and the scope is theirs', async () => {
    const { metadata, files } = await pendau();
    const { metadata: merged, released, removed } = mergeReleaseMetadata({ current: metadata, base: null, selection: everyBook(metadata, 'include'), files });
    expect(released).toHaveLength(27);
    expect(removed).toEqual([]);
    expect(Object.keys(ingredientsOf(merged))).toHaveLength(30);
    expect(validateSource(merged), JSON.stringify(validateSource.errors)).toBe(true);
    const some = mergeReleaseMetadata({ current: metadata, base: null, selection: { mat: 'include', mrk: 'include' }, files: files.filter(f => /MAT|MRK|license|scribe|versification/.test(f.path)) });
    expect(some.released).toEqual(['mat', 'mrk']);
    expect(Object.keys(scopeOf(some.metadata))).toEqual(['MAT', 'MRK']);
  });
});

describe('what the merge refuses (R10, R2)', () => {
  test('an entry without a file, a file without an entry, a carried book the release lacks, and an included book the branch lacks', async () => {
    const { metadata, files } = await pendau();
    const carried = everyBook(metadata, 'carry_forward');
    expect(() => mergeReleaseMetadata({ current: metadata, base: metadata, selection: carried, files: files.filter(f => f.path !== 'ingredients/MAT.usfm') })).toThrow(/MAT.usfm is listed for mat but is not in the snapshot/);
    expect(() => mergeReleaseMetadata({ current: metadata, base: metadata, selection: carried, files: [...files, { path: 'ingredients/extra.txt', size: 1, md5: 'x' }] })).toThrow(/extra.txt is in the snapshot but has no ingredient entry/);
    expect(mergeReleaseMetadata({ current: metadata, base: metadata, selection: carried, files: [...files, { path: 'ingredients/extra.txt', size: 1, md5: 'x' }], unknown_included: ['ingredients/extra.txt'] }).released).toHaveLength(27);
    expect(() => mergeReleaseMetadata({ current: metadata, base: null, selection: { ...carried }, files })).toThrow(/cannot be carried forward/);
    // A book the release has but the branch lost cannot be included, only carried forward or left out; one on neither side is prepare's to refuse (invalid_selection) and is ignored here.
    const lostMat = edited(metadata, document => {
      delete (document.ingredients as Record<string, unknown>)['ingredients/MAT.usfm'];
    });
    expect(() => mergeReleaseMetadata({ current: lostMat, base: metadata, selection: { ...carried, mat: 'include' }, files })).toThrow(/mat cannot be included: it is not on the default branch/);
    expect(mergeReleaseMetadata({ current: metadata, base: metadata, selection: { ...carried, gen: 'include' }, files }).released).toHaveLength(27);
    expect(() => mergeReleaseMetadata({ current: metadata, base: metadata, selection: carried, files: files.filter(f => f.path !== 'ingredients/license.md') })).toThrow(/license.md is an administrative ingredient but is not in the snapshot/);
    expect(() => mergeReleaseMetadata({ current: metadata, base: null, selection: {}, files: [] })).toThrow(/is an administrative ingredient/);
    const other = readMetadata({ ...metadata.document, type: { flavorType: { name: 'peripheral', flavor: { name: 'x-notes' }, currentScope: {} } } });
    expect(() => mergeReleaseMetadata({ current: other, base: null, selection: {}, files: [] })).toThrow(MetadataError);
  });
});

describe('review round 1 (bench)', () => {
  test('R2: a released book the selection does not name is carried forward, never removed by omission; leave_out still removes', async () => {
    const { metadata, files } = await pendau();
    const partial = everyBook(metadata, 'carry_forward');
    delete partial.mrk;
    const merged = mergeReleaseMetadata({ current: metadata, base: metadata, selection: partial, files });
    expect(merged.removed).toEqual([]);
    expect(merged.released).toContain('mrk');
    expect(ingredientsOf(merged.metadata)).toHaveProperty('ingredients/MRK.usfm');
    expect(scopeOf(merged.metadata)).toHaveProperty('MRK');
  });

  test('R10: a checksum is exactly the snapshot md5; a stale digest of another algorithm is dropped', async () => {
    const { metadata: current, files } = await pendau();
    const base = edited(current, document => {
      (document.ingredients as Record<string, { checksum: Record<string, string> }>)['ingredients/MAT.usfm']!.checksum.sha256 = 'stale';
    });
    const { metadata: merged } = mergeReleaseMetadata({ current, base, selection: everyBook(base, 'carry_forward'), files });
    expect(ingredientsOf(merged)['ingredients/MAT.usfm']!.checksum).toEqual({ md5: files.find(f => f.path === 'ingredients/MAT.usfm')!.md5 });
  });

  test('W1: the merged document shares no object with the default branch document', async () => {
    const { metadata, files } = await pendau();
    const { metadata: merged } = mergeReleaseMetadata({ current: metadata, base: metadata, selection: everyBook(metadata, 'carry_forward'), files });
    expect(merged.identification).not.toBe(metadata.document.identification);
    expect(merged.meta).not.toBe(metadata.document.meta);
    const entries = metadata.document.ingredients as Record<string, { scope: unknown }>;
    expect(ingredientsOf(merged)['ingredients/MAT.usfm']!.scope).not.toBe(entries['ingredients/MAT.usfm']!.scope);
  });

  test('R2: two released units, or a book and an administrative ingredient, at one path are refused', async () => {
    const { metadata, files } = await pendau();
    const carried = everyBook(metadata, 'carry_forward');
    const mrkAtMat = edited(metadata, document => {
      const ingredients = document.ingredients as Record<string, unknown>;
      ingredients['ingredients/MAT.usfm'] = ingredients['ingredients/MRK.usfm'];
      delete ingredients['ingredients/MRK.usfm'];
    });
    expect(() => mergeReleaseMetadata({ current: mrkAtMat, base: metadata, selection: { ...carried, mrk: 'include' }, files })).toThrow(/MAT.usfm is the entry of both mat and mrk/);
    const matAtLicense = edited(metadata, document => {
      const ingredients = document.ingredients as Record<string, unknown>;
      ingredients['ingredients/license.md'] = ingredients['ingredients/MAT.usfm'];
      delete ingredients['ingredients/MAT.usfm'];
    });
    expect(() => mergeReleaseMetadata({ current: metadata, base: matAtLicense, selection: carried, files })).toThrow(/license.md is the entry of both mat and an administrative ingredient/);
  });
});

describe('an Open Bible Stories release', () => {
  test('ADR 0013, E46: every story on the default branch is included without a selection, a story the branch lost is removed, and the fixed scope stays', () => {
    const obs = parseMetadata(readFileSync(new URL('2026-10-01/sb-archives/unfoldingWord__en_obs__v9.metadata.json', fixtures), 'utf8'));
    const files = obs.ingredients.map(i => ({ path: i.path, size: 7, md5: 'f'.repeat(32) }));
    const whole = mergeReleaseMetadata({ current: obs, base: obs, selection: {}, files });
    expect(whole.released).toHaveLength(50);
    expect(whole.removed).toEqual([]);
    expect(scopeOf(whole.metadata)).toEqual(scopeOf(obs.document));
    expect(Object.keys(ingredientsOf(whole.metadata))).toHaveLength(53);
    const branch = edited(obs, document => {
      delete (document.ingredients as Record<string, unknown>)['ingredients/content/50.md'];
    });
    const lost = mergeReleaseMetadata({ current: branch, base: obs, selection: {}, files: files.filter(f => f.path !== 'ingredients/content/50.md') });
    expect(lost.removed).toEqual(['50']);
    expect(lost.released).toHaveLength(49);
    expect(scopeOf(lost.metadata)).toEqual(scopeOf(obs.document));
    expect(validateSource(lost.metadata), JSON.stringify(validateSource.errors)).toBe(true);
  });
  test('R2, Q7: localizedNames keeps the released books only, so a removed book leaves the names as it leaves the ingredients and the scope; a key that is no book code stays', async () => {
    const { metadata, files } = await pendau();
    const document = structuredClone(metadata.document) as Record<string, unknown>;
    (document.localizedNames as Record<string, unknown>).note = { short: { id: 'catatan' } };
    const merged = mergeReleaseMetadata({ current: { ...metadata, document }, base: metadata, selection: { mrk: 'leave_out' }, files: files.filter(f => !/MRK/.test(f.path)) });
    const names = merged.metadata.localizedNames as Record<string, unknown>;
    expect(merged.removed).toEqual(['mrk']);
    expect(names.MRK).toBeUndefined();
    expect(Object.keys(names)).toContain('MAT');
    expect(names.note).toEqual({ short: { id: 'catatan' } });
    expect(Object.keys(names).filter(key => key !== 'note').map(key => key.toLowerCase()).sort()).toEqual([...merged.released].sort());
  });

});
