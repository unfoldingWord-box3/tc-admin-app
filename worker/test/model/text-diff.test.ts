// The overwrite diff of an upload (#74, product spec §8 "Overwrites"): a
// unified line diff where practical, `''` for the same bytes, and no diff
// (`null`) for bytes that are not text or a change too large to read.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import { MAX_DIFF_BYTES, MAX_DIFF_EDITS, MAX_DIFF_LINES, textDiff, textOf } from '../../src/model/text-diff';

const encode = (text: string) => new TextEncoder().encode(text);
const diff = (before: string, after: string) => textDiff('ingredients/RUT.usfm', encode(before), encode(after));

describe('S2: an overwrite shows a unified text diff', () => {
  test('one changed line, with three lines of context either side and the git header', () => {
    const before = ['\\id RUT', '\\c 1', '\\v 1 a', '\\v 2 b', '\\v 3 c', '\\v 4 d', '\\v 5 e', '\\v 6 f', '\\v 7 g', ''].join('\n');
    const after = before.replace('\\v 4 d', '\\v 4 D');
    expect(diff(before, after)).toBe(
      ['--- a/ingredients/RUT.usfm', '+++ b/ingredients/RUT.usfm', '@@ -3,7 +3,7 @@', ' \\v 1 a', ' \\v 2 b', ' \\v 3 c', '-\\v 4 d', '+\\v 4 D', ' \\v 5 e', ' \\v 6 f', ' \\v 7 g', ''].join('\n'),
    );
  });

  test('changes far apart are separate hunks; near ones are joined', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const before = `${lines.join('\n')}\n`;
    const after = `${lines.map(line => (line === 'line 2' || line === 'line 25' ? `${line}!` : line)).join('\n')}\n`;
    const out = diff(before, after)!;
    expect(out.match(/^@@ .* @@$/gm)).toEqual(['@@ -1,5 +1,5 @@', '@@ -22,7 +22,7 @@']);
    const near = `${lines.map(line => (line === 'line 10' || line === 'line 15' ? `${line}!` : line)).join('\n')}\n`;
    expect(diff(before, near)!.match(/^@@ .* @@$/gm)).toEqual(['@@ -7,12 +7,12 @@']);
  });

  test('a new file over an empty one, an emptied file, and lines added at the end', () => {
    expect(diff('', 'a\nb\n')).toBe('--- a/ingredients/RUT.usfm\n+++ b/ingredients/RUT.usfm\n@@ -0,0 +1,2 @@\n+a\n+b\n');
    expect(diff('a\n', '')).toBe('--- a/ingredients/RUT.usfm\n+++ b/ingredients/RUT.usfm\n@@ -1 +0,0 @@\n-a\n');
    expect(diff('a\nb\n', 'a\nb\nc\n')).toBe('--- a/ingredients/RUT.usfm\n+++ b/ingredients/RUT.usfm\n@@ -1,2 +1,3 @@\n a\n b\n+c\n');
  });

  test('a lost final newline is a change, marked as diff marks it', () => {
    expect(diff('a\nb\n', 'a\nb')).toBe('--- a/ingredients/RUT.usfm\n+++ b/ingredients/RUT.usfm\n@@ -1,2 +1,2 @@\n a\n-b\n+b\n\\ No newline at end of file\n');
  });

  test('the same bytes are the empty diff', () => {
    expect(diff('\\id RUT\n', '\\id RUT\n')).toBe('');
  });

  test('applying the diff to the old text gives the new one, over a real book with scattered edits', async () => {
    const zip = new Uint8Array(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip', import.meta.url)));
    const before = new TextDecoder().decode(await openArchive(zip).bytes('ingredients/JUD.usfm'));
    expect(before.endsWith('\n')).toBe(true);
    const lines = before.split('\n');
    // Deletions, insertions, and changes through the book; the final newline kept.
    const last = lines.length - 1;
    const edited = lines.flatMap((line, i) => (i === last ? [line] : i % 17 === 5 ? [] : i % 23 === 7 ? [line, `${line} (inserted)`] : i % 29 === 3 ? [`${line}!`] : [line])).join('\n');
    const out = textDiff('ingredients/JUD.usfm', encode(before), encode(edited))!;
    expect(out).not.toBeNull();
    // Patch: walk the hunks, taking context and additions, dropping deletions.
    const result: string[] = [];
    let cursor = 0;
    const body = out.split('\n').slice(2);
    for (let i = 0; i < body.length; i++) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@$/.exec(body[i]!);
      if (!header) continue;
      const start = Number(header[2] === '0' ? Number(header[1]) : Number(header[1]) - 1);
      result.push(...lines.slice(cursor, start));
      cursor = start;
      for (i++; i < body.length && !body[i]!.startsWith('@@'); i++) {
        const [mark, text] = [body[i]![0], body[i]!.slice(1)];
        if (mark === ' ') {
          result.push(text);
          cursor++;
        }
        else if (mark === '-') cursor++;
        else if (mark === '+') result.push(text);
      }
      i--;
    }
    result.push(...lines.slice(cursor));
    expect(result.join('\n')).toBe(edited);
  });
});

