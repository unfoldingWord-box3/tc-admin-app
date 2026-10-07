// Unknown and administrative files (#20): over Pendau's archive (E17), every
// file is a book, an administrative file, the metadata, or unknown; the
// administrative files are the default branch's (R1); an unlisted file under
// ingredients/ is unknown and never silently carried (S5).
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import { parseMetadata } from '../../src/model/burrito-reader';
import { classifyFiles, isRootOrWorkflow, roleOf } from '../../src/model/classify';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const archiveOf = (path: string) => openArchive(new Uint8Array(readFileSync(new URL(path, fixtures))));

describe('Pendau (E17)', () => {
  const archive = archiveOf('2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip');

  test('every file is a book, an administrative file, or the metadata; nothing is unknown or missing', async () => {
    const metadata = parseMetadata(await archive.bytes('metadata.json'));
    const classified = classifyFiles(metadata, archive.entries);
    expect(classified.units.size).toBe(27);
    expect(classified.units.get('mat')).toEqual({ path: 'ingredients/MAT.usfm', role: 'book', unit: 'mat', listed: true });
    expect(classified.administrative).toEqual(['LICENSE.md', 'README.md', 'ingredients/license.md', 'ingredients/scribe-settings.json', 'ingredients/versification.json']);
    expect(classified.unknown).toEqual([]);
    expect(classified.missing).toEqual([]);
    expect(classified.files.find(file => file.path === 'metadata.json')).toEqual({ path: 'metadata.json', role: 'metadata', unit: null, listed: false });
    expect(classified.files).toHaveLength(archive.entries.length);
  });

  test('S5, R1: an unlisted file under ingredients/ is unknown, a root or .gitea/ file is administrative though unlisted, and a listed file that is gone is missing', async () => {
    const metadata = parseMetadata(await archive.bytes('metadata.json'));
    const paths = [...archive.entries.filter(entry => entry.path !== 'ingredients/MRK.usfm'), { path: 'ingredients/notes.txt' }, { path: 'docs/plan.md' }, { path: '.gitea/workflows/check.yml' }, { path: 'CHANGELOG.md' }];
    const classified = classifyFiles(metadata, paths);
    expect(classified.unknown).toEqual(['docs/plan.md', 'ingredients/notes.txt']);
    expect(classified.administrative).toContain('.gitea/workflows/check.yml');
    expect(classified.administrative).toContain('CHANGELOG.md');
    expect(classified.files.find(file => file.path === 'CHANGELOG.md')).toMatchObject({ role: 'administrative', listed: false });
    expect(classified.missing).toEqual(['ingredients/MRK.usfm']);
    expect(classified.units.has('mrk')).toBe(false);
    expect(isRootOrWorkflow('README.md')).toBe(true);
    expect(isRootOrWorkflow('.gitea/x.yml')).toBe(true);
    expect(isRootOrWorkflow('ingredients/x')).toBe(false);
  });
});

describe('Open Bible Stories (E36)', () => {
  test('the stories are units, front and back matter and the license administrative, and a stray file under content/ unknown', async () => {
    const archive = archiveOf('2026-10-01/sb-archives/unfoldingWord__en_obs__v9.zip');
    const metadata = parseMetadata(await archive.bytes('metadata.json'));
    const classified = classifyFiles(metadata, [...archive.entries, { path: 'ingredients/content/51.md' }]);
    expect(classified.units.size).toBe(50);
    expect(classified.units.get('01')?.role).toBe('story');
    expect(classified.administrative).toEqual(['.gitignore', 'LICENSE.md', 'README.md', 'ingredients/LICENSE.md', 'ingredients/content/back.md', 'ingredients/content/front.md']);
    expect(classified.unknown).toEqual(['ingredients/content/51.md']);
    expect(roleOf('ingredients/content/51.md', metadata)).toEqual({ role: 'unknown', unit: null, listed: false });
  });
});
