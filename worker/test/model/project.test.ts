import { describe, expect, test } from 'vitest';
import { PROJECT_TYPES } from '@tc-admin/shared/schema';
import type { CoverageScope, ProjectType } from '@tc-admin/shared/schema';
import { BIBLE_BOOKS, NEW_TESTAMENT, OLD_TESTAMENT, STORIES } from '../../src/model/books';
import { SUPPORTED_FLAVORS, classifyProject, coverage, editability, offeredUnits, projectTypeFromFlavor, testamentScope } from '../../src/model/project';
import type { CatalogIngredient, ProjectCatalog } from '../../src/model/project';

const file = (id: string, exists = true): CatalogIngredient => ({ id, path: `./${id}.usfm`, exists, is_dir: false });
const dir = (id: string, path: string): CatalogIngredient => ({ id, path, exists: true, is_dir: true });
const bible = (ingredients: CatalogIngredient[] | null, extra: Partial<ProjectCatalog> = {}): ProjectCatalog => ({
  flavor: 'textTranslation',
  metadata_format: 'sb',
  ingredients,
  ...extra,
});

describe('project type', () => {
  test('project_type covers all three values from the Scripture Burrito flavor: the two flavors tC Admin manages, and other', () => {
    const seen = new Map<string, ProjectType>(['textTranslation', 'textStories', 'x-peripheralArticles'].map(flavor => [flavor, projectTypeFromFlavor(flavor)]));
    expect(Object.fromEntries(seen)).toEqual({
      'textTranslation': 'bible',
      'textStories': 'obs',
      'x-peripheralArticles': 'other',
    });
    expect(new Set(seen.values())).toEqual(new Set(PROJECT_TYPES));
    expect(SUPPORTED_FLAVORS).toEqual(['textTranslation', 'textStories']);
  });

  test('every other flavor Door43 carries is other, including the helps and the audio and braille scripture flavors (Q11, E42)', () => {
    for (const flavor of ['x-bcvnotes', 'x-bcvquestions', 'x-bcvarticles', 'x-peripheralArticles', 'x-obsnotes', 'x-juxtalinear', 'audioTranslation', 'embossedBrailleScripture', 'x-rawcistern']) {
      expect(projectTypeFromFlavor(flavor)).toBe('other');
    }
  });

  test('a missing, empty, differently cased, or unlisted flavor is other', () => {
    expect(projectTypeFromFlavor(null)).toBe('other');
    expect(projectTypeFromFlavor(undefined)).toBe('other');
    expect(projectTypeFromFlavor('')).toBe('other');
    expect(projectTypeFromFlavor('TextTranslation')).toBe('other');
    expect(projectTypeFromFlavor('scripture/textTranslation')).toBe('other');
  });
});

describe('editability', () => {
  test('other is unsupported with the reason stated, whatever its format', () => {
    for (const format of ['sb', 'rc', 'ts', 'tc'] as const) {
      const result = editability(format, 'other');
      expect(result.state).toBe('unsupported');
      expect(result.reason).toBe('tC Admin manages Bible and Open Bible Stories projects only. Release and editing are not available.');
    }
  });

  test('P1: every editability state carries a one-line reason, and another format offers an import', () => {
    expect(editability('sb', 'bible')).toEqual({ state: 'editable', reason: 'Scripture Burrito project. Release and editing are available.' });
    expect(editability('rc', 'bible')).toEqual({ state: 'unsupported', reason: 'Resource Container project. Import it into a new project to manage it here.' });
    expect(editability('ts', 'bible')).toEqual({ state: 'unsupported', reason: 'translationStudio project. Import it into a new project to manage it here.' });
    expect(editability('tc', 'bible')).toEqual({ state: 'unsupported', reason: 'translationCore project. Import it into a new project to manage it here.' });
    expect(editability('sb', 'obs').state).toBe('editable');
    expect(editability('rc', 'obs')).toEqual({ state: 'unsupported', reason: 'Resource Container project. Import it into a new project to manage it here.' });
    expect(editability('none', 'other')).toEqual({ state: 'unsupported', reason: 'Door43 found no project metadata it recognizes. Release and editing are not available.' });
  });

  test('W2: only a Scripture Burrito Bible or Open Bible Stories project is editable', () => {
    for (const format of ['sb', 'rc', 'ts', 'tc', 'none'] as const) {
      for (const type of ['bible', 'obs', 'other'] as const) {
        const state = editability(format, type).state;
        expect(state).toBe(format === 'sb' && type !== 'other' ? 'editable' : 'unsupported');
      }
    }
  });
});