describe('a diff is shown only where practical', () => {
  test('bytes that are not UTF-8, or hold a NUL, are not text: no diff', () => {
    expect(textOf(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull();
    expect(textDiff('a.usfm', new Uint8Array([0xc3, 0x28]), encode('a'))).toBeNull();
    expect(textDiff('a.usfm', encode('a'), new Uint8Array([0x61, 0x00, 0x62]))).toBeNull();
  });

  test('a byte-order mark is kept as text, so adding one is a change', () => {
    expect(textDiff('a.usfm', encode('\\id RUT\n'), encode('﻿\\id RUT\n'))).toContain('+﻿\\id RUT');
  });

  test(`more than ${MAX_DIFF_EDITS} edits, or a changed region over ${MAX_DIFF_LINES} lines, is no diff`, () => {
    const many = Array.from({ length: MAX_DIFF_EDITS + 2 }, (_, i) => `line ${i}`);
    expect(diff(`${many.join('\n')}\n`, `${many.map(line => `${line}!`).join('\n')}\n`)).toBeNull();
    const long = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `l${i}`);
    expect(diff(`x\n${long.join('\n')}\nx\n`, `y\n${long.join('\n')}\ny\n`)).toBeNull();
  });
});

describe('W6: a diff is bounded in the memory it takes, whatever the upload', () => {
  test(`a side over ${MAX_DIFF_BYTES} bytes is no diff, and the same bytes, however large, are the empty diff, both without decoding`, () => {
    const big = new TextEncoder().encode('a line\n'.repeat(Math.ceil((MAX_DIFF_BYTES + 1) / 7)));
    const changed = big.slice();
    changed[changed.length - 2] = 'b'.charCodeAt(0);
    expect(big.length).toBeGreaterThan(MAX_DIFF_BYTES);
    expect(textDiff('ingredients/PSA.usfm', big, changed)).toBeNull();
    expect(textDiff('ingredients/PSA.usfm', big, big.slice())).toBe('');
  });

  test('a long common prefix and suffix keep only their context lines, and the hunk is numbered from the file start', () => {
    const lines = Array.from({ length: 60_000 }, (_, i) => `\\v ${i + 1} line\n`);
    const before = new TextEncoder().encode(lines.join(''));
    const edited = [...lines];
    edited[29_999] = '\\v 30000 changed\n';
    const diff = textDiff('ingredients/PSA.usfm', before, new TextEncoder().encode(edited.join('')))!;
    expect(diff).toContain('@@ -29997,7 +29997,7 @@\n');
    expect(diff).toContain('-\\v 30000 line\n+\\v 30000 changed\n');
    expect(diff.split('\n').filter(line => line.startsWith(' '))).toHaveLength(6);
  });
});
