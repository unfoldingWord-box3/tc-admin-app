// Upload identification (#72, product spec §8): each uploaded or imported
// file is identified as a book or story before anything is written. A USFM
// file's book comes from the `\id` line of its header, checked against its
// name; a story's number comes from its name, `01.md` or `1.md` for story 1
// (E36). A Bible project takes USFM files and an Open Bible Stories project
// numbered markdown files (§8 "Uploads"), so a file of the other kind
// identifies nothing. A file whose header and name disagree, or that
// identifies nothing, is `identified: null`, held back until the manager names
// its book or story; `upload.apply` refuses it as `unidentified_file` until
// then. An identified or confirmed file takes its Scripture Burrito path and
// ingredient entry from the writer (`burrito.ts`, W1), never from the name it
// was uploaded under. Names arrive already checked for safety and size (W6,
// #73). Pure: no I/O, no Door43 shape.

import { bookId, storyId } from './books';
import { unitIngredient, unitPath } from './burrito';
import type { CreatableProjectType, Unit, UnitIngredient } from './burrito';

/** A file the manager uploaded, or one an import took from a source's archive. */
export interface UploadedFile {
  /** The repository-relative name it arrived under; only its base name is read. */
  name: string;
  /** The file's bytes, whole: the ingredient entry's size and md5 are computed from them (R10). */
  bytes: Uint8Array;
}

/**
 * Why a file identifies nothing, for the manager's choice:
 * `header_name_mismatch`, the `\id` line names a book the name does not;
 * `no_book_in_header`, a USFM file whose first marker is not `\id` with a book code;
 * `no_book_in_name`, a USFM file whose name names no book to check the header against;
 * `not_a_book_or_story`, neither a USFM file in a Bible project nor a numbered
 * story file in an Open Bible Stories project, or a confirmation naming neither.
 */
export type UnidentifiedReason = 'header_name_mismatch' | 'no_book_in_header' | 'no_book_in_name' | 'not_a_book_or_story';

/** A file identified as one book or story, with its Scripture Burrito path and ingredient entry (W1, E36). */
export interface IdentifiedFile {
  name: string;
  identified: Unit;
  path: string;
  ingredient: UnitIngredient;
}

/** A file held back until the manager names its book or story (`unidentified_file`). It has no path: nothing is written for it. */
export interface UnidentifiedFile {
  name: string;
  identified: null;
  reason: UnidentifiedReason;
}

export type Identification = IdentifiedFile | UnidentifiedFile;

/** How much of a file's start is read for its `\id` line: the identification line is the first line of a USFM file. */
export const HEADER_BYTES = 1024;

const USFM_NAME = /\.usfm$/i;
/** A story file's name (E36): `01.md` or `1.md` for story 1. */
const STORY_NAME = /^(\d{1,2})\.md$/i;

const baseName = (name: string) => name.slice(name.lastIndexOf('/') + 1);

/**
 * The book the `\id` line names, or `null`. Only the first marker counts: after an
 * optional byte-order mark and white space the file must open with `\id`, a space or
 * tab, and a book code, in any case (`\id 1co undefined` is 1 Corinthians, E17). Needs
 * only the header bytes; anything past `HEADER_BYTES` is not read.
 */
export function headerBook(header: Uint8Array): string | null {
  // The decoder drops a leading byte-order mark; a character cut at the window's end becomes U+FFFD, past the code.
  const text = new TextDecoder('utf-8').decode(header.subarray(0, HEADER_BYTES));
  const match = /^\s*\\id[ \t]+(\S+)/.exec(text);
  return match ? bookId(match[1]!) : null;
}

/**
 * The books a USFM file's name names: each token of the base name without its
 * extension, split at anything but a letter or digit, that is a book code in any
 * case. `MAT.usfm`, `41-MAT.usfm`, `en_ult_41-MAT.usfm`, and `mat.usfm` each name
 * Matthew; `A0-FRT.usfm` names no book.
 */
export function nameBooks(name: string): Set<string> {
  const stem = baseName(name).replace(USFM_NAME, '');
  return new Set(stem.split(/[^A-Za-z0-9]+/).flatMap(token => bookId(token) ?? []));
}

/** The story a name names (E36): `01.md` or `1.md` is story `01`, up to `50.md`; anything else, `00.md` and `051.md` among them, is `null`. */
export function nameStory(name: string): string | null {
  const match = STORY_NAME.exec(baseName(name));
  return match ? storyId(match[1]!.padStart(2, '0')) : null;
}

function identifiedAs(file: UploadedFile, unit: Unit): IdentifiedFile {
  return { name: file.name, identified: unit, path: unitPath(unit), ingredient: unitIngredient(unit, file.bytes) };
}

const heldBack = (file: UploadedFile, reason: UnidentifiedReason): UnidentifiedFile => ({ name: file.name, identified: null, reason });

/**
 * One file identified for a project of the given type (product spec §8). A USFM
 * file in a Bible project is its `\id` line's book when the name names that book
 * too; when the name names other books only, or none, or the header names none,
 * it is held back. A file named `<N>.md` or `<NN>.md` in an Open Bible Stories
 * project is that story. Anything else identifies nothing.
 */
export function identifyFile(file: UploadedFile, projectType: CreatableProjectType): Identification {
  if (projectType === 'obs') {
    const story = nameStory(file.name);
    return story ? identifiedAs(file, { story }) : heldBack(file, 'not_a_book_or_story');
  }
  if (!USFM_NAME.test(baseName(file.name))) return heldBack(file, 'not_a_book_or_story');
  const book = headerBook(file.bytes);
  if (book === null) return heldBack(file, 'no_book_in_header');
  const named = nameBooks(file.name);
  if (named.size === 0) return heldBack(file, 'no_book_in_name');
  if (!named.has(book)) return heldBack(file, 'header_name_mismatch');
  return identifiedAs(file, { book });
}

/**
 * A manager's confirmation applied to a file (`upload.apply`'s `confirmations`):
 * the book or story it names becomes the file's identification, whatever the
 * header or name say, with the Scripture Burrito path and ingredient entry of
 * that unit (W1). A confirmation that names no book of a Bible project, or no
 * story of an Open Bible Stories project, leaves the file held back. Book codes
 * are read in any case and story numbers with or without the leading zero.
 */
export function confirmFile(file: UploadedFile, confirmation: Unit, projectType: CreatableProjectType): Identification {
  if (projectType === 'bible') {
    const book = 'book' in confirmation ? bookId(confirmation.book) : null;
    return book ? identifiedAs(file, { book }) : heldBack(file, 'not_a_book_or_story');
  }
  const story = 'story' in confirmation ? storyId(confirmation.story.trim().padStart(2, '0')) : null;
  return story ? identifiedAs(file, { story }) : heldBack(file, 'not_a_book_or_story');
}
