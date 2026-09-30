// The recognized content units: the 66 Bible books by testament, in canonical
// order, and the 50 Open Bible Stories. Ids are the lowercase USFM book codes
// Door43 uses as ingredient identifiers (E14) and two-digit story numbers.

export const OLD_TESTAMENT: readonly string[] = [
  'gen', 'exo', 'lev', 'num', 'deu', 'jos', 'jdg', 'rut', '1sa', '2sa', '1ki', '2ki', '1ch', '2ch',
  'ezr', 'neh', 'est', 'job', 'psa', 'pro', 'ecc', 'sng', 'isa', 'jer', 'lam', 'ezk', 'dan', 'hos',
  'jol', 'amo', 'oba', 'jon', 'mic', 'nam', 'hab', 'zep', 'hag', 'zec', 'mal',
];

export const NEW_TESTAMENT: readonly string[] = [
  'mat', 'mrk', 'luk', 'jhn', 'act', 'rom', '1co', '2co', 'gal', 'eph', 'php', 'col', '1th', '2th',
  '1ti', '2ti', 'tit', 'phm', 'heb', 'jas', '1pe', '2pe', '1jn', '2jn', '3jn', 'jud', 'rev',
];

export const BIBLE_BOOKS: readonly string[] = [...OLD_TESTAMENT, ...NEW_TESTAMENT];

export const STORIES: readonly string[] = Array.from({ length: 50 }, (_, i) => String(i + 1).padStart(2, '0'));

const OT = new Set(OLD_TESTAMENT);
const NT = new Set(NEW_TESTAMENT);
const STORY = new Set(STORIES);

/** The book id in canonical spelling, or `null` when the value is not a Bible book. */
export function bookId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return OT.has(id) || NT.has(id) ? id : null;
}

/** The story id in canonical spelling, or `null` when the value is not one of the 50 stories. */
export function storyId(value: string): string | null {
  const id = value.trim();
  return STORY.has(id) ? id : null;
}

export function testamentOf(book: string): 'ot' | 'nt' | null {
  return OT.has(book) ? 'ot' : NT.has(book) ? 'nt' : null;
}
