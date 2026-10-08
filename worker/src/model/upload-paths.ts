// Upload path safety and size limits (W6, product spec §8, #73): every name
// in an upload batch, and the batch as a whole, checked before anything else
// looks at it, before identification (#72) and before any Door43 read. A name
// is accepted only as a repository-relative path inside the project; an entry
// the client reports as a symlink, as something other than a regular file, or
// as executable is refused; so is a file or a batch over `MAX_UPLOAD_BYTES`.
// Every problem in the batch is reported at once, each naming its file, as one
// `validation_failed`. Pure.
//
// The sizes checked are the lengths of the bytes the request carried, measured
// by `upload.plan` (#74): the client declares no size, so there is none to
// trust or to disagree with (decided 8 October 2026 by Rich, Q33).

import { CatalogError } from '@tc-admin/shared/schema';

/**
 * The most bytes one upload batch may carry, and so the most one file in it
 * may carry: one configuration value (#73). Proposal (labeled), Q15 open
 * (Rich): the raw bytes one commit carries at most (`MAX_COMMIT_BYTES`, Q22),
 * since an upload is one commit the Worker holds whole (W5, E30); Door43
 * accepted far more in one commit (E31), so the Worker is the bound.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** One file of an `upload.plan` batch, as the check reads it. */
export interface UploadFile {
  name: string;
  /** The length of the bytes received (Q33). */
  size: number;
  /** The POSIX file mode the client read, when it has one (a zip entry, a local file); a browser reports none. */
  mode?: number | null | undefined;
}

/** Why a name does not stand for a path inside the project. */
export type NameReason = 'empty' | 'control_character' | 'percent_encoding' | 'absolute' | 'backslash' | 'empty_segment' | 'traversal' | 'git_directory';
/** Why an entry's reported mode is refused. */
export type ModeReason = 'symlink' | 'not_a_file' | 'executable';
/** Why a file of the batch is refused. */
export type UploadProblemReason = NameReason | ModeReason | 'too_large' | 'duplicate';

export interface UploadProblem {
  /** The name as the client sent it. */
  name: string;
  /** Its position in the batch, for the error's field path. */
  index: number;
  reason: UploadProblemReason;
  message: string;
}

export type UploadCheck<Entry extends UploadFile = UploadFile> =
  | { ok: true; files: Entry[] }
  | { ok: false; error: CatalogError; problems: UploadProblem[]; batch: { bytes: number; limit: number } | null };

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const EXECUTE_BITS = 0o111;

const REASON_TEXT: Record<NameReason | ModeReason, string> = {
  empty: 'the name is empty',
  control_character: 'the name contains a control character',
  percent_encoding: 'the name contains a percent sign',
  absolute: 'the path is absolute',
  backslash: 'the path contains a backslash',
  empty_segment: 'the path has an empty segment',
  traversal: 'the path leaves the project',
  git_directory: 'the path is inside a .git directory',
  symlink: 'the entry is a symbolic link',
  not_a_file: 'the entry is not a regular file',
  executable: 'the file is executable',
};

/**
 * The repository-relative path a name stands for, or why it does not stand for
 * one. `.` segments are dropped (`./a.usfm` is `a.usfm`); nothing else is
 * rewritten, and Unicode is kept as sent.
 */
