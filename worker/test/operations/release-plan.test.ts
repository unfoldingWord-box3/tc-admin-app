// `release.plan` (#33) against the recorded QA repositories (E52): the
// candidates, the R4 defaults, the version and notes, the binding (R5), the
// announced writes, and what the plan refuses.
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import type { StoredPlan } from '../../src/operations/plans';
import { releasePlan } from '../../src/operations/release-plan';
import type { ReleasePlanPayload } from '../../src/operations/release-plan';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const recorded = <T>(path: string): T => (JSON.parse(readFileSync(new URL(path, fixtures), 'utf8')) as { response: { json: T } }).response.json;
const user = recorded<unknown>('2026-10-05/user/user.json');
type Repo = { catalog: { prod: { branch_or_tag_name: string; commit_sha: string } | null; latest: { branch_or_tag_name: string; commit_sha: string } | null }; permissions: object; ingredients: { identifier: string; path: string }[] | null };
type Tree = { sha: string; tree: { path: string; type: string; sha: string }[]; truncated: boolean };
const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
const SHA = '2d9dbd1ee09b5a1c28edd8668462f6a64029619b';

class MemoryKV implements KVNamespace {
  readonly entries = new Map<string, string>();
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.entries.set(key, value);
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
}

/** A Door43 of recorded answers: the repository (writable unless said otherwise), its entries by ref, and its trees by SHA. */
function door43(options: { repo: Repo; entries: Record<string, unknown>; trees: Record<string, Tree>; writable?: boolean }): { fetch: Fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetch = async url => {
    const { pathname } = new URL(url);
    calls.push(pathname + new URL(url).search);
    if (pathname === '/api/v1/user') return Response.json(user);
    const repo = /^\/api\/v1\/repos\/[^/]+\/[^/]+$/.test(pathname);
    if (repo) return Response.json({ ...options.repo, permissions: options.writable === false ? { pull: true } : { push: true, admin: false, pull: true } });
    const entry = /^\/api\/v1\/catalog\/entry\/[^/]+\/[^/]+\/([^/]+)$/.exec(pathname);
    if (entry) return options.entries[decodeURIComponent(entry[1]!)] ? Response.json(options.entries[decodeURIComponent(entry[1]!)]) : new Response('', { status: 404 });
    const tree = /^\/api\/v1\/repos\/[^/]+\/[^/]+\/git\/trees\/([^/]+)$/.exec(pathname);
    if (tree) return options.trees[tree[1]!] ? Response.json(options.trees[tree[1]!]) : new Response('', { status: 404 });
    return new Response('', { status: 404 });
  };
  return { fetch, calls };
}

const NOW = new Date('2026-10-07T12:00:00.000Z');
let kv: MemoryKV;
const context = (fetch: Fetch, token: string | null = 'door43-token'): OperationContext => {
  kv = new MemoryKV();
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', token, kv);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch } : null, now: () => NOW };
};
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const stored = (planId: string) => JSON.parse(kv.entries.get(`plan:${planId}`)!) as StoredPlan<ReleasePlanPayload>;