describe('coverage by testament scope', () => {
  const scopes: Array<{ scope: CoverageScope; target: number; listed: readonly string[] }> = [
    { scope: 'nt', target: 27, listed: NEW_TESTAMENT },
    { scope: 'ot', target: 39, listed: OLD_TESTAMENT },
    { scope: 'full', target: 66, listed: BIBLE_BOOKS },
  ];

  test.each(scopes)('H5: a complete $scope Bible covers $target of $target with basis catalog', ({ scope, target, listed }) => {
    const result = coverage(bible(listed.map(id => file(id))), 'bible');
    expect(result).toMatchObject({ scope, target, present: target, basis: 'catalog' });
    expect(result.units).toHaveLength(target);
    expect(result.units.every(unit => unit.present)).toBe(true);
  });

  test('H5: a partial New Testament counts present books against 27', () => {
    const result = coverage(bible([file('mat'), file('jhn'), file('rev', false)]), 'bible');
    expect(result).toMatchObject({ scope: 'nt', target: 27, present: 2, basis: 'catalog' });
    expect(result.units.filter(unit => unit.present).map(unit => unit.id)).toEqual(['mat', 'jhn']);
    expect(result.units).toHaveLength(27);
  });

  test('H5: one book from each testament makes the scope full and the target 66', () => {
    expect(coverage(bible([file('rut'), file('jon'), file('mat')]), 'bible')).toMatchObject({ scope: 'full', target: 66, present: 3 });
    expect(coverage(bible([file('rut'), file('jon')]), 'bible')).toMatchObject({ scope: 'ot', target: 39, present: 2 });
  });

  test('H5: an Open Bible Stories project counts stories against 50', () => {
    const result = coverage({ flavor: 'textStories', metadata_format: 'sb', ingredients: [file('01'), file('50'), file('51'), file('02', false)] }, 'obs');
    expect(result).toMatchObject({ scope: 'obs', target: 50, present: 2, basis: 'catalog' });
    expect(result.units).toHaveLength(50);
    expect(result.units.filter(unit => unit.present).map(unit => unit.id)).toEqual(['01', '50']);
  });

  test('H5: coverage counts only recognized, existing, distinct books', () => {
    const result = coverage(bible([file('rut'), file('RUT'), file('jon', false), file('notes'), file('license')]), 'bible');
    expect(result.present).toBe(1);
    expect(result.scope).toBe('ot');
  });

  test('H5: the scope follows a supplied currentScope together with the listed books', () => {
    expect(coverage(bible([], { current_scope: ['MAT', 'MRK'] }), 'bible')).toMatchObject({ scope: 'nt', target: 27, present: 0 });
    expect(coverage(bible([file('gen')], { current_scope: ['MAT'] }), 'bible')).toMatchObject({ scope: 'full', target: 66, present: 1 });
    expect(coverage(bible([file('gen')], { current_scope: ['not-a-book'] }), 'bible')).toMatchObject({ scope: 'ot', target: 39, present: 1 });
  });

  test('H5: every coverage value carries basis catalog and a target for its scope', () => {
    const cases = [
      coverage(bible(NEW_TESTAMENT.map(id => file(id))), 'bible'),
      coverage(bible(null), 'bible'),
      coverage(bible([]), 'bible'),
      coverage({ flavor: 'textStories', metadata_format: 'rc', ingredients: [dir('obs', './content')] }, 'obs'),
      coverage({ flavor: 'x-peripheralArticles', metadata_format: 'rc', ingredients: [dir('bible', './bible')] }, 'other'),
    ];
    for (const result of cases) {
      expect(result.basis).toBe('catalog');
      expect(result).toHaveProperty('target');
      expect(result.target).toBe(result.scope === 'unknown' ? null : { nt: 27, ot: 39, full: 66, obs: 50 }[result.scope]);
    }
  });

  test('testamentScope is unknown with no recognized book', () => {
    expect(testamentScope([])).toBe('unknown');
    expect(testamentScope(['notes'])).toBe('unknown');
    expect(testamentScope(['gen', 'rev'])).toBe('full');
  });
});

