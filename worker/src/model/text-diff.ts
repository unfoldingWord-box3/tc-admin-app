// A unified line diff of two versions of one text file, for the overwrite
// warning of an upload or import (product spec §8 "Overwrites": "a text diff
// where practical"). Myers' algorithm on the lines between the common prefix
// and suffix, written here because the application adds no dependency for one
// function. "Practical" is bounded: bytes that are not UTF-8 or hold a NUL are
// not text; a side over `MAX_DIFF_BYTES` or `MAX_DIFF_FILE_LINES`, a changed region over `MAX_DIFF_LINES` lines, more than
// `MAX_DIFF_EDITS` line edits, or a diff longer than `MAX_DIFF_CHARS` is no
// diff, and the caller says so (`diff: null`). Pure.

/**
 * The most bytes either version may have for a diff to be made: checked before the bytes are decoded or split
 * into lines, so the memory a diff takes is bounded whatever the upload's size (an upload may reach 32 MiB).
 * Larger files, such as aligned books, get no diff.
 */
export const MAX_DIFF_BYTES = 4 * 1024 * 1024;
/**
 * The most lines either version may have for a diff to be made, counted by a scan of the bytes before the text is
 * split, so a file of short lines within `MAX_DIFF_BYTES` cannot become millions of line strings. Room for any real
 * book: the Psalms run to about 2,500 verses.
 */
export const MAX_DIFF_FILE_LINES = 200_000;
/** The most lines, old and new together, of the region between the common prefix and suffix that is compared. */
export const MAX_DIFF_LINES = 20_000;
/** The most line insertions and deletions a diff may hold: the work and the memory of the comparison grow with their square. */
export const MAX_DIFF_EDITS = 1_000;
/** The longest diff returned, in characters: past it a diff is no help to a reader. */
export const MAX_DIFF_CHARS = 256 * 1024;
/** Unchanged lines shown around each change, as `git diff` shows them. */
export const CONTEXT_LINES = 3;

type Op = { kind: ' ' | '-' | '+'; line: string };

/** The text of UTF-8 bytes, or `null` for bytes that are not UTF-8 or hold a NUL, which are not a text file. */
export function textOf(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The lines of a text, each with its line feed; a last line without one is kept without, so a change to the final newline is a change. */
function linesOf(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  const last = parts.pop()!;
  const lines = parts.map(line => `${line}\n`);
  if (last !== '') lines.push(last);
  return lines;
}

/**
 * The shortest edit script from `a` to `b` (Myers 1986), or `null` past `maxEdits`.
 * Each step's frontier is kept only over the diagonals it reached, so the memory is
 * about `maxEdits` squared, not `maxEdits` times the length.
 */
function editScript(a: readonly string[], b: readonly string[], maxEdits: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const offset = maxEdits + 1;
  const v = new Int32Array(2 * maxEdits + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= maxEdits && found < 0; d++) {
    // The frontier as the previous step left it, over the diagonals this step reads.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const frontier = trace[d]!;
    const at = (k: number) => frontier[k + d + 1]!;
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = d === 0 ? 0 : at(previousK);
    const previousY = d === 0 ? 0 : previousX - previousK;
    while (x > previousX && y > previousY) {
      x--;
      y--;
      ops.push({ kind: ' ', line: a[x]! });
    }
    if (d > 0) {
      if (x === previousX) {
        y--;
        ops.push({ kind: '+', line: b[y]! });
      } else {
        x--;
        ops.push({ kind: '-', line: a[x]! });
      }
    }
  }
  return ops.reverse();
}

/** The line feeds in the bytes, counted without decoding or copying them. */
function lineFeeds(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) count++;
  return count;
}

/** Whether two byte arrays hold the same bytes, compared without decoding or copying either. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function rangeOf(start: number, length: number): string {
  // An empty range names the line before it, as `diff -u` does (`-0,0` for an empty old file).
  const first = length === 0 ? start : start + 1;
  return length === 1 ? `${first}` : `${first},${length}`;
}

function renderLine(op: Op): string {
  const body = op.line.endsWith('\n') ? op.line : `${op.line}\n\\ No newline at end of file\n`;
  return `${op.kind}${body}`;
}

/**
 * The unified diff of `before` and `after` as the file at `path`, with `CONTEXT_LINES`
 * lines of context: `''` when the bytes are the same, `null` when either is not text
 * or the diff is not practical (the limits above).
 */
export function textDiff(path: string, before: Uint8Array, after: Uint8Array): string | null {
  // The same bytes are no change, whatever they are, and nothing is decoded to say so.
  if (sameBytes(before, after)) return '';
  if (before.length > MAX_DIFF_BYTES || after.length > MAX_DIFF_BYTES) return null;
  if (lineFeeds(before) > MAX_DIFF_FILE_LINES || lineFeeds(after) > MAX_DIFF_FILE_LINES) return null;
  const oldText = textOf(before);
  const newText = textOf(after);
  if (oldText === null || newText === null) return null;
  if (oldText === newText) return '';
  const a = linesOf(oldText);
  const b = linesOf(newText);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const middleA = a.slice(prefix, a.length - suffix);
  const middleB = b.slice(prefix, b.length - suffix);
  if (middleA.length + middleB.length > MAX_DIFF_LINES) return null;
  const middle = editScript(middleA, middleB, MAX_DIFF_EDITS);
  if (middle === null) return null;
  // Only the context a hunk can show is kept of the common prefix and suffix, so no unchanged line beyond it
  // becomes an op; the line numbers start where the kept prefix starts.
  const keptPrefix = Math.min(prefix, CONTEXT_LINES);
  const keptSuffix = Math.min(suffix, CONTEXT_LINES);
  const ops: Op[] = [
    ...a.slice(prefix - keptPrefix, prefix).map((line): Op => ({ kind: ' ', line })),
    ...middle,
    ...a.slice(a.length - suffix, a.length - suffix + keptSuffix).map((line): Op => ({ kind: ' ', line })),
  ];

  // Hunks: each change with its context, changes closer than twice the context joined into one.
  const changed = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]));
  const hunks: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(ops.length, index + CONTEXT_LINES + 1);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1]) last[1] = end;
    else hunks.push([start, end]);
  }
  let out = `--- a/${path}\n+++ b/${path}\n`;
  // Line numbers before each op, in the old and the new file.
  let oldLine = prefix - keptPrefix;
  let newLine = prefix - keptPrefix;
  let cursor = 0;
  for (const [start, end] of hunks) {
    for (; cursor < start; cursor++) {
      if (ops[cursor]!.kind !== '+') oldLine++;
      if (ops[cursor]!.kind !== '-') newLine++;
    }
    const slice = ops.slice(start, end);
    const oldLength = slice.filter(op => op.kind !== '+').length;
    const newLength = slice.filter(op => op.kind !== '-').length;
    out += `@@ -${rangeOf(oldLine, oldLength)} +${rangeOf(newLine, newLength)} @@\n`;
    for (const op of slice) out += renderLine(op);
    if (out.length > MAX_DIFF_CHARS) return null;
  }
  return out;
}
