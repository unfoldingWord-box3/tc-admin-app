// The refs a project's read starts from (E14): the default-branch head, the
// latest full release, and the outstanding pre-release (#162), the catalog's
// `preprod` stage only when it is newer than the latest full release, which
// Door43 fills at once for a new pre-release (E75).
import { describe, expect, test } from 'vitest';
import { repositoryRefs } from '../../src/door43/catalog';
import type { Door43Repository } from '../../src/door43/catalog';

const stageOf = (name: string, sha: string, released: string | null) => ({ branch_or_tag_name: name, commit_sha: sha, released });
const repoWith = (catalog: Door43Repository['catalog']) => ({ owner: { login: 'o' }, name: 'r', catalog }) as unknown as Door43Repository;
const LATEST = stageOf('master', 'a'.repeat(40), '2026-10-09T18:00:00Z');

describe('#162: the outstanding pre-release', () => {
  test('#162, E75: a pre-release with no full release before it is outstanding', () => {
    const refs = repositoryRefs(repoWith({ latest: LATEST, prod: null, preprod: stageOf('v1.0.0', 'b'.repeat(40), '2026-10-09T18:02:20Z') }));
    expect(refs.latest_prerelease).toEqual({ tag: 'v1.0.0', sha: 'b'.repeat(40), released_at: '2026-10-09T18:02:20Z' });
    expect(refs.latest_full_release).toBeNull();
  });

  test('#162: a pre-release newer than the latest full release is outstanding; an older one, or the same tag, is not', () => {
    const prod = stageOf('v1.1.0', 'c'.repeat(40), '2026-10-09T17:00:00Z');
    expect(repositoryRefs(repoWith({ latest: LATEST, prod, preprod: stageOf('v1.1.1', 'd'.repeat(40), '2026-10-09T17:30:00Z') })).latest_prerelease?.tag).toBe('v1.1.1');
    expect(repositoryRefs(repoWith({ latest: LATEST, prod, preprod: stageOf('v1.0.9', 'd'.repeat(40), '2026-10-09T16:00:00Z') })).latest_prerelease).toBeNull();
    expect(repositoryRefs(repoWith({ latest: LATEST, prod, preprod: stageOf('v1.1.0', 'c'.repeat(40), '2026-10-09T17:00:00Z') })).latest_prerelease).toBeNull();
  });

  test('#162: without both times a pre-release cannot be told newer, so it is not shown; none at all is null', () => {
    const prod = stageOf('v1.1.0', 'c'.repeat(40), null);
    expect(repositoryRefs(repoWith({ latest: LATEST, prod, preprod: stageOf('v1.1.1', 'd'.repeat(40), '2026-10-09T17:30:00Z') })).latest_prerelease).toBeNull();
    expect(repositoryRefs(repoWith({ latest: LATEST, prod: null, preprod: null })).latest_prerelease).toBeNull();
    expect(repositoryRefs(repoWith(null)).latest_prerelease).toBeNull();
  });
});
