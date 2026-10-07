// Candidate detection (#33): books grouped by blob SHA across the two refs,
// the plan's default selection (R4), removals listed (R2), and the files
// always carried from the default branch (R1).
import { describe, expect, test } from 'vitest';
import { administrativeFiles, defaultSelection, detectCandidates, groupOf, removals, unitFiles } from '../../src/model/candidates';
import type { RefContent } from '../../src/model/candidates';
import type { CatalogIngredient } from '../../src/model/project';

const ingredient = (id: string, path: string, title = ''): CatalogIngredient => ({ id, path, exists: true, is_dir: false, title });
const ref = (books: [string, string][], extraFiles: [string, string][] = []): RefContent => ({
  ingredients: books.map(([id]) => ingredient(id, `./ingredients/${id.toUpperCase()}.usfm`, id === 'mat' ? 'Matius' : '')),
  files: [...books.map(([id, sha]): [string, string] => [`ingredients/${id.toUpperCase()}.usfm`, sha]), ...extraFiles].map(([path, sha]) => ({ path, sha })),
});
const root: [string, string][] = [['LICENSE.md', 'l1'], ['README.md', 'r1'], ['metadata.json', 'm1'], ['.gitea/workflows/check.yml', 'w1'], ['ingredients/license.md', 'il']];

describe('units of a ref', () => {
  test('a Bible\'s books come from the catalog, each with the blob SHA the tree gives its path; a listed book without a file has no SHA', () => {
    const content = ref([['mat', 'aaa'], ['mrk', 'bbb']]);
    content.ingredients = [...content.ingredients!, ingredient('luk', './ingredients/LUK.usfm'), ingredient('obs', './ingredients', 'container'), { ...ingredient('mat', './ingredients/MAT.usfm'), id: 'MAT' }];
    (content.ingredients[3] as { is_dir: boolean }).is_dir = true;
    expect(unitFiles('bible', content)).toEqual([
      { id: 'mat', path: 'ingredients/MAT.usfm', title: 'Matius', sha: 'aaa', size: null },
      { id: 'mrk', path: 'ingredients/MRK.usfm', title: '', sha: 'bbb', size: null },
      { id: 'luk', path: 'ingredients/LUK.usfm', title: '', sha: null, size: null },
    ]);
    expect(unitFiles('bible', { ingredients: null, files: content.files })).toEqual([]);
  });

  test('an Open Bible Stories ref\'s stories come from the tree, ingredients/content/<NN>.md (E36), since the catalog lists only the container (E47)', () => {
    const files = [['ingredients/content/01.md', 's1'], ['ingredients/content/2.md', 's2'], ['ingredients/content/front.md', 'f'], ['ingredients/content/51.md', 'x'], ['content/03.md', 'y']].map(([path, sha]) => ({ path: path!, sha: sha! }));
    expect(unitFiles('obs', { ingredients: [{ id: 'obs', path: './ingredients', exists: true, is_dir: true }], files })).toEqual([
      { id: '01', path: 'ingredients/content/01.md', title: '', sha: 's1', size: null },
      { id: '02', path: 'ingredients/content/2.md', title: '', sha: 's2', size: null },
    ]);
  });
});

describe('groups and defaults', () => {
  const on = (sha: string | null) => ({ id: 'mat', path: 'ingredients/MAT.usfm', title: '', sha, size: null });

  test('the group follows the SHAs: new, unchanged, changed released, and unknown when a file is missing', () => {
    expect(groupOf(on('a'), null)).toBe('new');
    expect(groupOf(on('a'), on('a'))).toBe('unchanged');
    expect(groupOf(on('a'), on('b'))).toBe('changed_released');
    expect(groupOf(null, on('b'))).toBe('unchanged');
    expect(groupOf(on(null), on('b'))).toBe('unknown');
    expect(groupOf(on('a'), on(null))).toBe('unknown');
  });

  test('R4: a first release includes every book; a later one carries every released book forward, changed or not, and leaves every new one out', () => {
    const released = { default_branch: on('a'), baseline: on('b') };
    const fresh = { default_branch: on('a'), baseline: null };
    expect(defaultSelection('bible', released, true)).toBe('include');
    expect(defaultSelection('bible', fresh, true)).toBe('include');
    expect(defaultSelection('bible', released, false)).toBe('carry_forward');
    expect(defaultSelection('bible', { default_branch: null, baseline: on('b') }, false)).toBe('carry_forward');
    expect(defaultSelection('bible', fresh, false)).toBe('leave_out');
    // Open Bible Stories: the whole default branch, so a story on it is included and one no longer on it cannot be.
    expect(defaultSelection('obs', released, false)).toBe('include');
    expect(defaultSelection('obs', { default_branch: null, baseline: on('b') }, false)).toBe('leave_out');
  });
});

