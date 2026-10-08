// Git blob ids for the retry of a first commit (#31) and a repeated upload
// (#75): the same ids Door43 listed for the files tC Admin committed on QA
// (E45), a comparison that holds a ref to exactly the plan's files, and one
// that asks only that a ref holds them (X1).
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { gitBlobSha, holdsFiles, sameFiles } from '../../src/model/git-blob';

const commit = JSON.parse(
  readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-10-05/project-create/tc-admin-qa-org/08-POST-repos_tc-admin-qa-org_id_tcap1856_contents.json', import.meta.url), 'utf8'),
) as { response: { json: { files: { path: string; sha: string; content: string }[] } } };

describe('gitBlobSha', () => {
  test('X1: each file of tC Admin\'s first commit on QA has the blob id Door43 answered for it (E45)', async () => {
    const files = commit.response.json.files;
    expect(files.map(file => file.path)).toEqual(['metadata.json', 'ingredients/license.md', 'README.md']);
    for (const file of files) expect(await gitBlobSha(new Uint8Array(Buffer.from(file.content, 'base64'))), file.path).toBe(file.sha);
  });

  test('a string is hashed as its UTF-8 bytes, and the empty file has git\'s well-known id', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha('é')).toBe(await gitBlobSha(new TextEncoder().encode('é')));
  });
});

describe('sameFiles', () => {
  const planned = [
    { path: 'metadata.json', sha: 'a' },
    { path: 'README.md', sha: 'b' },
  ];

  test('X1: the same paths with the same blobs, in any order, are the same files', () => {
    expect(sameFiles(planned, [planned[1]!, planned[0]!])).toBe(true);
  });

  test('X1: a changed blob, a missing file, an added file, or a repeated path is not', () => {
    expect(sameFiles(planned, [planned[0]!, { path: 'README.md', sha: 'c' }])).toBe(false);
    expect(sameFiles(planned, [planned[0]!])).toBe(false);
    expect(sameFiles(planned, [...planned, { path: 'ingredients/MAT.usfm', sha: 'd' }])).toBe(false);
    expect(sameFiles(planned, [planned[0]!, planned[0]!])).toBe(false);
  });
});

describe('holdsFiles', () => {
  const planned = [
    { path: 'metadata.json', sha: 'a' },
    { path: 'ingredients/GEN.usfm', sha: 'b' },
  ];

  test('X1: a ref holding every planned file at its blob holds them, whatever else it holds', () => {
    expect(holdsFiles(planned, [{ path: 'ingredients/MAT.usfm', sha: 'c' }, planned[1]!, planned[0]!])).toBe(true);
  });

  test('X1: a changed blob or a missing file is not held', () => {
    expect(holdsFiles(planned, [planned[0]!, { path: 'ingredients/GEN.usfm', sha: 'c' }])).toBe(false);
    expect(holdsFiles(planned, [planned[0]!])).toBe(false);
  });
});