export function normalizeUploadName(name: string): { ok: true; path: string } | { ok: false; reason: NameReason } {
  if (name.length === 0) return { ok: false, reason: 'empty' };
  // Unicode category Cc (C0 controls, the null byte, DEL, C1 controls), the line and
  // paragraph separators (Zl, Zp), and every format character (Cf: the bidirectional
  // controls, zero-width space, byte-order mark, soft hyphen, ...), any of which can
  // make a name display as another path, except ZWNJ and ZWJ (U+200C, U+200D), which
  // are spelling in Persian and Indic names. Written as escapes, so the check itself
  // holds no character that can reorder or hide its own source.
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(name) || /\p{Cf}/u.test(name.replace(/[\u200C\u200D]/gu, ''))) return { ok: false, reason: 'control_character' };
  // A percent sign, so no encoded `..` or `.git` (`%2e%2e/a.usfm`) can traverse if a later hop decodes the
  // name; no book, story, or project file needs one (decided 7 October 2026 by Rich, #116).
  if (name.includes('%')) return { ok: false, reason: 'percent_encoding' };
  // A leading slash or backslash (`/x`, `\\server\share`), or a drive (`C:\x`, `C:/x`, `C:x`).
  if (/^[/\\]/.test(name) || /^[A-Za-z]:/.test(name)) return { ok: false, reason: 'absolute' };
  if (name.includes('\\')) return { ok: false, reason: 'backslash' };
  const segments: string[] = [];
  // Segments are compared without ZWNJ and ZWJ, so a joiner cannot disguise `..`, `.git`, an empty segment, or a drive.
  const bare = (segment: string) => segment.replace(/[\u200C\u200D]/gu, '');
  for (const segment of name.split('/')) {
    if (bare(segment) === '') return { ok: false, reason: 'empty_segment' };
    if (bare(segment) === '..') return { ok: false, reason: 'traversal' };
    if (bare(segment).toLowerCase() === '.git') return { ok: false, reason: 'git_directory' };
    if (segment !== '.') segments.push(segment);
  }
  if (segments.length === 0) return { ok: false, reason: 'empty' };
  // A drive revealed by dropping `.` segments (`./C:/x`, `././c:x`).
  if (/^[A-Za-z]:/.test(bare(segments[0] ?? ''))) return { ok: false, reason: 'absolute' };
  return { ok: true, path: segments.join('/') };
}

/** Why an entry's reported mode is refused, or `null`; no mode is a regular file. */
export function modeProblem(mode: number | null | undefined): ModeReason | null {
  if (mode === null || mode === undefined) return null;
  const type = mode & S_IFMT;
  if (type === S_IFLNK) return 'symlink';
  // A mode with no type bits carries permissions only, as some zip writers record it.
  if (type !== S_IFREG && type !== 0) return 'not_a_file';
  if ((mode & EXECUTE_BITS) !== 0) return 'executable';
  return null;
}

const quoted = (name: string) => JSON.stringify(name);

/**
 * Check a batch before a plan is computed (W6). Accepted, every file comes back
 * with its name as the repository-relative path it stands for, in the order
 * sent; refused, the error names every file at fault and, when the files are
 * each within the limit but together exceed it, the batch.
 */
export function checkUpload<Entry extends UploadFile>(files: readonly Entry[], limit: number = MAX_UPLOAD_BYTES): UploadCheck<Entry> {
  const problems: UploadProblem[] = [];
  const accepted: Entry[] = [];
  const firstAt = new Map<string, number>();
  let bytes = 0;
  let fileOverLimit = false;

  for (const [index, file] of files.entries()) {
    bytes += file.size;
    const refuse = (reason: UploadProblemReason, text: string) => {
      problems.push({ name: file.name, index, reason, message: `${quoted(file.name)}: ${text}` });
    };
    const path = normalizeUploadName(file.name);
    if (!path.ok) {
      refuse(path.reason, REASON_TEXT[path.reason]);
      continue;
    }
    const mode = modeProblem(file.mode);
    if (mode) {
      refuse(mode, REASON_TEXT[mode]);
      continue;
    }
    if (file.size > limit) {
      fileOverLimit = true;
      refuse('too_large', `the file is ${file.size} bytes, over the limit of ${limit}`);
      continue;
    }
    const earlier = firstAt.get(path.path);
    if (earlier !== undefined) {
      refuse('duplicate', `the path ${quoted(path.path)} is also given by file ${earlier}`);
      continue;
    }
    firstAt.set(path.path, index);
    accepted.push({ ...file, name: path.path });
  }

  const batch = !fileOverLimit && bytes > limit ? { bytes, limit } : null;
  if (problems.length === 0 && batch === null) return { ok: true, files: accepted };

  const fields = problems.map(problem => ({ path: `files.${problem.index}.name`, message: problem.message }));
  if (batch) fields.push({ path: 'files', message: `the batch is ${batch.bytes} bytes, over the limit of ${batch.limit}` });
  const error = new CatalogError('validation_failed', {
    message: fields.map(field => `${field.path}: ${field.message}`).join('; '),
    details: { fields, files: problems.map(({ name, reason }) => ({ name, reason })), batch },
  });
  return { ok: false, error, problems, batch };
}
