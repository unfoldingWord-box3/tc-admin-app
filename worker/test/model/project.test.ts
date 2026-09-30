import { describe, expect, test } from 'vitest';
import { PROJECT_TYPES } from '../../../shared/schema/project';
import type { CoverageScope, ProjectType } from '../../../shared/schema/project';
import { BIBLE_BOOKS, NEW_TESTAMENT, OLD_TESTAMENT, STORIES } from '../../src/model/books';
import {
  MANAGED_PROJECT_TYPES,
  classifyProject,
  contentStructure,
  coverage,
  editability,
  projectTypeFromSubject,
  testamentScope,
} from '../../src/model/project';
import type { CatalogIngredient, ProjectCatalog } from '../../src/model/project';

const file = (id: string, exists = true): CatalogIngredient => ({ id, path: `./${id}.usfm`, exists, is_dir: false });
const dir = (id: string, path: string): CatalogIngredient => ({ id, path, exists: true, is_dir: true });
const bible = (ingredients: CatalogIngredient[] | null, extra: Partial<ProjectCatalog> = {}): ProjectCatalog => ({
  subject: 'Bible',
  metadata_format: 'sb',
  ingredients,
  ...extra,
});

describe('project type', () => {
  test('project_type covers all six values from the catalog subject', () => {
    const seen = new Map<string, ProjectType>([
      ['Bible', projectTypeFromSubject('Bible')],
      ['Aligned Bible', projectTypeFromSubject('Aligned Bible')],
      ['Greek New Testament', projectTypeFromSubject('Greek New Testament')],
      ['Hebrew Old Testament', projectTypeFromSubject('Hebrew Old Testament')],
      ['TSV Translation Notes', projectTypeFromSubject('TSV Translation Notes')],
      ['Translation Notes', projectTypeFromSubject('Translation Notes')],
      ['TSV Translation Questions', projectTypeFromSubject('TSV Translation Questions')],
      ['TSV Translation Words Links', projectTypeFromSubject('TSV Translation Words Links')],
      ['Open Bible Stories', projectTypeFromSubject('Open Bible Stories')],
      ['Translation Words', projectTypeFromSubject('Translation Words')],
    ]);
    expect(Object.fromEntries(seen)).toEqual({
      'Bible': 'bible',
      'Aligned Bible': 'bible',
      'Greek New Testament': 'bible',
      'Hebrew Old Testament': 'bible',
      'TSV Translation Notes': 'tn',
      'Translation Notes': 'tn',
      'TSV Translation Questions': 'tq',
      'TSV Translation Words Links': 'twl',
      'Open Bible Stories': 'obs',
      'Translation Words': 'other',
    });
    expect(new Set(seen.values())).toEqual(new Set(PROJECT_TYPES));
  });

  test('a missing, empty, or unlisted subject is other', () => {
    expect(projectTypeFromSubject(null)).toBe('other');
    expect(projectTypeFromSubject(undefined)).toBe('other');
    expect(projectTypeFromSubject('')).toBe('other');
    expect(projectTypeFromSubject('Translation Academy')).toBe('other');
    expect(projectTypeFromSubject('bible')).toBe('other');
  });

  test('content_structure derives from project_type', () => {
    expect(PROJECT_TYPES.map(contentStructure)).toEqual([
      'book_package', 'book_package', 'book_package', 'book_package', 'story_package', 'whole',
    ]);
  });
});