/** Pendau as recorded on 7 October 2026: master and v1.2 are the same commit (E52). */
const pendau = () => ({
  repo: recorded<Repo>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json'),
  entries: {
    master: recorded<unknown>('2026-10-07/catalog/entry__bahtraku__Perjanjian-Baru-Pendau__master.json'),
    'v1.2': recorded<unknown>('2026-10-07/catalog/entry__bahtraku__Perjanjian-Baru-Pendau__v1.2.json'),
  },
  trees: { [SHA]: recorded<Tree>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau__git-trees__master.json') },
});

describe('a later release of a Bible (Pendau, baseline v1.2)', () => {
  test('R4: every released book is carried forward, nothing is included or removed, the version is a patch, and the plan is bound to both commits (R5)', async () => {
    const { fetch, calls } = door43(pendau());
    const plan = OPERATIONS['release.plan'].output.parse(await releasePlan(PENDAU, context(fetch)));
    expect(plan.operation).toBe('release.plan');
    expect(plan.expires_at).toBe('2026-10-07T12:30:00.000Z');
    expect(plan.bound_to).toEqual({ default_branch_sha: SHA, release_tag: 'v1.2', release_tag_sha: SHA });
    expect(plan.preview.books).toHaveLength(27);
    expect(plan.preview.books.every(book => book.group === 'unchanged' && book.selection === 'carry_forward')).toBe(true);
    expect(plan.preview.books.slice(0, 3).map(book => book.id)).toEqual(['mat', 'mrk', 'luk']);
    expect(plan.preview.removals).toEqual([]);
    expect(plan.preview.administrative).toEqual(['LICENSE.md', 'README.md']);
    expect(plan.preview.version).toEqual({ baseline_tag: 'v1.2', proposed: 'v1.2.1', rule_applied: 'revisions' });
    expect(plan.preview.notes_draft).toContain('## Perjanjian-Baru-Pendau v1.2.1');
    expect(plan.preview.notes_draft).toContain('27 books unchanged from v1.2: MAT, MRK, LUK');
    expect(plan.preview.notes_draft).toContain('### Added\n- None');
    expect(plan.would_write).toEqual([
      { kind: 'branch', target: 'bahtraku/Perjanjian-Baru-Pendau@temp-tca-release/v1.2.1' },
      { kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@temp-tca-release/v1.2.1' },
    ]);
    expect(plan.warnings).toEqual([]);
    // The account, the repository, then the entry and tree of each ref, the trees at the commits the repository named.
    expect(calls).toEqual([
      '/api/v1/user',
      '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau',
      '/api/v1/catalog/entry/bahtraku/Perjanjian-Baru-Pendau/master',
      `/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/git/trees/${SHA}?recursive=true&per_page=1000&page=1`,
      '/api/v1/catalog/entry/bahtraku/Perjanjian-Baru-Pendau/v1.2',
      `/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/git/trees/${SHA}?recursive=true&per_page=1000&page=1`,
    ]);
    const kept = stored(plan.id);
    expect(kept.account).toBe('tc-admin-qa');
    expect(kept.payload).toMatchObject({ owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau', project_type: 'bible', default_branch: { name: 'master', sha: SHA }, baseline: { tag: 'v1.2', sha: SHA }, version: plan.preview.version });
    expect(kept.payload.candidates).toHaveLength(27);
    // Door43 titles the books in English for this repository (the catalog entry's `title`, E52).
    expect(kept.payload.candidates[0]).toMatchObject({ id: 'mat', default_branch: { path: 'ingredients/MAT.usfm', title: 'Matthew' }, baseline: { path: 'ingredients/MAT.usfm' } });
  });

  test('R1, R4: a changed book and a new one on the default branch are grouped and left as R4 says, and nothing from the branch enters the plan unselected', async () => {
    const base = pendau();
    const branchSha = 'b000000000000000000000000000000000000000';
    const repo: Repo = { ...base.repo, catalog: { ...base.repo.catalog, latest: { branch_or_tag_name: 'master', commit_sha: branchSha } } };
    const tagTree = base.trees[SHA]!;
    const branchTree: Tree = {
      ...tagTree,
      sha: branchSha,
      tree: [...tagTree.tree.map(entry => (entry.path === 'ingredients/MAT.usfm' ? { ...entry, sha: 'c000000000000000000000000000000000000000' } : entry)), { path: 'ingredients/GEN.usfm', type: 'blob', sha: 'd000000000000000000000000000000000000000' }],
    };
    const branchEntry = base.entries.master as { ingredients: object[] };
    const entries = { ...base.entries, master: { ...branchEntry, ingredients: [...branchEntry.ingredients, { identifier: 'gen', path: './ingredients/GEN.usfm', title: 'Kejadian', exists: true, is_dir: false }] } };
    const { fetch } = door43({ repo, entries, trees: { [SHA]: tagTree, [branchSha]: branchTree } });
    const plan = await releasePlan(PENDAU, context(fetch));
    const by = Object.fromEntries(plan.preview.books.map(book => [book.id, book]));
    expect(by.gen).toEqual({ id: 'gen', group: 'new', selection: 'leave_out' });
    expect(by.mat).toEqual({ id: 'mat', group: 'changed_released', selection: 'carry_forward' });
    expect(by.mrk).toEqual({ id: 'mrk', group: 'unchanged', selection: 'carry_forward' });
    expect(plan.preview.books[0]!.id).toBe('gen');
    expect(plan.preview.removals).toEqual([]);
    expect(plan.preview.version).toEqual({ baseline_tag: 'v1.2', proposed: 'v1.2.1', rule_applied: 'revisions' });
    expect(plan.bound_to.default_branch_sha).toBe(branchSha);
    expect(stored(plan.id).payload.candidates.find(c => c.id === 'gen')).toMatchObject({ default_branch: { title: 'Kejadian', sha: 'd000000000000000000000000000000000000000' }, baseline: null });
  });
});

describe('a first release', () => {
  test('R4: with no release every book is included, the version is v1.0.0 (first), the binding has no tag, and the notes list every book as added', async () => {
    const base = pendau();
    const repo: Repo = { ...base.repo, catalog: { ...base.repo.catalog, prod: null } };
    const { fetch, calls } = door43({ repo, entries: { master: base.entries.master }, trees: base.trees });
    const plan = OPERATIONS['release.plan'].output.parse(await releasePlan(PENDAU, context(fetch)));
    expect(plan.bound_to).toEqual({ default_branch_sha: SHA, release_tag: null, release_tag_sha: null });
    expect(plan.preview.books).toHaveLength(27);
    expect(plan.preview.books.every(book => book.group === 'new' && book.selection === 'include')).toBe(true);
    expect(plan.preview.version).toEqual({ baseline_tag: null, proposed: 'v1.0.0', rule_applied: 'first' });
    expect(plan.would_write[0]!.target).toBe('bahtraku/Perjanjian-Baru-Pendau@temp-tca-release/v1.0.0');
    expect(plan.preview.notes_draft).toContain('First release.');
    expect(plan.preview.notes_draft).toContain('### Added\n- Matthew (MAT)\n- Mark (MRK)');
    expect(calls.filter(call => call.includes('v1.2'))).toEqual([]);
  });

  test('a project without books yet (the one the wizard created, E51) plans an empty first release', async () => {
    const repo = recorded<Repo>('2026-10-07/repos/tc-admin-qa-org__ums_tcaw2030.json');
    const { fetch } = door43({
      repo,
      entries: { master: recorded<unknown>('2026-10-07/catalog/entry__tc-admin-qa-org__ums_tcaw2030__master.json') },
      trees: { [repo.catalog.latest!.commit_sha]: recorded<Tree>('2026-10-07/repos/tc-admin-qa-org__ums_tcaw2030__git-trees__master.json') },
    });
    const plan = await releasePlan({ owner: 'tc-admin-qa-org', repo: 'ums_tcaw2030' }, context(fetch));
    expect(plan.preview.books).toEqual([]);
    expect(plan.preview.administrative).toEqual(['README.md']);
    expect(plan.preview.version.rule_applied).toBe('first');
  });
});

describe('what a plan refuses', () => {
  test('W2: a Resource Container project is not releasable, with its reason, before any tree is read', async () => {
    const { fetch, calls } = door43({ repo: recorded<Repo>('2026-10-07/repos/bahtraku__id_tb1.json'), entries: {}, trees: {} });
    const error = (await failure(releasePlan({ owner: 'bahtraku', repo: 'id_tb1' }, context(fetch))))!;
    expect(error.code).toBe('not_releasable');
    expect(error.message).toBe('Resource Container project. Import it into a new project to manage it here.');
    expect(calls.some(call => call.includes('/git/trees/'))).toBe(false);
    expect(kv.entries.size).toBe(0);
  });

  test('A2, P2: a repository the account cannot push to is permission_denied, and nothing is stored', async () => {
    const { fetch } = door43({ ...pendau(), writable: false });
    expect((await failure(releasePlan(PENDAU, context(fetch))))!.code).toBe('permission_denied');
    expect(kv.entries.size).toBe(0);
  });

  test('a repository Door43 does not have is not_found; no session is session_expired and Door43 is not asked', async () => {
    const { fetch, calls } = door43(pendau());
    expect((await failure(releasePlan({ owner: 'nobody', repo: 'nothing' }, context(async () => new Response('', { status: 404 })))))!.code).toBe('not_found');
    expect((await failure(releasePlan(PENDAU, context(fetch, null))))!.code).toBe('session_expired');
    expect(calls).toEqual([]);
  });
});
