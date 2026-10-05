// Contract tests: the classification of the seed repositories from recorded
// Door43 responses (ADR 0012). Fixtures carry their host and date.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ProjectType } from '@tc-admin/shared/schema';
import { metadataFormat, projectCatalog } from '../../src/door43/catalog';
import type { Door43Repository, Door43RepositorySearch } from '../../src/door43/catalog';
import { PROJECT_TYPE_BY_FLAVOR, SUPPORTED_FLAVORS, classifyProject, projectTypeFromFlavor } from '../../src/model/project';

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
      metadata_format: 'sb',
      editability: { state: 'editable' },
      coverage: { scope: 'nt', target: 27, present: 27, basis: 'catalog' },
    });
    expect(result.coverage.units.filter(unit => !unit.present)).toEqual([]);
  });

  test('H5: bahtraku/id_tb1 is a Resource Container Bible covering 66 of 66 books from the catalog, unsupported with an import offer', () => {
    const result = classifyProject(projectCatalog(searchItem('bahtraku__id_tb1')));
    expect(result).toMatchObject({
      project_type: 'bible',
      metadata_format: 'rc',
      editability: { state: 'unsupported', reason: 'Resource Container project. Import it into a new project to manage it here.' },
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
  /** The probe's row key is `<flavor_type>/<flavor> | <subject>`, each empty when Door43 names none. */
  const row = (key: string) => {
    const [kind = '', subject = ''] = key.split(' | ');
    return { flavor: kind.split('/')[1] || null, subject };
  };
  const SUPPORTED_SUBJECTS: Record<string, ProjectType> = { 'Bible': 'bible', 'Aligned Bible': 'bible', 'Open Bible Stories': 'obs' };
  const probe = read<{ queries: { request: string; total: number; seen: number; counts_by_flavor_type_flavor_subject: Record<string, number> }[] }>(
    '2026-10-05/search/flavor-and-subject-by-metadata-type.json',
  );

  test('E42: on every Scripture Burrito repository QA holds, the flavor classifies exactly as its Bible, Aligned Bible, or Open Bible Stories subject would (Q11, Q23)', () => {
    const burritos = probe.queries.find(query => query.request.includes('metadataType=sb&page'))!;
    expect(burritos.seen).toBe(burritos.total);
    expect(burritos.total).toBeGreaterThan(1000);
    for (const key of Object.keys(burritos.counts_by_flavor_type_flavor_subject)) {
      const { flavor, subject } = row(key);
      expect(projectTypeFromFlavor(flavor), key).toBe(SUPPORTED_SUBJECTS[subject] ?? 'other');
    }
  });

  test('P1: the search filter names exactly the flavors the model classifies as bible or obs, and in every format a Bible, Aligned Bible, or Open Bible Stories subject with a flavor is one of them', () => {
    expect([...SUPPORTED_FLAVORS].sort()).toEqual(
      Object.keys(PROJECT_TYPE_BY_FLAVOR)
        .filter(flavor => projectTypeFromFlavor(flavor) !== 'other')
        .sort(),
    );
    for (const query of probe.queries) {
      for (const key of Object.keys(query.counts_by_flavor_type_flavor_subject)) {
        const { flavor, subject } = row(key);
        if (subject in SUPPORTED_SUBJECTS && flavor) expect(SUPPORTED_FLAVORS, `${query.request}: ${key}`).toContain(flavor);
      }
    }
  });

  test('E14: every metadata type Door43 lists maps to a metadata_format, and anything else is none', () => {
    const types = read<{ ok: boolean; data: string[] }>('2026-09-21/catalog/list__metadata-types.json');
    expect(types.data.map(metadataFormat)).toEqual(['rc', 'sb', 'tc', 'ts']);
    expect(metadataFormat(undefined)).toBe('none');
    expect(metadataFormat('')).toBe('none');
    expect(metadataFormat('usfm')).toBe('none');
  });
});