describe('a release of a Bible', () => {
  const baseline = ref([['mat', 'm1'], ['mrk', 'k1'], ['rut', 'r1']], [['LICENSE.md', 'old'], ['README.md', 'old']]);
  const branch = ref([['mat', 'm2'], ['mrk', 'k1'], ['jon', 'j1']], root);

  test('groups every book on either ref and starts them as R4 says, in canonical order', () => {
    const { books } = detectCandidates('bible', branch, baseline);
    expect(books.map(book => [book.id, book.group, book.selection])).toEqual([
      ['rut', 'unchanged', 'carry_forward'],
      ['jon', 'new', 'leave_out'],
      ['mat', 'changed_released', 'carry_forward'],
      ['mrk', 'unchanged', 'carry_forward'],
    ]);
    expect(books.find(book => book.id === 'rut')).toMatchObject({ default_branch: null, baseline: { sha: 'r1' } });
    expect(books.find(book => book.id === 'mat')).toMatchObject({ default_branch: { sha: 'm2', title: 'Matius' }, baseline: { sha: 'm1' } });
  });

  test('R2: the default selection leaves no released book out, so the plan lists no removal; a book set to leave out is listed', () => {
    const candidates = detectCandidates('bible', branch, baseline);
    expect(candidates.removals).toEqual([]);
    expect(candidates.books.filter(book => book.baseline).every(book => book.selection === 'carry_forward')).toBe(true);
    const edited = candidates.books.map(book => (book.id === 'rut' || book.id === 'jon' ? { ...book, selection: 'leave_out' as const } : book));
    expect(removals(edited)).toEqual(['rut']);
  });

  test('R4: a first release includes every book, and nothing is a removal', () => {
    const { books, removals: removed } = detectCandidates('bible', branch, null);
    expect(books.map(book => [book.id, book.group, book.selection])).toEqual([
      ['jon', 'new', 'include'],
      ['mat', 'new', 'include'],
      ['mrk', 'new', 'include'],
    ]);
    expect(removed).toEqual([]);
  });

  test('R1: the administrative files are the default branch\'s root files and .gitea/, never the baseline\'s, and never the metadata the release rewrites', () => {
    expect(detectCandidates('bible', branch, baseline).administrative).toEqual(['.gitea/workflows/check.yml', 'LICENSE.md', 'README.md']);
    expect(administrativeFiles([{ path: 'metadata.json', sha: 'm' }, { path: 'ingredients/MAT.usfm', sha: 'a' }])).toEqual([]);
  });
});

describe('a release of Open Bible Stories', () => {
  const story = (n: string, sha: string): [string, string] => [`ingredients/content/${n}.md`, sha];
  test('R2: every story on the default branch is included, and a story the release had but the branch lost is a removal, listed', () => {
    const baseline: RefContent = { ingredients: null, files: [story('01', 'a'), story('02', 'b')].map(([path, sha]) => ({ path, sha })) };
    const branch: RefContent = { ingredients: null, files: [story('01', 'a'), story('03', 'c')].map(([path, sha]) => ({ path, sha })) };
    const candidates = detectCandidates('obs', branch, baseline);
    expect(candidates.books.map(book => [book.id, book.group, book.selection])).toEqual([
      ['01', 'unchanged', 'include'],
      ['02', 'unchanged', 'leave_out'],
      ['03', 'new', 'include'],
    ]);
    expect(candidates.removals).toEqual(['02']);
  });
});
