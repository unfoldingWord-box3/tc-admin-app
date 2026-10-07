// The snapshot planner (#34): what a release uploads and deletes, by blob
// SHA against the ref the branch starts from (R1, R2), including the root
// and `.gitea/` files the default branch dropped (decided 7 October 2026).
import { describe, expect, test } from 'vitest';
import type { Candidate } from '../../src/model/candidates';
import type { Classification } from '../../src/model/classify';
import { planSnapshot } from '../../src/model/snapshot';

const candidate = (id: string, path: string, group: Candidate['group'], selection: Candidate['selection'], released = true): Candidate =>
  ({ id, group, selection, title: id.toUpperCase(), default_branch: { path, sha: `b-${id}`, size: 10, title: id }, baseline: released ? { path, sha: `t-${id}`, size: 10, title: id } : null }) as unknown as Candidate;
const classification = (files: { path: string; unit: string | null; role: 'unit' | 'administrative' | 'unknown' }[]): Classification =>
  ({
    files,
    units: files.filter(f => f.role === 'unit').map(f => f.path),
    administrative: files.filter(f => f.role === 'administrative').map(f => f.path),
    unknown: files.filter(f => f.role === 'unknown').map(f => f.path),
    missing: [],
  }) as unknown as Classification;

describe('planSnapshot: files outside ingredients/ (R1, R2)', () => {
  test('a root or .gitea/ file the default branch dropped is deleted by its start-ref SHA; one on both refs stays even when the archive did not carry it; a file in another directory is left alone', () => {
    const candidates = [candidate('mat', 'ingredients/MAT.usfm', 'unchanged', 'carry_forward')];
    const plan = planSnapshot({
      project_type: 'bible',
      from_release: true,
      candidates,
      selection: { mat: 'carry_forward' },
      branch: classification([
        { path: 'ingredients/MAT.usfm', unit: 'mat', role: 'unit' },
        { path: 'README.md', unit: null, role: 'administrative' },
      ]),
      branch_blobs: new Map([
        ['ingredients/MAT.usfm', 'b-mat'],
        ['README.md', 'r1'],
        ['.gitea/workflows/keep.yml', 'k1'],
        ['metadata.json', 'm1'],
      ]),
      start_blobs: new Map([
        ['ingredients/MAT.usfm', 't-mat'],
        ['README.md', 'r1'],
        ['.gitea/workflows/keep.yml', 'k0'],
        ['.gitea/workflows/old.yml', 'o1'],
        ['CHANGELOG.md', 'c1'],
        ['docs/notes.md', 'd1'],
        ['metadata.json', 'm0'],
      ]),
      sizes: new Map([['README.md', 100]]),
      unknown_included: [],
      metadata_size: 50,
    });
    const deletions = plan.writes.filter(write => write.operation === 'delete').map(write => [write.path, write.sha]);
    expect(deletions).toEqual([
      ['.gitea/workflows/old.yml', 'o1'],
      ['CHANGELOG.md', 'c1'],
    ]);
    // README.md is on both refs with the same blob: not uploaded (R1); MAT is carried: not uploaded.
    expect(plan.writes.filter(write => write.operation === 'upload').map(write => write.path)).toEqual(['metadata.json']);
    expect(plan.files.map(file => file.path)).toEqual(['ingredients/MAT.usfm', 'README.md', 'metadata.json']);
  });
});
