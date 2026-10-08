// The git trees adapter (E19, E52): every page is read until one is not
// truncated, only files are kept, and an unexpected shape is a Door43 failure.
import { CatalogError } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import { door43Host } from '../../src/door43/host';
import { readBranchHead } from '../../src/door43/branches';
import { readTree } from '../../src/door43/trees';

import { recorded as recordedAt, recordedText } from '../support/recorded';

const recorded = <T>(name: string): T => recordedAt<T>(`2026-10-07/repos/${name}`);
const client = (fetch: Fetch) => ({ host: door43Host('https://qa.door43.org'), token: 'test-only', fetch });
const code = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error.code : error));

describe('readTree', () => {
  test('reads the recursive tree at the ref, a thousand entries a page, and keeps the files with their SHAs', async () => {
    const whole = recorded<{ sha: string; tree: { path: string }[] }>('bahtraku__Perjanjian-Baru-Pendau__git-trees__master.json.gz');
    const urls: string[] = [];
    const tree = await readTree(
      client(async (url, init) => {
        urls.push(url);
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-only');
        return Response.json(whole);
      }),
      'bahtraku',
      'Perjanjian-Baru-Pendau',
      '2d9dbd1ee09b5a1c28edd8668462f6a64029619b',
    );
    expect(urls).toEqual(['https://qa.door43.org/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/git/trees/2d9dbd1ee09b5a1c28edd8668462f6a64029619b?recursive=true&per_page=1000&page=1']);
    expect(tree.sha).toBe('2d9dbd1ee09b5a1c28edd8668462f6a64029619b');
    // 34 entries, of which one is the ingredients directory.
    expect(tree.files).toHaveLength(33);
    expect(tree.files.find(file => file.path === 'ingredients/MAT.usfm')).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{40}$/), size: expect.any(Number) });
    expect(tree.files.some(file => file.path === 'ingredients')).toBe(false);
  });

  test('E52: a page that is not the last says truncated, so the next page is read; the last does not', async () => {
    const page2 = recorded<{ sha: string; tree: unknown[]; truncated: boolean; total_count: number }>('bahtraku__Perjanjian-Baru-Pendau__git-trees__master__per_page=10__page=2.json.gz');
    expect(page2.truncated).toBe(true);
    expect(page2.total_count).toBe(34);
    const pages = [
      { sha: 's', tree: [{ path: 'a', type: 'blob', sha: '1', size: 1 }], truncated: true },
      { sha: 's', tree: [{ path: 'dir', type: 'tree', sha: '2' }, { path: 'dir/b', type: 'blob', sha: '3' }], truncated: true },
      { sha: 's', tree: [{ path: 'c', type: 'blob', sha: '4', size: 4 }], truncated: false },
      { sha: 's', tree: [{ path: 'never', type: 'blob', sha: '5' }], truncated: false },
    ];
    const asked: string[] = [];
    const tree = await readTree(
      client(async url => {
        asked.push(new URL(url).searchParams.get('page')!);
        return Response.json(pages[Number(new URL(url).searchParams.get('page')) - 1]);
      }),
      'o',
      'r',
      'main',
    );
    expect(asked).toEqual(['1', '2', '3']);
    expect(tree.files).toEqual([
      { path: 'a', sha: '1', size: 1 },
      { path: 'dir/b', sha: '3', size: null },
      { path: 'c', sha: '4', size: 4 },
    ]);
  });

  test('an answer that is not a tree, or one that never ends, is door43_unavailable; a missing ref is not_found', async () => {
    expect(await code(readTree(client(async () => Response.json({ unexpected: true })), 'o', 'r', 'main'))).toBe('door43_unavailable');
    expect(await code(readTree(client(async () => Response.json({ sha: 's', tree: [], truncated: true })), 'o', 'r', 'main'))).toBe('door43_unavailable');
    expect(await code(readTree(client(async () => new Response('', { status: 404 })), 'o', 'r', 'gone'))).toBe('not_found');
  });
});

describe('the tree\'s sha and the branch\'s commit (E63)', () => {
  const answer = (name: string): unknown => JSON.parse(recordedText(`2026-10-07/setup-retry/${name}`));
  const COMMIT = '5d4fe92978571095326c44a2da6d6c624ab4c35d';
  const TREE = '87f5d12742dfb0fc7e8c21d2a943643e87ca111e';

  test('X1, E63: a tree read by branch or by commit answers the tree object\'s SHA, never the commit\'s', async () => {
    const byBranch = await readTree(client(async () => Response.json(answer('05-GET-tree.json'))), 'tc-admin-qa', 'tcadmin-retry-probe-2352', 'master');
    const byCommit = await readTree(client(async () => Response.json(answer('07-GET-tree-by-commit.json'))), 'tc-admin-qa', 'tcadmin-retry-probe-2352', COMMIT);
    expect([byBranch.sha, byCommit.sha]).toEqual([TREE, TREE]);
    expect(byBranch.sha).not.toBe(COMMIT);
    expect(byCommit.files).toEqual([{ path: 'README.md', sha: 'da0c4eb8d9a48d171a33574b380752e183286751', size: 6 }]);
  });

  test('X1, E63: the branch read names the head commit, with its url and time', async () => {
    const urls: string[] = [];
    const head = await readBranchHead(
      client(async url => (urls.push(url), Response.json(answer('08-GET-branch.json')))),
      'tc-admin-qa',
      'tcadmin-retry-probe-2352',
      'master',
    );
    expect(urls).toEqual(['https://qa.door43.org/api/v1/repos/tc-admin-qa/tcadmin-retry-probe-2352/branches/master']);
    expect(head).toEqual({ sha: COMMIT, url: `https://qa.door43.org/tc-admin-qa/tcadmin-retry-probe-2352/commit/${COMMIT}`, committed_at: '2026-10-07T23:52:58Z' });
  });

  test('a branch answer without a commit id is door43_unavailable, and a missing branch is not_found', async () => {
    expect(await code(readBranchHead(client(async () => Response.json({ name: 'master', commit: null })), 'o', 'r', 'master'))).toBe('door43_unavailable');
    expect(await code(readBranchHead(client(async () => Response.json({ message: 'not found' }, { status: 404 })), 'o', 'r', 'master'))).toBe('not_found');
  });
});
