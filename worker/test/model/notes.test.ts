// The release notes draft (#38): added, revised, removed, carried forward,
// unknown files included, the version, and the source commit.
import { describe, expect, test } from 'vitest';
import { releaseNotesDraft } from '../../src/model/notes';

const base = {
  owner: 'bahtraku',
  repo: 'Perjanjian-Baru-Pendau',
  version: 'v1.3.0',
  baseline_tag: 'v1.2',
  source: { branch: 'master', sha: '2d9dbd1ee09b5a1c28edd8668462f6a64029619b' },
  units: 'books' as const,
  added: [{ id: 'jon', title: 'Yunus' }],
  revised: [{ id: 'rut', title: '' }],
  removed: [],
  carried_forward: [{ id: 'mat', title: 'Matius' }, { id: 'mrk', title: 'Markus' }],
  unknown_included: ['notes/todo.txt'],
};

describe('the draft', () => {
  test('names what the release adds, revises, removes, and carries forward, with the version and the source commit', () => {
    const draft = releaseNotesDraft(base);
    expect(draft).toContain('## Perjanjian-Baru-Pendau v1.3.0');
    expect(draft).toContain('Source: bahtraku/Perjanjian-Baru-Pendau at 2d9dbd1ee0 on master.');
    expect(draft).toContain('Previous release: v1.2.');
    expect(draft).toContain('### Added\n- Yunus (JON)');
    expect(draft).toContain('### Revised\n- RUT');
    expect(draft).toContain('### Removed\n- None');
    expect(draft).toContain('### Carried forward\n2 books unchanged from v1.2: MAT, MRK');
    expect(draft).toContain('### Unknown files included\n- notes/todo.txt');
  });

  test('R2: every removed book is named; a first release says so and carries nothing', () => {
    expect(releaseNotesDraft({ ...base, removed: [{ id: 'rut', title: 'Rut' }, { id: 'jon', title: '' }] })).toContain('### Removed\n- Rut (RUT)\n- JON');
    const first = releaseNotesDraft({ ...base, baseline_tag: null, version: 'v1.0.0', revised: [], carried_forward: [], unknown_included: [] });
    expect(first).toContain('First release.');
    expect(first).toContain('### Carried forward\nNone');
    expect(first).toContain('### Unknown files included\n- None');
    expect(releaseNotesDraft({ ...base, units: 'stories' })).toContain('2 stories unchanged');
  });
});
