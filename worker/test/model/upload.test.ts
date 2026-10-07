// Upload identification (#72, product spec §8): a USFM file is the book its
// `\id` line names when its name names it too; a story is the number of its
// name (E36); anything else, or a disagreement, is held back as
// `identified: null` until the manager confirms a book or story (W6,
// `unidentified_file`). An identified or confirmed file always takes the
// Scripture Burrito path and an ingredient entry the schema accepts (W1, E37).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import { BIBLE_BOOKS, STORIES } from '../../src/model/books';
import { unitIngredient, unitPath } from '../../src/model/burrito';
import { parseMetadata } from '../../src/model/burrito-reader';
import { HEADER_BYTES, confirmFile, headerBook, identifyFile, nameBooks, nameStory } from '../../src/model/upload';
import type { Identification, UploadedFile } from '../../src/model/upload';

const encode = (text: string) => new TextEncoder().encode(text);
const file = (name: string, text: string): UploadedFile => ({ name, bytes: encode(text) });
const usfm = (code: string) => `\\id ${code} EN_ULT en_English_ltr\n\\usfm 3.0\n\\ide UTF-8\n\\h Book\n\\c 1\n\\v 1 In the beginning.\n`;
const reference = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const BOM = '\uFEFF';

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
for (const schema of schemaFiles(SCHEMA_DIR)) ajv.addSchema(JSON.parse(readFileSync(schema, 'utf8')) as object);
const validateIngredients = ajv.getSchema('https://burrito.bible/schema/ingredients.schema.json')!;

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const archive = (path: string) => openArchive(new Uint8Array(readFileSync(new URL(path, fixtures))));

/** What a result identifies and where it would be written; `null` for a held-back file, which has no path. */
const placed = (result: Identification) => (result.identified === null ? null : { identified: result.identified, path: result.path });

describe('a USFM file in a Bible project', () => {
  test.each(['MAT.usfm', '41-MAT.usfm', 'en_ult_41-MAT.usfm', 'mat.usfm', 'Mat.USFM', 'books/nt/41-MAT.usfm', 'dan_ult_41-MAT.usfm'])(
    'W1: %s with \\id MAT is Matthew, at ingredients/MAT.usfm',
    name => {
      const upload = file(name, usfm('MAT'));
      const result = identifyFile(upload, 'bible');
      expect(placed(result)).toEqual({ identified: { book: 'mat' }, path: 'ingredients/MAT.usfm' });
      if (result.identified === null) return;
      expect(result.name).toBe(name);
      expect(result.ingredient).toEqual({ checksum: { md5: reference(upload.bytes) }, mimeType: 'text/x-usfm', size: upload.bytes.length, scope: { MAT: [] } });
    },
  );

  test('W1: a numbered book code is read whole, so 1 John is not John', () => {
    expect(placed(identifyFile(file('62-1JN.usfm', usfm('1JN')), 'bible'))).toEqual({ identified: { book: '1jn' }, path: 'ingredients/1JN.usfm' });
    expect(identifyFile(file('62-1JN.usfm', usfm('JHN')), 'bible')).toEqual({ name: '62-1JN.usfm', identified: null, reason: 'header_name_mismatch' });
  });

  test('W6: a USFM file whose \\id and name disagree is held back with no path', () => {
    const result = identifyFile(file('08-RUT.usfm', usfm('JON')), 'bible');
    expect(result).toEqual({ name: '08-RUT.usfm', identified: null, reason: 'header_name_mismatch' });
    expect(result).not.toHaveProperty('path');
  });

  test.each([
    ['no \\id line', '\\c 1\n\\v 1 In the beginning.\n'],
    ['an empty file', ''],
    ['\\ide before \\id', '\\ide UTF-8\n\\id MAT\n'],
    ['\\usfm before \\id: only the first marker counts', '\\usfm 3.0\n\\id MAT\n'],
    ['text before \\id', 'Matthew\n\\id MAT\n'],
    ['\\id with no code', '\\id\n\\c 1\n'],
    ['\\id with its code on the next line', '\\id\nMAT\n'],
    ['\\id naming no Bible book', '\\id FRT front matter\n'],
    ['\\id glued to its code', '\\idMAT\n'],
    [`\\id past the first ${HEADER_BYTES} bytes`, `${' '.repeat(HEADER_BYTES)}\\id MAT\n`],
  ])('W6: a USFM file with %s is held back', (_, text) => {
    expect(identifyFile(file('MAT.usfm', text), 'bible')).toEqual({ name: 'MAT.usfm', identified: null, reason: 'no_book_in_header' });
  });

  test('W6: a USFM file whose name names no book is held back, the header unconfirmed', () => {
    expect(identifyFile(file('genesis.usfm', usfm('GEN')), 'bible')).toEqual({ name: 'genesis.usfm', identified: null, reason: 'no_book_in_name' });
    expect(identifyFile(file('41.usfm', usfm('MAT')), 'bible')).toEqual({ name: '41.usfm', identified: null, reason: 'no_book_in_name' });
  });

  test.each(['notes.txt', 'MAT.txt', 'MAT.usfm.bak', 'MAT.sfm', '01.md', 'README.md', 'metadata.json'])('W6: %s in a Bible project is neither USFM nor a story the project takes, and is held back', name => {
    expect(identifyFile(file(name, usfm('MAT')), 'bible')).toEqual({ name, identified: null, reason: 'not_a_book_or_story' });
  });
});