describe('editability', () => {
  test('other is unsupported with the reason stated, whatever its format', () => {
    for (const format of ['sb', 'rc', 'ts', 'tc'] as const) {
      const result = editability(format, 'other', 'Translation Words');
      expect(result.state).toBe('unsupported');
      expect(result.reason).toBe('tC Admin does not manage Translation Words projects in this version. Release and editing are not available.');
    }
    expect(editability('sb', 'other', null).reason).toBe('tC Admin does not manage projects of this type in this version. Release and editing are not available.');
  });

  test('the book package types version one does not manage are unsupported with the reason stated (Q23)', () => {
    expect(MANAGED_PROJECT_TYPES).toEqual(new Set(['bible', 'obs']));
    expect(editability('sb', 'tn', 'TSV Translation Notes')).toEqual({
      state: 'unsupported',
      reason: 'tC Admin does not manage TSV Translation Notes projects in this version. Release and editing are not available.',
    });
    expect(editability('rc', 'tq', 'Translation Questions').state).toBe('unsupported');
    expect(editability('rc', 'twl', 'TSV Translation Words Links').state).toBe('unsupported');
    expect(editability('sb', 'obs', 'Open Bible Stories').state).toBe('editable');
    expect(editability('rc', 'obs', 'Open Bible Stories').state).toBe('release_only');
  });

  test('P1: every editability state carries a one-line reason', () => {
    expect(editability('sb', 'bible', 'Bible')).toEqual({ state: 'editable', reason: 'Scripture Burrito project. Release and editing are available.' });
    expect(editability('rc', 'bible', 'Bible')).toEqual({ state: 'release_only', reason: 'Resource Container project. Release is available; editing needs conversion.' });
    expect(editability('ts', 'bible', 'Bible').state).toBe('release_only');
    expect(editability('tc', 'bible', 'Bible').state).toBe('release_only');
    expect(editability('none', 'other', null)).toEqual({ state: 'unsupported', reason: 'Door43 found no project metadata it recognizes. Release and editing are not available.' });
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
    const result = coverage({ subject: 'Open Bible Stories', metadata_format: 'sb', ingredients: [file('01'), file('50'), file('51'), file('02', false)] }, 'obs');
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
      coverage({ subject: 'Open Bible Stories', metadata_format: 'rc', ingredients: [dir('obs', './content')] }, 'obs'),
      coverage({ subject: 'Translation Words', metadata_format: 'rc', ingredients: [dir('bible', './bible')] }, 'other'),
    ];
    for (const result of cases) {
      expect(result.basis).toBe('catalog');
      expect(result).toHaveProperty('target');
      expect(result.target).toBe(result.scope === 'unknown' ? null : { nt: 27, ot: 39, full: 66, obs: 50 }[result.scope]);
    }
  });

  test('H5: the book package types share the Bible coverage rule', () => {
    for (const type of ['tn', 'tq', 'twl'] as const) {
      const result = coverage({ subject: 'TSV Translation Notes', metadata_format: 'rc', ingredients: [{ id: 'tit', path: './tn_TIT.tsv', exists: true, is_dir: false }] }, type);
      expect(result).toMatchObject({ scope: 'nt', target: 27, present: 1, basis: 'catalog' });
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
    const result = coverage({ subject: 'Open Bible Stories', metadata_format: 'rc', ingredients: [dir('obs', './content')] }, 'obs');
    expect(result).toMatchObject({ present: null, scope: 'obs', target: 50, units: [] });
  });

  test('H3: a directory the catalog does not itemize leaves a Bible project unknown, not zero', () => {
    expect(coverage(bible([dir('bible', './ingredients')]), 'bible').present).toBeNull();
    expect(coverage(bible([file('license')]), 'bible').present).toBe(0);
  });

  test('H3: unknown coverage is never complete', () => {
    const unknowns = [
      coverage(bible(null, { current_scope: NEW_TESTAMENT }), 'bible'),
      coverage({ subject: 'Open Bible Stories', metadata_format: 'rc', ingredients: [dir('obs', './content')] }, 'obs'),
      coverage({ subject: 'Translation Academy', metadata_format: 'rc', ingredients: null }, 'other'),
    ];
    for (const result of unknowns) {
      expect(result.present).toBeNull();
      if (result.target !== null) expect(result.present).not.toBe(result.target);
      expect(result.units).toEqual([]);
    }
    expect(unknowns.map(result => result.target)).toEqual([27, 50, null]);
  });

  test('H3: a project of type other has no coverage claim', () => {
    expect(coverage({ subject: 'Translation Words', metadata_format: 'sb', ingredients: STORIES.map(id => file(id)) }, 'other')).toEqual({
      present: null, target: null, scope: 'unknown', basis: 'catalog', units: [],
    });
  });
});

describe('classifyProject', () => {
  test('returns the classification fields of the project report together', () => {
    const result = classifyProject({ subject: 'Aligned Bible', metadata_format: 'rc', ingredients: [file('tit'), file('phm')] });
    expect(result).toEqual({
      project_type: 'bible',
      content_structure: 'book_package',
      metadata_format: 'rc',
      editability: { state: 'release_only', reason: 'Resource Container project. Release is available; editing needs conversion.' },
      coverage: expect.objectContaining({ scope: 'nt', target: 27, present: 2, basis: 'catalog' }),
    });
  });

  test('other is listed with the reason stated and is neither releasable nor editable', () => {
    const result = classifyProject({ subject: 'Translation Academy', metadata_format: 'rc', ingredients: [dir('ta', './translate')] });
    expect(result.project_type).toBe('other');
    expect(result.content_structure).toBe('whole');
    expect(result.editability).toEqual({ state: 'unsupported', reason: 'tC Admin does not manage Translation Academy projects in this version. Release and editing are not available.' });
    expect(result.coverage).toMatchObject({ present: null, target: null, scope: 'unknown' });
  });
});
