// The portfolio filter, carried over from the prototype (#7); the operation is #23.
import { describe, expect, test } from 'vitest';
import { repositoryAccess } from '../../src/door43/repos';
import type { Door43SearchRepository } from '../../src/door43/repos';
import { isListed } from '../../src/operations/portfolio-list';

const repo = (extra: Partial<Door43SearchRepository>): Door43SearchRepository => ({
  id: 1,
  name: 'sw_ult',
  full_name: 'team/sw_ult',
  owner: { login: 'team' },
  ...extra,
});
const listed = (extra: Partial<Door43SearchRepository>) => isListed(repositoryAccess(repo(extra)));

describe('which repositories the portfolio lists', () => {
  test('P2: a missing or ambiguous permissions object grants nothing', () => {
    expect(listed({})).toBe(false);
    expect(listed({ permissions: null })).toBe(false);
    expect(listed({ permissions: { push: 'true', admin: 1 } })).toBe(false);
    expect(listed({ permissions: { pull: true } })).toBe(false);
  });

  test('P1: every non-archived repository with push or admin is listed', () => {
    expect(listed({ permissions: { push: true } })).toBe(true);
    expect(listed({ permissions: { admin: true } })).toBe(true);
    expect(listed({ permissions: { push: true }, archived: true })).toBe(false);
  });
});

describe('discovery', () => {
  test('the repository search is read page by page and each repository appears once', async () => {
    const { searchRepositories } = await import('../../src/door43/repos');
    const { door43Host } = await import('../../src/door43/host');
    const pages = [[repo({ id: 1 }), repo({ id: 2 })], [repo({ id: 2 }), repo({ id: 3 })], []];
    const fetch = async (url: string) => {
      const query = new URL(url).searchParams;
      expect([query.get('uid'), query.get('exclusive'), query.get('private')]).toEqual(['7', 'false', 'true']);
      return new Response(JSON.stringify({ ok: true, data: pages[Number(query.get('page')) - 1] }));
    };
    const found = await searchRepositories({ host: door43Host('https://qa.door43.org'), token: 't', fetch }, 7);
    expect(found.map(r => r.id)).toEqual([1, 2, 3]);
  });
});
