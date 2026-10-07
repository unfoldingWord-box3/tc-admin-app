// `portfolio.list` (operations.md §4). Every repository the signed-in account
// can write, from the repository search, each classified from the catalog
// metadata that search already carries (E12, E32): no read per project and no
// archive (Q17), so analysis is complete when the list is. By default Door43
// is asked for Scripture Burrito Bible and Open Bible Stories repositories
// only, the projects tC Admin manages; `show: all` asks for every repository
// and lists the unsupported ones with their reasons (ADR 0014). The filter,
// carried over from the prototype: a repository is listed when it is not
// archived and Door43 explicitly grants push or admin (P1, P2). Projects are
// grouped by owner, the account's organizations first and its own account
// last (product spec §2), each group by repository name; the configurable
// sort is #24.

import type { OperationOutput, ParsedInput, ProjectSummary } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import { projectCatalog, repositoryIdentity } from '../door43/catalog';
import { repositoryAccess, searchRepositories } from '../door43/repos';
import type { Door43SearchRepository, RepositoryAccess } from '../door43/repos';
import { healthFromSeverity } from '../model/health';
import { classifyProject } from '../model/project';
import type { OperationContext } from './context';
import { signedIn } from './context';

type PortfolioList = OperationOutput<'portfolio.list'>;

export function isListed(access: RepositoryAccess): boolean {
  return !access.archived && (access.push || access.admin);
}

/**
 * One search item as a project summary. Door43 does not say which ref or when
 * the search's health severity was checked, so those are `null` (H1); the
 * issue count needs the health-check read (#25).
 */
export function projectSummary(repo: Door43SearchRepository, access: RepositoryAccess, checkedAt: string): ProjectSummary {
  const severity = repo.healthcheck_severity || null;
  return {
    ...repositoryIdentity(repo),
    ...classifyProject(projectCatalog(repo)),
    health: { state: healthFromSeverity(severity), severity_raw: severity, ref: null, checked_at: null, issue_count: null, issues: null, source: 'door43' },
    permissions: { push: access.push, admin: access.admin, checked_at: checkedAt },
  };
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** Owner groups: organizations by name, then the account's own repositories. */
export function groupByOwner(projects: readonly ProjectSummary[], accountLogin: string): PortfolioList['organizations'] {
  const groups = new Map<string, ProjectSummary[]>();
  for (const project of projects) {
    const group = groups.get(project.ref.owner) ?? [];
    group.push(project);
    groups.set(project.ref.owner, group);
  }
  const own = (name: string) => name.toLowerCase() === accountLogin.toLowerCase();
  return [...groups.keys()]
    .sort((a, b) => Number(own(a)) - Number(own(b)) || byName(a, b))
    .map(name => ({ name, projects: groups.get(name)!.sort((a, b) => byName(a.ref.repo, b.ref.repo)) }));
}

/** The filters the catalog names; `sort` is #24. */
function matches(project: ProjectSummary, input: ParsedInput<'portfolio.list'>): boolean {
  if (input.organization && project.ref.owner !== input.organization) return false;
  if (input.language && project.language.code !== input.language) return false;
  if (input.project_type && project.project_type !== input.project_type) return false;
  if (input.health_state && project.health.state !== input.health_state) return false;
  return true;
}

export async function portfolioList(input: ParsedInput<'portfolio.list'>, context: OperationContext): Promise<PortfolioList> {
  const client = signedIn(context);
  const { account, userId } = await readAccount(client);
  const repositories = await searchRepositories(client, userId, input.show !== 'all');
  const readAt = context.now().toISOString();
  const projects = repositories.flatMap(repo => {
    const access = repositoryAccess(repo);
    return isListed(access) ? [projectSummary(repo, access, readAt)] : [];
  });
  const shown = projects.filter(project => matches(project, input));
  return {
    organizations: groupByOwner(shown, account.login),
    freshness: { read_at: readAt, source: 'live', age_seconds: 0 },
    analysis: { complete: shown.length, pending: 0 },
  };
}