describe('the \\id line', () => {
  test.each([
    ['a plain header', '\\id GEN Genesis\n'],
    ['a byte-order mark', `${BOM}\\id GEN\n`],
    ['Windows line endings', '\\id GEN\r\n\\usfm 3.0\r\n'],
    ['a code alone at the end of the file', '\\id GEN'],
    ['leading white space and blank lines', '\r\n\n  \\id GEN\n'],
    ['a tab after the marker', '\\id\tGEN\n'],
    ['a lowercase code, as Scribe wrote Pendau (E17)', '\\id gen undefined\n'],
    ['a later \\id: only the first counts', '\\id GEN\n\\c 1\n\\id EXO\n'],
  ])('names its book with %s', (_, text) => {
    expect(headerBook(encode(text))).toBe('gen');
  });

  test('needs only the header bytes', () => {
    const header = encode(usfm('REV')).subarray(0, 12);
    expect(headerBook(header)).toBe('rev');
  });
});

describe('a file name', () => {
  test('names the books its tokens are, in any case', () => {
    expect([...nameBooks('en_ult_41-MAT.usfm')]).toEqual(['mat']);
    expect([...nameBooks('folder/09-1sa.usfm')]).toEqual(['1sa']);
    expect([...nameBooks('A0-FRT.usfm')]).toEqual([]);
    expect([...nameBooks('est_ult_17-EST.usfm')]).toEqual(['est']);
  });

  test('E36: names a story by its number, with or without the leading zero', () => {
    expect(nameStory('01.md')).toBe('01');
    expect(nameStory('1.md')).toBe('01');
    expect(nameStory('content/7.md')).toBe('07');
    expect(nameStory('50.md')).toBe('50');
    for (const name of ['51.md', '0.md', '00.md', '051.md', '001.md', '1.txt', 'front.md', 'story-1.md', '1.md.bak']) expect(nameStory(name), name).toBeNull();
  });
});

describe('a markdown file in an Open Bible Stories project', () => {
  test.each([
    ['01.md', '01'],
    ['1.md', '01'],
    ['50.md', '50'],
    ['ingredients/content/07.md', '07'],
  ])('E36: %s is story %s, at ingredients/content/<NN>.md', (name, story) => {
    expect(placed(identifyFile(file(name, '# A story\n'), 'obs'))).toEqual({ identified: { story }, path: `ingredients/content/${story}.md` });
  });

  test('W1: a story is markdown with the size and md5 of its bytes, and no scope, since tC Admin holds no per-story passages', () => {
    const upload = file('3.md', '# 3. The Flood\n\nA long time ago...\n');
    const result = identifyFile(upload, 'obs');
    expect(result.identified).toEqual({ story: '03' });
    if (result.identified === null) return;
    expect(result.ingredient).toEqual({ checksum: { md5: reference(upload.bytes) }, mimeType: 'text/markdown', size: upload.bytes.length });
  });

  test.each(['51.md', '0.md', '00.md', '051.md', 'front.md', 'back.md', '1.txt', 'MAT.usfm', '01.usfm'])('W6: %s identifies no story and is held back', name => {
    expect(identifyFile(file(name, usfm('MAT')), 'obs')).toEqual({ name, identified: null, reason: 'not_a_book_or_story' });
  });
});

describe("the manager's confirmation", () => {
  test.each([
    ['a file whose header and name disagree', '08-RUT.usfm', usfm('JON'), { book: 'jon' }, { book: 'jon' }, 'ingredients/JON.usfm'],
    ['a file whose name names no book', 'genesis.usfm', usfm('GEN'), { book: 'GEN' }, { book: 'gen' }, 'ingredients/GEN.usfm'],
    ['a file that is not USFM by its name', 'my book.txt', usfm('MRK'), { book: 'mrk' }, { book: 'mrk' }, 'ingredients/MRK.usfm'],
    ['an identified file re-identified', 'MAT.usfm', usfm('MAT'), { book: 'luk' }, { book: 'luk' }, 'ingredients/LUK.usfm'],
  ] as const)('W1: for %s takes the Scripture Burrito path whatever the uploaded name', (_, name, text, confirmation, unit, path) => {
    const upload = file(name, text);
    const result = confirmFile(upload, confirmation, 'bible');
    expect(placed(result)).toEqual({ identified: unit, path });
    if (result.identified === null) return;
    expect(result.ingredient).toEqual(unitIngredient(unit, upload.bytes));
  });

  test.each([
    [{ story: '7' }, '07'],
    [{ story: '07' }, '07'],
    [{ story: '50' }, '50'],
  ])('W1: a story confirmation %o puts the file at ingredients/content/%s.md', (confirmation, story) => {
    expect(placed(confirmFile(file('Story seven.md', '# 7\n'), confirmation, 'obs'))).toEqual({ identified: { story }, path: `ingredients/content/${story}.md` });
  });

  test.each([
    [{ book: 'xyz' }, 'bible'],
    [{ book: 'frt' }, 'bible'],
    [{ story: '01' }, 'bible'],
    [{ book: 'mat' }, 'obs'],
    [{ story: '51' }, 'obs'],
    [{ story: '0' }, 'obs'],
    [{ story: '001' }, 'obs'],
  ] as const)('W6: a confirmation %o in a %s project names nothing the project takes, and the file stays held back', (confirmation, type) => {
    expect(confirmFile(file('x.usfm', usfm('MAT')), confirmation, type)).toEqual({ name: 'x.usfm', identified: null, reason: 'not_a_book_or_story' });
  });
});

