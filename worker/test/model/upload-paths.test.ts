// Upload path safety and size limits (W6, #73): every name and the batch as a
// whole checked before identification (#72) or any Door43 read. The limit is
// one value, `MAX_UPLOAD_BYTES`, built behind the Q15 proposal.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CatalogError } from '@tc-admin/shared/schema';
import { MAX_UPLOAD_BYTES, checkUpload, modeProblem, normalizeUploadName } from '../../src/model/upload-paths';
import type { UploadFile } from '../../src/model/upload-paths';

const file = (name: string, size = 10, mode?: number | null): UploadFile => ({ name, size, content_ref: `ref-${name.length}-${size}`, mode });

/** The refusal of a batch, asserted to be one `validation_failed` naming each file it lists. */
function refusal(files: UploadFile[], limit?: number) {
  const result = checkUpload(files, limit);
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.files)}`);
  expect(result.error).toBeInstanceOf(CatalogError);
  expect(result.error.code).toBe('validation_failed');
  return result;
}

describe('W6: unsafe names are refused as validation_failed naming the file', () => {
  const cases: [string, string][] = [
    ['../a.usfm', 'traversal'],
    ['a/../b.usfm', 'traversal'],
    ['ingredients/..', 'traversal'],
    ['/etc/passwd', 'absolute'],
    ['//server/share/a.usfm', 'absolute'],
    ['C:\\Users\\a.usfm', 'absolute'],
    ['C:/Users/a.usfm', 'absolute'],
    ['c:a.usfm', 'absolute'],
    ['\\\\server\\share\\a.usfm', 'absolute'],
    ['\\a.usfm', 'absolute'],
    ['./C:/GEN.usfm', 'absolute'],
    ['././c:GEN.usfm', 'absolute'],
    ['ingredients\\GEN.usfm', 'backslash'],
    ['a\\..\\b.usfm', 'backslash'],
    ['a\u0000.usfm', 'control_character'],
    ['a.usfm\u0000', 'control_character'],
    ['a\nb.usfm', 'control_character'],
    ['a\u007f.usfm', 'control_character'],
    ['a\u0085.usfm', 'control_character'],
    ['a\u202Eb.usfm', 'control_character'],
    ['a\u2066b.usfm', 'control_character'],
    ['a\u200Bb.usfm', 'control_character'],
    ['a\u200Fb.usfm', 'control_character'],
    ['\uFEFF../x.usfm', 'control_character'],
    ['a\u00ADb.usfm', 'control_character'],
    ['a\u2028b.usfm', 'control_character'],
    ['a\u2029b.usfm', 'control_character'],
    ['', 'empty'],
    ['.', 'empty'],
    ['./', 'empty_segment'],
    ['a//b.usfm', 'empty_segment'],
    ['ingredients/', 'empty_segment'],
    ['.git/config', 'git_directory'],
    ['a/.GIT/hooks/pre-commit', 'git_directory'],
    ['%2e%2e/%2e%2e/a.usfm', 'percent_encoding'],
    ['%2e%2e%2f%2e%2e%2fa.usfm', 'percent_encoding'],
    ['%2egit/config', 'percent_encoding'],
    ['50%.md', 'percent_encoding'],
  ];

  test.each(cases)('W6: %j is refused as %s', (name, reason) => {
    const result = refusal([file('ingredients/GEN.usfm'), file(name)]);
    expect(result.problems).toEqual([expect.objectContaining({ name, index: 1, reason })]);
    expect(result.error.details).toMatchObject({ files: [{ name, reason }], batch: null });
    const fields = result.error.details['fields'] as { path: string; message: string }[];
    expect(fields).toEqual([{ path: 'files.1.name', message: expect.stringContaining(JSON.stringify(name)) }]);
    expect(result.error.message).toContain(`files.1.name: ${JSON.stringify(name)}`);
  });

  test('W6: every unsafe file in a batch is named at once, in order, and none is accepted', () => {
    const result = refusal([file('../a.usfm'), file('ok/GEN.usfm'), file('/b.usfm'), file('c\u0000.usfm')]);
    expect(result.problems.map(p => [p.index, p.reason])).toEqual([
      [0, 'traversal'],
      [2, 'absolute'],
      [3, 'control_character'],
    ]);
  });
});

describe('W6: entries the client reports as symlinks, non-files, or executables are refused', () => {
  test('W6: a symlink entry is refused naming the file', () => {
    const result = refusal([file('ingredients/GEN.usfm', 10, 0o120777)]);
    expect(result.problems).toEqual([expect.objectContaining({ name: 'ingredients/GEN.usfm', reason: 'symlink' })]);
    expect(result.error.message).toContain('symbolic link');
  });

  test('W6: an executable file is refused, by any execute bit', () => {
    for (const mode of [0o100755, 0o100744, 0o100654, 0o100645, 0o755]) {
      expect(refusal([file('run.sh', 10, mode)]).problems[0]?.reason, mode.toString(8)).toBe('executable');
    }
  });

  test('W6: a directory, device, or other non-regular entry is refused', () => {
    for (const mode of [0o040755, 0o040644, 0o020644, 0o060644, 0o010644, 0o140644]) {
      expect(refusal([file('a.usfm', 10, mode)]).problems[0]?.reason, mode.toString(8)).toBe('not_a_file');
    }
  });

  test('W6: a regular file, a permissions-only mode, and no mode at all are accepted', () => {
    for (const mode of [0o100644, 0o100600, 0o644, null, undefined]) expect(modeProblem(mode), String(mode)).toBeNull();
    expect(checkUpload([file('a.usfm', 10, 0o100644), file('b.usfm', 10, null), file('c.usfm')]).ok).toBe(true);
  });
});

describe('W6: accepted names are repository-relative and none escapes the project', () => {
  test('W6: a leading ./ is stripped, and so is any . segment', () => {
    expect(normalizeUploadName('./a.usfm')).toEqual({ ok: true, path: 'a.usfm' });
    expect(normalizeUploadName('././ingredients/./GEN.usfm')).toEqual({ ok: true, path: 'ingredients/GEN.usfm' });
  });

  test('W6: Unicode names are accepted as sent, unnormalized', () => {
    for (const name of ['ingredients/GÉN.usfm', 'истории/01.md', '故事/01.md', 'אסתר.usfm', 'نامه\u200Cها.usfm','e\u0301.md', '📖.usfm']) {
      expect(normalizeUploadName(name), name).toEqual({ ok: true, path: name });
    }
  });

  test('W6: names that look unusual but stay inside the project are accepted', () => {
    for (const name of ['...', '..a.usfm', 'a..usfm', '.gitea/workflows/check.yml', '.gitignore', 'a/.git.md', '~/a.usfm', 'notes:1.md']) {
      expect(normalizeUploadName(name), name).toEqual({ ok: true, path: name });
    }
  });

  test('W6: an accepted batch returns every file, in order, named by its repository-relative path', () => {
    const result = checkUpload([file('./GEN.usfm', 5), file('content/01.md', 7, 0o100644)]);
    expect(result).toEqual({
      ok: true,
      files: [
        { name: 'GEN.usfm', size: 5, content_ref: 'ref-10-5', mode: undefined },
        { name: 'content/01.md', size: 7, content_ref: 'ref-13-7', mode: 0o100644 },
      ],
    });
    if (!result.ok) return;
    for (const accepted of result.files) {
      expect(accepted.name.startsWith('/')).toBe(false);
      expect(accepted.name.split('/')).not.toContain('..');
      expect(accepted.name).not.toContain('\\');
    }
  });

  test('W6: two names for one path are refused, the later one named', () => {
    const result = refusal([file('a.usfm'), file('./a.usfm')]);
    expect(result.problems).toEqual([expect.objectContaining({ name: './a.usfm', index: 1, reason: 'duplicate' })]);
  });

  test('W6: an empty batch is accepted with no files; the operation decides whether that is a plan', () => {
    expect(checkUpload([])).toEqual({ ok: true, files: [] });
  });
});

describe('W6: files and batches over the configured limit are refused', () => {
  test('W6: the limit is one value, 32 MiB, the Q15 proposal', () => {
    expect(MAX_UPLOAD_BYTES).toBe(32 * 1024 * 1024);
  });

  test('W6: a file of exactly the limit is accepted; one byte over is refused naming the file', () => {
    expect(checkUpload([file('GEN.usfm', MAX_UPLOAD_BYTES)]).ok).toBe(true);
    const result = refusal([file('GEN.usfm', MAX_UPLOAD_BYTES + 1)]);
    expect(result.problems).toEqual([expect.objectContaining({ name: 'GEN.usfm', reason: 'too_large' })]);
    expect(result.batch).toBeNull();
    expect(result.error.message).toContain(String(MAX_UPLOAD_BYTES));
  });

  test('W6: a batch totalling exactly the limit is accepted; one byte over is refused naming the batch', () => {
    const half = MAX_UPLOAD_BYTES / 2;
    expect(checkUpload([file('GEN.usfm', half), file('EXO.usfm', half)]).ok).toBe(true);
    const result = refusal([file('GEN.usfm', half), file('EXO.usfm', half + 1)]);
    expect(result.problems).toEqual([]);
    expect(result.batch).toEqual({ bytes: MAX_UPLOAD_BYTES + 1, limit: MAX_UPLOAD_BYTES });
    expect(result.error.details['fields']).toEqual([{ path: 'files', message: `the batch is ${MAX_UPLOAD_BYTES + 1} bytes, over the limit of ${MAX_UPLOAD_BYTES}` }]);
  });

  test('W6: the batch total counts every file, a refused one too', () => {
    const result = refusal([file('../x.usfm', 6), file('a.usfm', 5)], 10);
    expect(result.problems.map(p => p.reason)).toEqual(['traversal']);
    expect(result.batch).toEqual({ bytes: 11, limit: 10 });
  });

  test('W6: the limit is configurable per call, and a file over it is named rather than the batch', () => {
    const result = refusal([file('a.usfm', 4), file('b.usfm', 11)], 10);
    expect(result.problems).toEqual([expect.objectContaining({ name: 'b.usfm', index: 1, reason: 'too_large' })]);
    expect(result.batch).toBeNull();
  });

  test('W6: a typical batch of 66 unaligned books (5.2 MB in all, E17) is within the limit', () => {
    const books = Array.from({ length: 66 }, (_, i) => file(`ingredients/B${String(i).padStart(2, '0')}.usfm`, 80_000));
    expect(checkUpload(books).ok).toBe(true);
  });
});

test('W6: the checker and these tests hold no raw format, line, or paragraph separator character, only escapes', () => {
  for (const file of ['../../src/model/upload-paths.ts', './upload-paths.test.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source).not.toMatch(/[\p{Cf}\p{Zl}\p{Zp}]/u);
  }
});

test('W6: ZWNJ and ZWJ, spelling in Persian and Indic names, are the only format characters accepted', () => {
  expect(normalizeUploadName('\u0645\u06cc\u200C\u062e\u0648\u0627\u0647\u0645.usfm')).toEqual({ ok: true, path: '\u0645\u06cc\u200C\u062e\u0648\u0627\u0647\u0645.usfm' });
  expect(normalizeUploadName('\u0915\u094d\u200D\u0937.usfm')).toEqual({ ok: true, path: '\u0915\u094d\u200D\u0937.usfm' });
  expect(normalizeUploadName('a\u2060b.usfm')).toEqual({ ok: false, reason: 'control_character' });
});
