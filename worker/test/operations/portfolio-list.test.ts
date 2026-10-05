// `portfolio.list` (#23): the filter carried over from the prototype (#7),
// discovery, and the operation over a portfolio of every kind of repository,
// built from the recorded seed repositories (E32) and stand-ins.
import { readFileSync } from 'node:fs';
import { OPERATIONS } from '@tc-admin/shared/schema';
import type { ParsedInput } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { repositoryAccess } from '../../src/door43/repos';
import type { Door43SearchRepository } from '../../src/door43/repos';
import { SUPPORTED_FLAVORS } from '../../src/model/project';
import { operationContext } from '../../src/operations';
import { isListed, portfolioList } from '../../src/operations/portfolio-list';

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

describe('portfolio.list', () => {
  const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
  const recorded = (name: string): Door43SearchRepository =>
    (JSON.parse(readFileSync(new URL(`2026-09-30/search/${name}.json`, fixtures), 'utf8')) as { data: Door43SearchRepository[] }).data[0]!;
  const writable = { permissions: { push: true, admin: false, pull: true } };

  /** A portfolio of every kind of writable repository, and two the account cannot write. */
  const portfolio: Door43SearchRepository[] = [
    { ...recorded('bahtraku__Perjanjian-Baru-Pendau'), ...writable },
    { ...recorded('bahtraku__id_tb1'), ...writable },
    repo({ id: 10, name: 'en_obs', owner: { login: 'team' }, metadata_type: 'sb', flavor: 'textStories', ingredients: null, ...writable }),
    repo({ id: 11, name: 'id_ts_mat', owner: { login: 'team' }, metadata_type: 'ts', flavor: 'textTranslation', ingredients: [{ identifier: 'mat', path: './mat', exists: true }], ...writable }),
    repo({ id: 12, name: 'id_tc_mrk', owner: { login: 'team' }, metadata_type: 'tc', flavor: 'textTranslation', ingredients: [{ identifier: 'mrk', path: './mrk', exists: true }], ...writable }),
    repo({ id: 13, name: 'empty', owner: { login: 'tc-admin-qa' }, metadata_type: null, flavor: null, ...writable }),
    repo({ id: 14, name: 'id_tw', owner: { login: 'team' }, metadata_type: 'rc', flavor: 'x-peripheralArticles', permissions: { admin: true } }),
    repo({ id: 15, name: 'read_only', owner: { login: 'team' }, metadata_type: 'sb', flavor: 'textTranslation', permissions: { pull: true } }),
    repo({ id: 16, name: 'old', owner: { login: 'team' }, metadata_type: 'sb', flavor: 'textTranslation', archived: true, ...writable }),
  ];

  const run = async (repositories = portfolio, input: ParsedInput<'portfolio.list'> = { show: 'all' }) => {
    const calls: string[] = [];
    const searches: URLSearchParams[] = [];
    const fetch = async (url: string) => {
      const { pathname, searchParams } = new URL(url);
      calls.push(pathname);
      if (pathname === '/api/v1/repos/search') searches.push(searchParams);
      if (pathname === '/api/v1/user') return Response.json({ id: 7, login: 'tc-admin-qa', full_name: 'tC Admin QA' });
      const page = Number(searchParams.get('page'));
      return Response.json({ ok: true, data: page === 1 ? repositories : [] });
    };
    const context = { ...operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', 't'), now: () => new Date('2026-10-02T12:00:00Z') };
    const output = OPERATIONS['portfolio.list'].output.parse(await portfolioList(input, { ...context, door43: { ...context.door43!, fetch } }));
    return { output, calls, searches, projects: output.organizations.flatMap(group => group.projects) };
  };

  test('P1: by default Door43 is asked for Scripture Burrito repositories of exactly the flavors the model classifies as bible or obs (ADR 0014, E41, E42)', async () => {
    const { searches } = await run(portfolio, {});
    for (const query of searches) {
      expect(query.get('metadataType')).toBe('sb');
      expect(query.getAll('flavor')).toEqual(['textTranslation', 'textStories']);
      expect(query.getAll('flavor')).toEqual([...SUPPORTED_FLAVORS]);
      expect([query.get('uid'), query.get('exclusive'), query.get('private')]).toEqual(['7', 'false', 'true']);
    }
    expect(searches.length).toBeGreaterThan(0);
  });

  test('P1: show all asks Door43 for every repository, with no format or flavor filter', async () => {
    const { searches } = await run(portfolio, { show: 'all' });
    expect(searches.every(query => !query.has('metadataType') && !query.has('flavor'))).toBe(true);
  });

  test('P1: with show all, every writable repository is listed with its editability state and reason, whatever its format or type', async () => {
    const { projects } = await run();
    const byRepo = Object.fromEntries(projects.map(project => [project.ref.repo, project.editability]));
    expect(byRepo).toEqual({
      'Perjanjian-Baru-Pendau': { state: 'editable', reason: 'Scripture Burrito project. Release and editing are available.' },
      'en_obs': { state: 'editable', reason: 'Scripture Burrito project. Release and editing are available.' },
      'id_tb1': { state: 'unsupported', reason: 'Resource Container project. Import it into a new project to manage it here.' },
      'id_ts_mat': { state: 'unsupported', reason: 'translationStudio project. Import it into a new project to manage it here.' },
      'id_tc_mrk': { state: 'unsupported', reason: 'translationCore project. Import it into a new project to manage it here.' },
      'empty': { state: 'unsupported', reason: 'Door43 found no project metadata it recognizes. Release and editing are not available.' },
      'id_tw': { state: 'unsupported', reason: 'tC Admin manages Bible and Open Bible Stories projects only. Release and editing are not available.' },
    });
  });

  test('P2: a repository the account can only read, or an archived one, is not listed', async () => {
    const { projects } = await run();
    expect(projects.map(project => project.ref.repo)).not.toContain('read_only');
    expect(projects.map(project => project.ref.repo)).not.toContain('old');
  });

  test('projects are grouped by owner, organizations by name first and the account\'s own repositories last', async () => {
    const { output } = await run();
    expect(output.organizations.map(group => [group.name, group.projects.map(project => project.ref.repo)])).toEqual([
      ['bahtraku', ['id_tb1', 'Perjanjian-Baru-Pendau']],
      ['team', ['en_obs', 'id_tc_mrk', 'id_ts_mat', 'id_tw']],
      ['tc-admin-qa', ['empty']],
    ]);
  });

  test('H5: a summary carries the identity, coverage, and Door43 health the search returned, with no read per project and no archive', async () => {
    const { projects, calls, output } = await run();
    expect(projects.find(project => project.ref.repo === 'Perjanjian-Baru-Pendau')).toMatchObject({
      ref: { owner: 'bahtraku', id: 94740, url: 'https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau' },
      title: 'Perjanjian Baru Pendau',
      default_branch: 'master',
      language: { code: 'ums', title: 'Pendau' },
      project_type: 'bible',
      metadata_format: 'sb',
      coverage: { present: 27, target: 27, scope: 'nt', basis: 'catalog' },
      health: { state: 'warning', severity_raw: 'warning', ref: null, checked_at: null, issue_count: null, source: 'door43' },
      permissions: { push: true, admin: false, checked_at: '2026-10-02T12:00:00.000Z' },
    });
    expect(new Set(calls)).toEqual(new Set(['/api/v1/user', '/api/v1/repos/search']));
    expect(output.freshness).toEqual({ read_at: '2026-10-02T12:00:00.000Z', source: 'live', age_seconds: 0 });
    expect(output.analysis).toEqual({ complete: 7, pending: 0 });
  });

  test('H3: unknown coverage and unchecked health are null and never_checked, not zero or healthy', async () => {
    const { projects } = await run();
    const obs = projects.find(project => project.ref.repo === 'en_obs')!;
    expect(obs.coverage).toMatchObject({ present: null, target: 50, scope: 'obs' });
    expect(obs.health).toMatchObject({ state: 'never_checked', severity_raw: null });
  });

  test('a repository without a title is called by its name', async () => {
    const { projects } = await run();
    expect(projects.find(project => project.ref.repo === 'empty')!.title).toBe('empty');
  });

  test('filters narrow the list by organization, language, project type, and health state', async () => {
    expect((await run(portfolio, { show: 'all', organization: 'bahtraku' })).projects.map(project => project.ref.repo)).toEqual(['id_tb1', 'Perjanjian-Baru-Pendau']);
    expect((await run(portfolio, { show: 'all', language: 'ums' })).projects.map(project => project.ref.repo)).toEqual(['Perjanjian-Baru-Pendau']);
    expect((await run(portfolio, { show: 'all', project_type: 'obs' })).projects.map(project => project.ref.repo)).toEqual(['en_obs']);
    expect((await run(portfolio, { show: 'all', health_state: 'warning' })).projects.map(project => project.ref.repo)).toEqual(['Perjanjian-Baru-Pendau']);
  });

  test('without a session it is session_expired, and Door43 is not asked', async () => {
    const context = operationContext({ door43Origin: 'https://qa.door43.org' }, 'request-1');
    await expect(portfolioList({}, context)).rejects.toMatchObject({ code: 'session_expired' });
  });
});
