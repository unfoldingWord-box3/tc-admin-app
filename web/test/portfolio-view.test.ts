// The portfolio's filters and order (#24, product spec §5): only what the
// list holds is offered; filters narrow, groups left empty go; the order
// within a group is by name, language, or most recent activity, a project
// with no date last; the owner grouping is the Worker's and is kept.
import { describe, expect, test } from 'vitest';
import type { ProjectSummary } from '@tc-admin/shared/schema';
import { DEFAULT_VIEW, applyView, filterChoices, filtered, goneChoice, goneLabel } from '../src/portfolio-view';
import { projectOf } from './support/mounted';

const with_ = (project: ProjectSummary, patch: Partial<ProjectSummary>): ProjectSummary => ({ ...project, ...patch });
const pendau = with_(projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible'), { language: { code: 'ums', title: 'Pendau' }, last_activity_at: '2026-07-21T04:42:35Z' });
const tb1 = with_(projectOf('bahtraku', 'id_tb1', 'bible'), { language: { code: 'id', title: 'Bahasa Indonesia' }, last_activity_at: '2026-10-08T12:00:00Z', health: { ...projectOf('a', 'b').health, state: 'warning' } });
const obs = with_(projectOf('bahtraku', 'id_obs', 'obs'), { language: { code: 'id', title: 'Bahasa Indonesia' }, last_activity_at: null });
const own = with_(projectOf('tc-admin-qa', 'id_tcai1633', 'bible'), { language: { code: 'id', title: 'Bahasa Indonesia' }, last_activity_at: '2026-10-08T18:00:00Z' });
const groups = [
  { name: 'bahtraku', projects: [pendau, tb1, obs] },
  { name: 'tc-admin-qa', projects: [own] },
];
const names = (shown: { name: string; projects: ProjectSummary[] }[]) => shown.map(group => [group.name, group.projects.map(project => project.ref.repo)]);

describe('what the filters offer', () => {
  test('#24: the organizations in the Worker\'s order, each language once by its title, the project types and health states the list holds', () => {
    expect(filterChoices(groups)).toEqual({
      organizations: ['bahtraku', 'tc-admin-qa'],
      languages: [{ code: 'id', title: 'Bahasa Indonesia' }, { code: 'ums', title: 'Pendau' }],
      project_types: ['bible', 'obs'],
      health: ['healthy', 'warning'],
    });
  });
});

describe('filtering', () => {
  test('#24: no filter keeps every group in the Worker\'s order, each by name', () => {
    expect(names(applyView(groups, DEFAULT_VIEW))).toEqual([
      ['bahtraku', ['id_obs', 'id_tb1', 'Perjanjian-Baru-Pendau']],
      ['tc-admin-qa', ['id_tcai1633']],
    ]);
    expect(filtered(DEFAULT_VIEW)).toBe(false);
  });

  test('#24: by organization, language, project type, and health; a group left empty is not shown', () => {
    expect(names(applyView(groups, { ...DEFAULT_VIEW, organization: 'tc-admin-qa' }))).toEqual([['tc-admin-qa', ['id_tcai1633']]]);
    expect(names(applyView(groups, { ...DEFAULT_VIEW, language: 'ums' }))).toEqual([['bahtraku', ['Perjanjian-Baru-Pendau']]]);
    expect(names(applyView(groups, { ...DEFAULT_VIEW, project_type: 'obs' }))).toEqual([['bahtraku', ['id_obs']]]);
    expect(names(applyView(groups, { ...DEFAULT_VIEW, health: 'warning' }))).toEqual([['bahtraku', ['id_tb1']]]);
    expect(names(applyView(groups, { ...DEFAULT_VIEW, language: 'ums', project_type: 'obs' }))).toEqual([]);
    expect(filtered({ ...DEFAULT_VIEW, health: 'warning' })).toBe(true);
  });
});

describe('ordering within a group', () => {
  test('#24: by most recent activity, newest first, a project Door43 gives no date for last; by language, then name', () => {
    expect(names(applyView(groups, { ...DEFAULT_VIEW, sort: 'activity' }))[0]).toEqual(['bahtraku', ['id_tb1', 'Perjanjian-Baru-Pendau', 'id_obs']]);
    expect(names(applyView(groups, { ...DEFAULT_VIEW, sort: 'language' }))[0]).toEqual(['bahtraku', ['id_obs', 'id_tb1', 'Perjanjian-Baru-Pendau']]);
  });

  test('the groups themselves keep the Worker\'s order whatever the order within them', () => {
    expect(applyView(groups, { ...DEFAULT_VIEW, sort: 'activity' }).map(group => group.name)).toEqual(['bahtraku', 'tc-admin-qa']);
  });
});

describe('a filter whose value the list no longer holds', () => {
  test('#24: the active value the list lacks is named, so its selector can keep showing it; a value still offered, or none, is not', () => {
    expect(goneChoice(['id', 'ums'], 'ums')).toBeNull();
    expect(goneChoice(['id'], 'ums')).toBe('ums');
    expect(goneChoice(['id'], null)).toBeNull();
    expect(goneLabel('Pendau')).toBe('Pendau · none in the list now');
  });
});
