// The portfolio's filters and secondary ordering (#24, product spec §5): by
// organization, language, project type, and health state, and within each
// owner group by name, by language, or by most recent activity. Applied in the
// browser over the portfolio already read (operations.md `portfolio.list`:
// "filters are applied by the client where the whole portfolio is already
// loaded"), so a change of filter reads nothing from Door43. The grouping
// itself, the account's organizations first and its own account last, is the
// Worker's and is kept. Pure, but for the remembered choice, which is a
// per-viewer convenience (architecture §4 "user display preferences") kept in
// this browser's `localStorage`, guarded so a refusing browser just forgets it.

import type { HealthState, ProjectSummary, ProjectType } from '@tc-admin/shared/schema';

export type SortOrder = 'name' | 'language' | 'activity';

export interface PortfolioView {
  organization: string | null;
  language: string | null;
  project_type: ProjectType | null;
  health: HealthState | null;
  sort: SortOrder;
}

export const DEFAULT_VIEW: PortfolioView = { organization: null, language: null, project_type: null, health: null, sort: 'name' };

export const SORT_LABELS: Readonly<Record<SortOrder, string>> = { name: 'Name', language: 'Language', activity: 'Most recent activity' };

interface Group {
  name: string;
  projects: ProjectSummary[];
}

/** What the filters can offer: only what the loaded portfolio holds, each once, in a stable order. */
export function filterChoices(groups: readonly Group[]): {
  organizations: string[];
  languages: { code: string; title: string }[];
  project_types: ProjectType[];
  health: HealthState[];
} {
  const projects = groups.flatMap(group => group.projects);
  const languages = new Map<string, string>();
  for (const project of projects) if (project.language.code && !languages.has(project.language.code)) languages.set(project.language.code, project.language.title || project.language.code);
  const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return {
    organizations: groups.map(group => group.name),
    languages: [...languages].map(([code, title]) => ({ code, title })).sort((a, b) => byText(a.title, b.title) || byText(a.code, b.code)),
    project_types: (['bible', 'obs', 'other'] as const).filter(type => projects.some(project => project.project_type === type)),
    health: [...new Set(projects.map(project => project.health.state))],
  };
}

const matches = (project: ProjectSummary, view: PortfolioView): boolean =>
  (view.language === null || project.language.code === view.language) &&
  (view.project_type === null || project.project_type === view.project_type) &&
  (view.health === null || project.health.state === view.health);

const byName = (a: ProjectSummary, b: ProjectSummary) => a.ref.repo.localeCompare(b.ref.repo, undefined, { sensitivity: 'base' });
const activity = (project: ProjectSummary) => {
  const at = project.last_activity_at ? new Date(project.last_activity_at).getTime() : Number.NaN;
  return Number.isNaN(at) ? -Infinity : at;
};

const ORDERS: Readonly<Record<SortOrder, (a: ProjectSummary, b: ProjectSummary) => number>> = {
  name: byName,
  language: (a, b) => (a.language.title || a.language.code).localeCompare(b.language.title || b.language.code, undefined, { sensitivity: 'base' }) || byName(a, b),
  // Newest first; a project Door43 gives no date for comes last, never first.
  activity: (a, b) => activity(b) - activity(a) || byName(a, b),
};

/** The groups as the view shows them: the organization chosen, or all; each group's projects filtered and ordered; a group left empty dropped. */
export function applyView<G extends Group>(groups: readonly G[], view: PortfolioView): G[] {
  return groups
    .filter(group => view.organization === null || group.name === view.organization)
    .map(group => ({ ...group, projects: group.projects.filter(project => matches(project, view)).sort(ORDERS[view.sort]) }))
    .filter(group => group.projects.length > 0);
}

/**
 * A filter's active value that the list no longer holds, after a refresh (bench round 2 on #142): `null` when there is
 * none. The selector keeps showing it, marked as gone, so the selector and the list never disagree; the manager clears it.
 */
export function goneChoice<T>(offered: readonly T[], active: T | null): T | null {
  return active !== null && !offered.includes(active) ? active : null;
}

/** The words for an active value the list no longer holds. */
export const goneLabel = (label: string): string => `${label} · none in the list now`;

/** Whether any filter narrows the list. */
export const filtered = (view: PortfolioView): boolean => view.organization !== null || view.language !== null || view.project_type !== null || view.health !== null;

const VIEW_KEY = 'tca:portfolio-view';
const SORTS: readonly string[] = ['name', 'language', 'activity'];

/** The view this browser last chose; the default when none, or when what is kept is not a view. Filters are not kept, only the order: a filter left on would hide projects next time. */
export function rememberedView(): PortfolioView {
  try {
    const sort = window.localStorage.getItem(VIEW_KEY);
    return sort && SORTS.includes(sort) ? { ...DEFAULT_VIEW, sort: sort as SortOrder } : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export function rememberView(view: PortfolioView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view.sort);
  } catch {
    // A refusing browser forgets the order, as before.
  }
}
