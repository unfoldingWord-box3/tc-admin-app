// @vitest-environment jsdom
// The portfolio's filters and order mounted (#24): choosing a filter narrows
// the list without reading Door43 again, the count says how many are shown,
// clearing brings them back, the order is remembered by this browser and the
// filters are not, and each project says when it last changed.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProjectSummary } from '@tc-admin/shared/schema';
import { forgetCsrfToken } from '../src/api/client';
import { Portfolio } from '../src/Portfolio';
import { freshness, heldWorker, projectOf } from './support/mounted';

const with_ = (project: ProjectSummary, patch: Partial<ProjectSummary>): ProjectSummary => ({ ...project, ...patch });
const pendau = with_(projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible'), { title: 'Perjanjian Baru Pendau', language: { code: 'ums', title: 'Pendau' }, last_activity_at: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString() });
const tb1 = with_(projectOf('bahtraku', 'id_tb1', 'obs'), { title: 'Alkitab TB', language: { code: 'id', title: 'Bahasa Indonesia' }, last_activity_at: new Date(Date.now() - 60 * 60_000).toISOString() });
const portfolio = { organizations: [{ name: 'bahtraku', projects: [pendau, tb1] }], freshness, analysis: { complete: 2, pending: 0 } };

let worker: ReturnType<typeof heldWorker>;

beforeEach(() => {
  worker = heldWorker();
  vi.stubGlobal('fetch', worker.fetch);
  forgetCsrfToken();
  window.location.hash = '';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function mount() {
  render(<Portfolio account={{ login: 'tc-admin-qa', name: 'tC Admin QA' }} onFailure={() => {}} />);
  await vi.waitFor(() => expect(worker.waiting()).toContain('GET /api/portfolio?show=supported'));
  await worker.answer('GET', '/api/portfolio?show=supported', portfolio);
}
const titles = () => screen.getAllByRole('listitem').map(item => within(item).getByText(/Pendau|Alkitab/, { selector: 'strong' }).textContent);

describe('#24: filters and order in the portfolio', () => {
  test('#24: a language filter narrows the list without reading Door43 again; the count says so; clearing brings every project back', async () => {
    await mount();
    expect(screen.getByRole('status').textContent).toBe('2 projects');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ums' } });
    expect(titles()).toEqual(['Perjanjian Baru Pendau']);
    expect(screen.getByRole('status').textContent).toBe('Showing 1 of 2 projects');
    fireEvent.change(screen.getByLabelText('Project type'), { target: { value: 'obs' } });
    expect(screen.queryAllByRole('listitem')).toEqual([]);
    expect(screen.getByText('No project matches these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the filters' }));
    expect(titles()).toHaveLength(2);
    expect(worker.sent.filter(request => request.url.startsWith('/api/portfolio'))).toHaveLength(1);
  });

  test('#24: ordered by most recent activity, the newest comes first, each says when it changed, and the order is remembered; a filter is not', async () => {
    await mount();
    expect(titles()).toEqual(['Alkitab TB', 'Perjanjian Baru Pendau']);
    fireEvent.change(screen.getByLabelText('Order within each owner'), { target: { value: 'activity' } });
    expect(titles()).toEqual(['Alkitab TB', 'Perjanjian Baru Pendau']);
    expect(screen.getByText(/changed 1 hour ago/)).toBeTruthy();
    expect(screen.getByText(/changed 3 days ago/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ums' } });
    cleanup();

    worker = heldWorker();
    vi.stubGlobal('fetch', worker.fetch);
    await mount();
    expect((screen.getByLabelText('Order within each owner') as HTMLSelectElement).value).toBe('activity');
    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('');
    expect(titles()).toHaveLength(2);
  });

  test('#24: ordered by name, the projects follow their repository names', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Order within each owner'), { target: { value: 'name' } });
    expect(titles()).toEqual(['Alkitab TB', 'Perjanjian Baru Pendau']);
    fireEvent.change(screen.getByLabelText('Order within each owner'), { target: { value: 'language' } });
    expect(titles()).toEqual(['Alkitab TB', 'Perjanjian Baru Pendau']);
  });
});
