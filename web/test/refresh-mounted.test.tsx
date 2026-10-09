// @vitest-environment jsdom
// Reading a project live, and refreshing (#26): the project view reads the full
// report (`project.read`) as it opens and shows its latest release, its
// findings, and its age; "Refresh" asks `project.refresh` and the answer
// replaces what is shown; a failed read keeps what is shown and says so; the
// portfolio's "Refresh" reads `portfolio.list` again (P3).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProjectReport } from '@tc-admin/shared/schema';
import { forgetCsrfToken } from '../src/api/client';
import { Portfolio } from '../src/Portfolio';
import { ProjectView } from '../src/ProjectView';
import { errorOf } from './support/upload';
import { book, importPlanOf, importReceiptOf, ownersOf, sourceOf, sourcesOf } from './support/import';
import { freshness, heldWorker, projectOf } from './support/mounted';

const PENDAU = projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible');
const READ = '/api/projects/bahtraku/Perjanjian-Baru-Pendau';

const reportOf = (overrides: Partial<ProjectReport> = {}): ProjectReport =>
  ProjectReport.parse({
    ...PENDAU,
    health: { state: 'warning', severity_raw: 'warning', ref: 'master', checked_at: '2026-10-08T10:00:00.000Z', issue_count: 28, issues: [], source: 'door43' },
    latest_full_release: { tag: 'v1.2', version: 'v1.2', sha: '2'.repeat(40), published_at: '2025-07-03T05:49:13Z', author: 'bahtraku' },
    default_branch_head: { sha: '2'.repeat(40), committed_at: '2026-10-07T10:00:00.000Z' },
    active_preparation: null,
    setup: { state: 'complete', failed_step: null },
    freshness: { read_at: new Date(Date.now() - 3 * 60_000).toISOString(), source: 'live', age_seconds: 0 },
    ...overrides,
  });

let worker: ReturnType<typeof heldWorker>;

