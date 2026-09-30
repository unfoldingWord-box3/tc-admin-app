// Contract tests: the classification of the seed repositories from recorded
// Door43 responses (ADR 0012). Fixtures carry their host and date.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ProjectType } from '../../../shared/schema/project';
import { metadataFormat, projectCatalog } from '../../src/door43/catalog';
import type { Door43Repository, Door43RepositorySearch } from '../../src/door43/catalog';
import { classifyProject } from '../../src/model/project';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, fixtures), 'utf8')) as T;

const searchItem = (name: string): Door43Repository => {
  const search = read<Door43RepositorySearch>(`2026-09-30/search/${name}.json`);
  expect(search.ok).toBe(true);
  expect(search.data).toHaveLength(1);
  return search.data[0]!;
};
const repository = (name: string): Door43Repository => read<Door43Repository>(`2026-09-21/repos/${name}.json`);

describe('the seed repositories from the repository search (E32)', () => {
  test('H5: bahtraku/Perjanjian-Baru-Pendau is a Scripture Burrito Bible covering 27 of 27 New Testament books from the catalog', () => {
    const result = classifyProject(projectCatalog(searchItem('bahtraku__Perjanjian-Baru-Pendau')));
    expect(result).toMatchObject({
      project_type: 'bible',
      content_structure: 'book_package',
      metadata_format: 'sb',
      editability: { state: 'editable' },
      coverage: { scope: 'nt', target: 27, present: 27, basis: 'catalog' },
    });
    expect(result.coverage.units.filter(unit => !unit.present)).toEqual([]);
  });

  test('H5: bahtraku/id_tb1 is a Resource Container Bible covering 66 of 66 books from the catalog', () => {
    const result = classifyProject(projectCatalog(searchItem('bahtraku__id_tb1')));
    expect(result).toMatchObject({
      project_type: 'bible',
      content_structure: 'book_package',
      metadata_format: 'rc',
      editability: { state: 'release_only', reason: 'Resource Container project. Release is available; editing needs conversion.' },
      coverage: { scope: 'full', target: 66, present: 66, basis: 'catalog' },
    });
  });

  test.each(['bahtraku__Perjanjian-Baru-Pendau', 'bahtraku__id_tb1'])(
    'E12: the search item and the repository endpoint classify %s identically',
    name => {
      expect(classifyProject(projectCatalog(searchItem(name)))).toEqual(classifyProject(projectCatalog(repository(name))));
    },
  );

  test('H3: a search item without ingredients has unknown coverage, not zero', () => {
    const { ingredients: _ingredients, ...bare } = searchItem('bahtraku__Perjanjian-Baru-Pendau');
    const result = classifyProject(projectCatalog(bare));
    expect(result.coverage).toMatchObject({ present: null, target: null, scope: 'unknown', basis: 'catalog', units: [] });
    expect(result.project_type).toBe('bible');
  });
});

describe('Door43 vocabularies', () => {
  test('E33: every subject Door43 lists maps to a project_type', () => {
    const subjects = read<{ ok: boolean; data: string[] }>('2026-09-30/catalog/list__subjects.json');
    expect(subjects.ok).toBe(true);
    const mapping = Object.fromEntries(subjects.data.map(subject => [subject, classifyProject({ subject, metadata_format: 'rc', ingredients: [] }).project_type]));
    const expected: Record<string, ProjectType> = {
      'Aligned Bible': 'bible',
      'Aramaic Grammar': 'other',
      'Bible': 'bible',
      'Greek Grammar': 'other',
      'Greek New Testament': 'other',
      'Hebrew Grammar': 'other',
      'Hebrew Old Testament': 'other',
      'OBS Study Notes': 'other',
      'OBS Study Questions': 'other',
      'OBS Theological Formation': 'other',
      'OBS Translation Notes': 'other',
      'OBS Translation Questions': 'other',
      'Open Bible Stories': 'obs',
      'TSV OBS Study Notes': 'other',
      'TSV OBS Study Questions': 'other',
      'TSV OBS Translation Notes': 'other',
      'TSV OBS Translation Questions': 'other',
      'TSV OBS Translation Words Links': 'other',
      'TSV Translation Notes': 'tn',
      'TSV Translation Questions': 'tq',
      'TSV Translation Words Links': 'twl',
      'Translation Academy': 'other',
      'Translation Notes': 'tn',
      'Translation Questions': 'tq',
      'Translation Words': 'other',
    };
    expect(mapping).toEqual(expected);
  });

  test('E14: every metadata type Door43 lists maps to a metadata_format, and anything else is none', () => {
    const types = read<{ ok: boolean; data: string[] }>('2026-09-21/catalog/list__metadata-types.json');
    expect(types.data.map(metadataFormat)).toEqual(['rc', 'sb', 'tc', 'ts']);
    expect(metadataFormat(undefined)).toBe('none');
    expect(metadataFormat('')).toBe('none');
    expect(metadataFormat('usfm')).toBe('none');
  });
});
