// @vitest-environment jsdom
// A project's health in full, mounted (#146): once `project.read` answers, the
// project view lists the default branch's findings and the latest full
// release's, each with its severity as an icon and a word (H4) and Door43's
// text as written (H1), framed as the project's state: no release gate is
// stated. A check with no findings says so only when Door43 counted none; one
// still running or one Door43 could not answer says that, never healthy (H3).
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProjectReport } from '@tc-admin/shared/schema';
import type { Health, HealthIssue } from '@tc-admin/shared/schema';
import { forgetCsrfToken } from '../src/api/client';
import { ProjectView } from '../src/ProjectView';
import { heldWorker, projectOf } from './support/mounted';

const PENDAU = projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible');
const READ = '/api/projects/bahtraku/Perjanjian-Baru-Pendau';
const AT = '2026-10-08T10:00:00.000Z';

const issueOf = (code: string, severity: string, title: string): HealthIssue => ({ code, rule: null, severity, title, details: `Details of ${code}`, suggestion: '' });
const healthOf = (ref: string, state: Health['state'], issues: HealthIssue[] | null): Health => ({
  state,
  severity_raw: issues ? state : null,
  ref,
  checked_at: AT,
  issue_count: issues ? issues.length : null,
  issues,
  source: 'door43',
});
const RELEASE = { tag: 'v1.2', version: 'v1.2', sha: '2'.repeat(40), published_at: '2025-07-03T05:49:13Z', author: 'bahtraku' };

const reportOf = (overrides: Partial<ProjectReport> = {}): ProjectReport =>
  ProjectReport.parse({
    ...PENDAU,
    health: healthOf('master', 'failing', [issueOf('sb_ingredient_mismatch', 'warning', 'Ingredient size does not match'), issueOf('missing_book', 'error', 'A book in the scope is missing')]),
    latest_full_release: RELEASE,
    release_health: healthOf('v1.2', 'warning', [issueOf('ingredient_title_is_en', 'warning', 'Ingredient title is in English')]),
    default_branch_head: { sha: '2'.repeat(40), committed_at: AT },
    active_preparation: null,
    setup: { state: 'complete', failed_step: null },
    freshness: { read_at: new Date().toISOString(), source: 'live', age_seconds: 0 },
    ...overrides,
  });

let worker: ReturnType<typeof heldWorker>;

beforeEach(() => {
  worker = heldWorker();
  vi.stubGlobal('fetch', worker.fetch);
  forgetCsrfToken();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const opened = async (report: ProjectReport) => {
  render(<ProjectView project={PENDAU} />);
  // Before the read answers, the summary's count is all there is: no findings are listed as if read.
  expect(screen.queryByRole('region', { name: 'Health check' })).toBeNull();
  await worker.answer('GET', READ, report);
  return screen.getByRole('region', { name: 'Health check' });
};

describe('#146: the project view lists its health findings without a release', () => {
  test('#146, H1, H4: the default branch\'s findings and the latest release\'s are listed, each severity as a word, errors first; no release gate is stated', async () => {
    const section = await opened(reportOf());
    const branch = within(section).getByRole('region', { name: 'Default branch, master' });
    expect(within(branch).getByRole('heading', { level: 4 }).textContent).toBe('Default branch, master · Failing · 2 findings');
    const rows = within(branch).getAllByRole('listitem');
    expect(rows.map(row => row.querySelector('.severity-badge')?.textContent)).toEqual(['Error', 'Warning']);
    expect(within(rows[0]!).getByText('A book in the scope is missing')).toBeTruthy();

    const release = within(section).getByRole('region', { name: 'Latest release, v1.2' });
    expect(within(release).getByRole('heading', { level: 4 }).textContent).toBe('Latest release, v1.2 · Warning · 1 finding');
    expect(within(release).getByText('Ingredient title is in English')).toBeTruthy();

    // The project's state, not a release's gate: the stepper's summaries are not shown here.
    expect(screen.queryByText(/Release blocked|confirm below before releasing/)).toBeNull();
  });

  test('#146, H3: a check with no findings says so only when Door43 counted none', async () => {
    const section = await opened(reportOf({ health: healthOf('master', 'healthy', []) }));
    expect(within(section).getByText("Door43's check found nothing to report on master.")).toBeTruthy();
  });

  test('#146, H3: a release check still running, or one Door43 could not answer, says that and lists nothing; never healthy', async () => {
    const section = await opened(reportOf({ release_health: healthOf('v1.2', 'checking', null) }));
    const release = within(section).getByRole('region', { name: 'Latest release, v1.2' });
    expect(within(release).getByRole('heading', { level: 4 }).textContent).toBe('Latest release, v1.2 · Health check running');
    expect(within(release).getByText('Door43 is still checking on v1.2. Refresh in a moment.')).toBeTruthy();
    expect(within(release).queryByText(/Healthy|nothing to report/)).toBeNull();
    cleanup();

    const unavailable = await opened(reportOf({ health: healthOf('master', 'door43_unavailable', null) }));
    const branch = within(unavailable).getByRole('region', { name: 'Default branch, master' });
    expect(within(branch).getByText('Door43 could not be asked for its health check on master. Refresh later.')).toBeTruthy();
    expect(within(branch).queryByRole('list')).toBeNull();
  });

  test('#146: a receipt\'s health, of the commit it wrote, is headed by the default branch, never the commit hash; the heading counts what Door43 counted', async () => {
    const commit = 'c'.repeat(40);
    const section = await opened(reportOf({ health: { ...healthOf(commit, 'never_checked', null), severity_raw: null }, release_health: null }));
    expect(within(section).getByRole('region', { name: 'Default branch, master' })).toBeTruthy();
    expect(within(section).queryByText(new RegExp(`Default branch, ${commit}`))).toBeNull();
    cleanup();

    const counted = await opened(reportOf({ health: { ...healthOf('master', 'warning', [issueOf('ingredient_title_is_en', 'warning', 'Ingredient title is in English')]), issue_count: 3 } }));
    expect(within(within(counted).getByRole('region', { name: 'Default branch, master' })).getByRole('heading', { level: 4 }).textContent).toBe('Default branch, master · Warning · 3 findings');
  });

  test('#146: a project without a full release says there is no release to check; a report that did not read the release\'s health says so', async () => {
    const section = await opened(reportOf({ latest_full_release: null, release_health: null }));
    expect(within(section).getByText('No full release yet, so there is no release to check.')).toBeTruthy();
    cleanup();

    const unread = await opened(reportOf({ release_health: null }));
    expect(within(unread).getByText('The health check of the latest release, v1.2, was not read with this report. Refresh to read it.')).toBeTruthy();
  });
});
