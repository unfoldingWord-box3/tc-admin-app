// @vitest-environment jsdom
// Each page names itself (#154): the portfolio's one top heading is "Your
// projects", and every other page (a project, creating one, the release
// stepper, a release by its tag, importing, adding books) has its own title as
// its one top heading, not "Your projects" above it. Signed out, the page still says "Your
// projects" (the sign-in test waits on it, e2e/sign-in.spec.ts).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetCsrfToken } from '../src/api/client';
import { OPERATIONS } from '@tc-admin/shared/schema';
import { App } from '../src/App';
import { CreateProject } from '../src/CreateProject';
import { ImportScreen } from '../src/ImportScreen';
import { UploadScreen } from '../src/UploadScreen';
import { freshness, heldWorker, projectOf } from './support/mounted';

const host = { origin: 'https://qa.door43.org', name: 'QA', development: true };
const account = { login: 'tc-admin-qa', name: 'tC Admin QA' };
const PENDAU = projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible');

let worker: ReturnType<typeof heldWorker>;

beforeEach(() => {
  worker = heldWorker();
  vi.stubGlobal('fetch', worker.fetch);
  forgetCsrfToken();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

async function answerWhenSent(method: string, url: string, body: unknown) {
  await vi.waitFor(() => expect(worker.waiting()).toContain(`${method} ${url}`));
  await worker.answer(method, url, body);
}

const topHeadings = () => screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent);

describe('#154: each page names itself', () => {
  test('#154: signed out, the one top heading is "Your projects"', async () => {
    render(<App />);
    await answerWhenSent('GET', '/api/situation', { account: null, host, portfolio: null, configured: true });
    expect(topHeadings()).toEqual(['Your projects']);
  });

  test('#154: the portfolio\'s one top heading is "Your projects"; a project\'s page has only its own title', async () => {
    render(<App />);
    await answerWhenSent('GET', '/api/situation', { account, host, portfolio: null, configured: true });
    await answerWhenSent('GET', '/api/portfolio?show=supported', { organizations: [{ name: 'bahtraku', projects: [PENDAU] }], freshness, analysis: { complete: 1, pending: 0 } });
    expect(topHeadings()).toEqual(['Your projects']);

    window.location.hash = '#/bahtraku/Perjanjian-Baru-Pendau';
    await vi.waitFor(() => expect(topHeadings()).toEqual([PENDAU.title]));
    expect(screen.queryByRole('heading', { name: 'Your projects' })).toBeNull();
  });

  test('#154: creating a project, the release stepper, and a release by its tag each have their own one top heading', async () => {
    render(<App />);
    await answerWhenSent('GET', '/api/situation', { account, host, portfolio: null, configured: true });
    await answerWhenSent('GET', '/api/portfolio?show=supported', { organizations: [{ name: 'bahtraku', projects: [PENDAU] }], freshness, analysis: { complete: 1, pending: 0 } });
    for (const [hash, title] of [
      ['#/new', 'Create a project'],
      ['#/bahtraku/Perjanjian-Baru-Pendau/release', `Release ${PENDAU.title}`],
      ['#/bahtraku/Perjanjian-Baru-Pendau/releases/v1.2', `Release v1.2 of ${PENDAU.title}`],
    ] as const) {
      window.location.hash = hash;
      await vi.waitFor(() => expect(topHeadings()).toEqual([title]));
    }
  });

  test('#154: importing and adding books each have their own one top heading, with the project\'s name', () => {
    render(<ImportScreen project={PENDAU} type="bible" onImported={() => {}} onCancel={() => {}} onFailure={() => {}} />);
    expect(topHeadings()).toEqual([`Import books · ${PENDAU.title}`]);
    cleanup();
    render(<UploadScreen project={PENDAU} type="bible" onUploaded={() => {}} onCancel={() => {}} onFailure={() => {}} />);
    expect(topHeadings()).toEqual([`Add books · ${PENDAU.title}`]);
  });

  test('#161: the creation review keeps "Create a project" as its top heading; the receipt\'s "Project created" is a status, and the project\'s title the first heading', async () => {
    render(<CreateProject account="tc-admin-qa" onCreated={() => {}} onFailure={() => {}} />);
    await answerWhenSent('GET', '/api/owners/writable', { owners: [{ login: 'tc-admin-qa-org', name: 'tC Admin QA', kind: 'organization' }], freshness });
    const languages = await vi.waitFor(() => {
      const waiting = worker.waiting().find(request => request.startsWith('GET /api/languages'));
      expect(waiting).toBeTruthy();
      return waiting!.slice('GET '.length);
    });
    await worker.answer('GET', languages, { languages: [{ code: 'id', title: 'Bahasa Indonesia', english: 'Indonesian', direction: 'ltr', alternates: [], tag_accepted: true }], owner_languages: null, freshness });
    fireEvent.click(document.querySelector('input[name=owner][value="tc-admin-qa-org"]')!);
    fireEvent.click(document.querySelector('input[name=project_type][value=bible]')!);
    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Alkitab Percobaan' } });
    fireEvent.change(screen.getByLabelText('Abbreviation'), { target: { value: 'tcap' } });
    fireEvent.change(screen.getByLabelText(/Search by name or tag/), { target: { value: 'Bahasa' } });
    fireEvent.click(await screen.findByRole('button', { name: /Bahasa Indonesia/ }));
    fireEvent.click(document.querySelector('input[name=testament_scope][value=nt]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Review before creating' }));
    const plan = OPERATIONS['project.create.plan'].output.parse({
      id: 'plan-1', operation: 'project.create.plan', created_at: '2026-10-09T12:00:00.000Z', expires_at: '2026-10-09T12:30:00.000Z',
      bound_to: { default_branch_sha: null, release_tag: null, release_tag_sha: null },
      preview: { repo_name: 'id_tcap', metadata_json: {}, files: [{ path: 'metadata.json', size: 2, md5: '0'.repeat(32) }] },
      would_write: [{ kind: 'repo', target: 'tc-admin-qa-org/id_tcap' }], warnings: [],
    });
    await answerWhenSent('POST', '/api/projects/plan', plan);
    expect(topHeadings()).toEqual(['Create a project']);
    expect(screen.getByRole('heading', { level: 2, name: 'Review before creating' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create the project' }));
    await answerWhenSent('POST', '/api/projects', {
      operation: 'project.create.apply', request_id: 'r1', plan_id: 'plan-1', started_at: '2026-10-09T12:00:00.000Z', finished_at: '2026-10-09T12:00:01.000Z',
      wrote: [{ kind: 'repo', target: 'tc-admin-qa-org/id_tcap', url: 'https://qa.door43.org/tc-admin-qa-org/id_tcap' }],
      result: {
        ...projectOf('tc-admin-qa-org', 'id_tcap', 'bible'), title: 'Alkitab Percobaan',
        coverage: { present: 0, target: 27, scope: 'nt', basis: 'archive', units: [] },
        health: { state: 'never_checked', severity_raw: null, ref: 'master', checked_at: null, issue_count: null, issues: null, source: 'door43' },
        latest_full_release: null, default_branch_head: null, active_preparation: null, setup: { state: 'complete', failed_step: null }, freshness,
      },
      warnings: [],
    });
    expect(screen.queryByRole('heading', { name: 'Project created' })).toBeNull();
    expect(screen.getAllByRole('status').some(status => status.textContent === 'Project created')).toBe(true);
    expect(screen.getAllByRole('heading')[0]!.textContent).toBe('Alkitab Percobaan');
  });
});