describe('the Scripture Burrito path and entry', () => {
  test('W1: every book and story has a path and entry the Scripture Burrito schema accepts (E37, E44)', () => {
    const bytes = encode(usfm('GEN'));
    const ingredients = Object.fromEntries([...BIBLE_BOOKS.map(book => ({ book })), ...STORIES.map(story => ({ story }))].map(unit => [unitPath(unit), unitIngredient(unit, bytes)]));
    expect(Object.keys(ingredients)).toHaveLength(66 + 50);
    expect(validateIngredients(ingredients), JSON.stringify(validateIngredients.errors)).toBe(true);
  });

  test('W1: the writer builds a path only from a recognized book or story id', () => {
    for (const unit of [{ book: 'MAT' }, { book: '../MAT' }, { book: 'xyz' }, { story: '1' }, { story: '51' }, { story: '../01' }]) {
      expect(() => unitPath(unit), JSON.stringify(unit)).toThrow(RangeError);
      expect(() => unitIngredient(unit, new Uint8Array()), JSON.stringify(unit)).toThrow(RangeError);
    }
  });
});

describe('the recorded archives', () => {
  test.each([
    '2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip',
    '2026-09-21/sb-archives/bahtraku__id_tb1__master.zip',
    '2026-10-07/sb-archives/birch__en_web_mrk_book__master.zip',
    '2026-10-07/sb-archives/birch__es-419_tit_text_reg__master.zip',
  ])('E17: every book of %s identifies as itself from its header and name, with the size the archive declares', async path => {
    const zip = archive(path);
    const books = zip.entries.filter(entry => entry.path.endsWith('.usfm'));
    expect(books.length).toBeGreaterThan(0);
    for (const entry of books) {
      const result = identifyFile({ name: entry.path, bytes: await zip.bytes(entry.path) }, 'bible');
      expect(result.identified === null ? result.reason : result.path, entry.path).toBe(entry.path);
      if (result.identified !== null) expect(result.ingredient.size).toBe(entry.size);
    }
  });

  test("E17, R10: a converted book's entry carries the md5 the converter wrote, which is not stale", async () => {
    const zip = archive('2026-09-21/sb-archives/bahtraku__id_tb1__master.zip');
    const metadata = parseMetadata(await zip.bytes('metadata.json'));
    const written = metadata.ingredients.find(ingredient => ingredient.path === 'ingredients/RUT.usfm');
    const result = identifyFile({ name: '08-RUT.usfm', bytes: await zip.bytes('ingredients/RUT.usfm') }, 'bible');
    expect(result.identified).toEqual({ book: 'rut' });
    if (result.identified === null) return;
    expect(result.ingredient.checksum.md5).toBe(written?.md5);
    expect(result.ingredient.size).toBe(written?.size);
  });

  test('E14, E18: a book under its Resource Container name, 01-GEN.usfm, identifies as Genesis at ingredients/GEN.usfm', async () => {
    const zip = archive('2026-09-21/sb-archives/bahtraku__id_tb1__master.zip');
    expect(placed(identifyFile({ name: '01-GEN.usfm', bytes: await zip.bytes('ingredients/GEN.usfm') }, 'bible'))).toEqual({ identified: { book: 'gen' }, path: 'ingredients/GEN.usfm' });
  });

  test('E36: every story of the recorded Open Bible Stories archive identifies as itself, and front.md and back.md identify nothing', async () => {
    const zip = archive('2026-10-01/sb-archives/unfoldingWord__en_obs__v9.zip');
    const content = zip.entries.filter(entry => entry.path.startsWith('ingredients/content/'));
    const identified = [];
    for (const entry of content) {
      const result = identifyFile({ name: entry.path, bytes: await zip.bytes(entry.path) }, 'obs');
      if (result.identified === null) expect(['ingredients/content/front.md', 'ingredients/content/back.md'], entry.path).toContain(entry.path);
      else {
        expect(result.path).toBe(entry.path);
        identified.push(result.identified);
      }
    }
    expect(identified).toEqual(STORIES.map(story => ({ story })));
  });
});