describe('unknown coverage', () => {
  test('H3: coverage present is null, never 0, when Door43 lists no ingredients', () => {
    const result = coverage(bible(null), 'bible');
    expect(result.present).toBeNull();
    expect(result).toMatchObject({ scope: 'unknown', target: null, units: [] });
    expect(coverage(bible(null, { current_scope: NEW_TESTAMENT }), 'bible')).toMatchObject({ present: null, scope: 'nt', target: 27, units: [] });
  });

  test('H3: an OBS container entry does not mean zero stories', () => {
    const result = coverage({ flavor: 'textStories', metadata_format: 'rc', ingredients: [dir('obs', './content')] }, 'obs');
    expect(result).toMatchObject({ present: null, scope: 'obs', target: 50, units: [] });
  });

  test('H3: a directory the catalog does not itemize leaves a Bible project unknown, not zero', () => {
    expect(coverage(bible([dir('bible', './ingredients')]), 'bible').present).toBeNull();
    expect(coverage(bible([file('license')]), 'bible').present).toBe(0);
  });

  test('H3: unknown coverage is never complete', () => {
    const unknowns = [
      coverage(bible(null, { current_scope: NEW_TESTAMENT }), 'bible'),
      coverage({ flavor: 'textStories', metadata_format: 'rc', ingredients: [dir('obs', './content')] }, 'obs'),
      coverage({ flavor: 'x-peripheralArticles', metadata_format: 'rc', ingredients: null }, 'other'),
    ];
    for (const result of unknowns) {
      expect(result.present).toBeNull();
      if (result.target !== null) expect(result.present).not.toBe(result.target);
      expect(result.units).toEqual([]);
    }
    expect(unknowns.map(result => result.target)).toEqual([27, 50, null]);
  });

  test('H3: a project of type other has no coverage claim', () => {
    expect(coverage({ flavor: 'x-peripheralArticles', metadata_format: 'sb', ingredients: STORIES.map(id => file(id)) }, 'other')).toEqual({
      present: null, target: null, scope: 'unknown', basis: 'catalog', units: [],
    });
  });
});

describe('classifyProject', () => {
  test('returns the classification fields of the project report together', () => {
    const result = classifyProject({ flavor: 'textTranslation', metadata_format: 'rc', ingredients: [file('tit'), file('phm')] });
    expect(result).toEqual({
      project_type: 'bible',
      metadata_format: 'rc',
      editability: { state: 'unsupported', reason: 'Resource Container project. Import it into a new project to manage it here.' },
      coverage: expect.objectContaining({ scope: 'nt', target: 27, present: 2, basis: 'catalog' }),
    });
  });

  test('other is listed with the reason stated and is neither releasable nor editable', () => {
    const result = classifyProject({ flavor: 'x-peripheralArticles', metadata_format: 'rc', ingredients: [dir('ta', './translate')] });
    expect(result.project_type).toBe('other');
    expect(result.editability).toEqual({ state: 'unsupported', reason: 'tC Admin manages Bible and Open Bible Stories projects only. Release and editing are not available.' });
    expect(result.coverage).toMatchObject({ present: null, target: null, scope: 'unknown' });
  });
});

describe('the books or stories a ref offers (source.search, #78)', () => {
  test('H3: a container with no itemized unit, or no ingredients at all, offers null, never an empty list', () => {
    expect(offeredUnits(bible(null), 'bible')).toBeNull();
    expect(offeredUnits({ flavor: 'textStories', metadata_format: 'rc', ingredients: [dir('obs', './content')] }, 'obs')).toBeNull();
    expect(offeredUnits(bible([file('frt')]), 'bible')).toEqual([]);
    expect(offeredUnits(bible([file('gen')]), 'other')).toBeNull();
  });

  test('each unit whose file exists, once, in canonical order, titled by Door43 or by its id', () => {
    const ingredients = [{ ...file('rev'), title: 'Revelation' }, file('GEN'), { ...file('mat'), title: 'Matthew' }, file('exo', false), { ...file('mat'), title: 'Again' }];
    expect(offeredUnits(bible(ingredients), 'bible')).toEqual([
      { id: 'gen', title: 'gen' },
      { id: 'mat', title: 'Matthew' },
      { id: 'rev', title: 'Revelation' },
    ]);
    const stories = [{ id: '02', path: './content/02.md', exists: true, is_dir: false, title: 'Sin' }, { id: '01', path: './content/01.md', exists: true, is_dir: false }];
    expect(offeredUnits({ flavor: 'textStories', metadata_format: 'sb', ingredients: stories }, 'obs')).toEqual([
      { id: '01', title: '01' },
      { id: '02', title: 'Sin' },
    ]);
  });
});