beforeEach(() => {
  worker = heldWorker();
  vi.stubGlobal('fetch', worker.fetch);
  forgetCsrfToken();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

async function answerWhenSent(method: string, url: string, body: unknown, status = 200) {
  await vi.waitFor(() => expect(worker.waiting()).toContain(`${method} ${url}`));
  await worker.answer(method, url, body, status);
}

describe('the project view reads the full report', () => {
  test('#162, R8: an outstanding pre-release has its own row, opening its page, where it is promoted; none, no row', async () => {
    const view = render(<ProjectView project={PENDAU} />);
    await worker.answer('GET', READ, reportOf({ latest_prerelease: { tag: 'v1.2.1', sha: 'f'.repeat(40) } }));
    const link = screen.getByRole('link', { name: 'Open the pre-release v1.2.1' });
    // The visible words are inside the accessible name, and differ from the full release's link (WCAG 2.5.3).
    expect(link.textContent?.trim()).toBe('Open the pre-release');
    expect(link.getAttribute('href')).toBe('#/bahtraku/Perjanjian-Baru-Pendau/releases/v1.2.1');
    expect(link.closest('dd')?.previousElementSibling?.textContent).toBe('Pre-release');
    view.unmount();
    render(<ProjectView project={PENDAU} />);
    await worker.answer('GET', READ, reportOf());
    expect(screen.queryByText('Pre-release')).toBeNull();
  });

  test('#156: the latest full release opens on its own page from the project page; a project with none says so, with no link', async () => {
    const view = render(<ProjectView project={PENDAU} />);
    await worker.answer('GET', READ, reportOf());
    const link = screen.getByRole('link', { name: 'Open the release v1.2' });
    expect(link.getAttribute('href')).toBe('#/bahtraku/Perjanjian-Baru-Pendau/releases/v1.2');
    expect(link.closest('dd')?.textContent).toBe('v1.2 · Open the release');
    // #161: the browser offers no remembered tags, which belonged to other projects.
    expect(screen.getByLabelText(/A release by its tag/).getAttribute('autocomplete')).toBe('off');
    view.unmount();
    render(<ProjectView project={PENDAU} />);
    await worker.answer('GET', READ, reportOf({ latest_full_release: null }));
    expect(screen.queryByRole('link', { name: /^Open the release/ })).toBeNull();
    expect(screen.getByText('None yet')).toBeTruthy();
  });

  test('P3, H1: on opening, project.read; its latest release, its findings on the branch, and its age are shown', async () => {
    render(<ProjectView project={PENDAU} />);
    expect(screen.getByRole('status').textContent).toContain('Reading the project from Door43');
    await answerWhenSent('GET', READ, reportOf());
    expect(screen.getByText('v1.2')).toBeTruthy();
    // The report's summary line; the health section heads its list with the same count (#146).
    expect(screen.getByText(/Warning · 28 findings/, { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText(/· on master/)).toBeTruthy();
    expect(screen.getByText(/Read from Door43 at .+ · 3 minutes ago\./)).toBeTruthy();
  });

  test('P3: "Refresh" asks project.refresh once, and its answer replaces what is shown', async () => {
    render(<ProjectView project={PENDAU} />);
    await answerWhenSent('GET', READ, reportOf());
    const refresh = screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement;
    fireEvent.click(refresh);
    expect((screen.getByRole('button', { name: 'Refreshing…' }) as HTMLButtonElement).disabled).toBe(true);
    await answerWhenSent('POST', `${READ}/refresh`, reportOf({ latest_full_release: { tag: 'v1.3.0', version: 'v1.3.0', sha: '3'.repeat(40), published_at: '2026-10-08T11:00:00Z', author: 'tc-admin-qa' }, freshness: { read_at: new Date().toISOString(), source: 'live', age_seconds: 0 } }));
    expect(screen.getByText('v1.3.0')).toBeTruthy();
    expect(screen.getByText(/· just now\./)).toBeTruthy();
    expect(worker.sent.filter(request => request.url === `${READ}/refresh`)).toHaveLength(1);
  });

  test('X2: a read Door43 cannot answer keeps what is shown and says it was read earlier', async () => {
    render(<ProjectView project={PENDAU} />);
    await answerWhenSent('GET', READ, errorOf('door43_unavailable'), 503);
    expect(screen.getByRole('alert').textContent).toBe('Door43 is unavailable currently. Please refresh later. What is shown was read earlier.');
    expect(screen.getByRole('heading', { name: 'bahtraku/Perjanjian-Baru-Pendau' })).toBeTruthy();
  });

  test('P3: a receipt after a failed read replaces what is shown, and the alert that it was read earlier goes', async () => {
    const qa = projectOf('tc-admin-qa', 'id_tcai1633', 'bible');
    const base = '/api/projects/tc-admin-qa/id_tcai1633';
    render(<ProjectView project={qa} onFailure={() => {}} />);
    await answerWhenSent('GET', base, errorOf('door43_unavailable'), 503);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import books' }));
    await answerWhenSent('GET', '/api/owners', ownersOf([{ login: 'tc-admin-qa-org', name: 'tC Admin QA' }]));
    fireEvent.click(screen.getByRole('button', { name: 'tC Admin QA (tc-admin-qa-org)' }));
    await answerWhenSent('GET', '/api/sources?owner=tc-admin-qa-org&stage=latest', sourcesOf([sourceOf('bahtraku', 'id_tb1', { title: 'Alkitab Terjemahan Baru', stage: 'latest', format: 'rc' })]));
    fireEvent.click(screen.getByRole('radio', { name: /Alkitab Terjemahan Baru/ }));
    fireEvent.click(screen.getByLabelText('MAT · Matius'));
    fireEvent.click(screen.getByRole('button', { name: 'Plan the import of 2 books' }));
    await answerWhenSent('POST', `${base}/imports/plan`, importPlanOf('p1', [book('gen'), book('exo')]));
    fireEvent.click(screen.getByRole('button', { name: /^Import 2 books$/ }));
    await answerWhenSent('POST', `${base}/imports`, importReceiptOf('p1'));
    expect(screen.getByRole('heading', { name: 'tC Admin import probe' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('P3: a newer report of the same project, as a retried creation gives, replaces what is shown and is read again', async () => {
    const incomplete = reportOf({ setup: { state: 'incomplete', failed_step: 'first_commit' }, default_branch_head: null });
    const { rerender } = render(<ProjectView project={incomplete} />);
    await answerWhenSent('GET', READ, incomplete);
    expect(screen.queryByRole('button', { name: 'Add books' })).toBeNull();
    rerender(<ProjectView project={reportOf()} />);
    expect(screen.getByRole('button', { name: 'Add books' })).toBeTruthy();
    await answerWhenSent('GET', READ, reportOf());
    expect(screen.getByRole('button', { name: 'Add books' })).toBeTruthy();
    expect(worker.sent.filter(request => request.url === READ)).toHaveLength(2);
  });
});

describe('a creation\'s report survives a read made too early (bench round 2)', () => {
  test('E45: the project just created stays a Bible with "Add books" and "Import books" when Door43\'s catalog has not read it yet, and the view says so', async () => {
    const created = reportOf({ coverage: { present: 0, target: 27, scope: 'nt', basis: 'archive', units: [] }, latest_full_release: null });
    render(<ProjectView project={created} />);
    expect(screen.getByRole('button', { name: 'Add books' })).toBeTruthy();
    const notYetRead = reportOf({
      project_type: 'other',
      metadata_format: 'none',
      editability: { state: 'unsupported', reason: 'Door43 found no project metadata it recognizes. Release and editing are not available.' },
      coverage: { present: null, target: null, scope: 'unknown', basis: 'catalog', units: [] },
      latest_full_release: null,
    });
    await answerWhenSent('GET', READ, notYetRead);
    expect(screen.getByRole('button', { name: 'Add books' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import books' })).toBeTruthy();
    expect(screen.getByText(/Door43's catalog has not read this project's latest change yet/)).toBeTruthy();
  });
});

describe('the portfolio refreshes', () => {
  test('P3: "Refresh" reads portfolio.list again, and the list shows its age', async () => {
    render(<Portfolio account={{ login: 'tc-admin-qa', name: 'tC Admin QA' }} onFailure={() => {}} />);
    await answerWhenSent('GET', '/api/portfolio?show=supported', { organizations: [{ name: 'bahtraku', projects: [PENDAU] }], freshness: { ...freshness, read_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }, analysis: { complete: 1, pending: 0 } });
    expect(screen.getByText(/Read from Door43 at .+ · 2 hours ago\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await answerWhenSent('GET', '/api/portfolio?show=supported', { organizations: [{ name: 'bahtraku', projects: [PENDAU] }], freshness: { ...freshness, read_at: new Date().toISOString() }, analysis: { complete: 1, pending: 0 } });
    expect(screen.getByText(/· just now\./)).toBeTruthy();
    expect(worker.sent.filter(request => request.url === '/api/portfolio?show=supported')).toHaveLength(2);
  });

  test('P3, X2: a refresh Door43 cannot answer keeps the list and says it was read earlier; an expired session still ends the view', async () => {
    const onFailure = vi.fn<(failure: unknown) => void>();
    const listed = { organizations: [{ name: 'bahtraku', projects: [PENDAU] }], freshness, analysis: { complete: 1, pending: 0 } };
    render(<Portfolio account={{ login: 'tc-admin-qa', name: 'tC Admin QA' }} onFailure={onFailure} />);
    await answerWhenSent('GET', '/api/portfolio?show=supported', listed);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await answerWhenSent('GET', '/api/portfolio?show=supported', errorOf('door43_unavailable'), 503);
    expect(screen.getByRole('alert').textContent).toBe('Door43 is unavailable currently. Please refresh later. What is shown was read earlier.');
    expect(screen.getByRole('heading', { name: 'bahtraku' })).toBeTruthy();
    expect(onFailure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await answerWhenSent('GET', '/api/portfolio?show=supported', errorOf('session_expired'), 401);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
