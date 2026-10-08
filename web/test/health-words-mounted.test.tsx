// @vitest-environment jsdom
// H4 mounted (#8): in the portfolio, every health state a project can be in is
// shown in words beside whatever color it carries, and an unsupported project
// shows its editability in words with its reason.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HEALTH_STATES, ProjectSummary } from '@tc-admin/shared/schema';
import { forgetCsrfToken } from '../src/api/client';
import { Portfolio } from '../src/Portfolio';
import { HEALTH_LABELS } from '../src/portfolio-labels';
import { freshness, heldWorker, projectOf } from './support/mounted';

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
});

describe('H4: health in words', () => {
  test('H4: a project in each health state shows that state\'s words in its row', async () => {
    const projects = HEALTH_STATES.map(state => {
      const project = projectOf('bahtraku', `repo_${state}`, 'bible');
      return ProjectSummary.parse({ ...project, title: `Project ${state}`, health: { ...project.health, state } });
    });
    render(<Portfolio account={{ login: 'tc-admin-qa', name: 'tC Admin QA' }} onFailure={() => {}} />);
    await vi.waitFor(() => expect(worker.waiting()).toContain('GET /api/portfolio?show=supported'));
    await worker.answer('GET', '/api/portfolio?show=supported', { organizations: [{ name: 'bahtraku', projects }], freshness, analysis: { complete: projects.length, pending: 0 } });
    for (const state of HEALTH_STATES) {
      const row = screen.getByText(`Project ${state}`).closest('li')!;
      expect(within(row).getByText(`Health: ${HEALTH_LABELS[state]}`)).toBeTruthy();
    }
  });

  test('H4, P1: an unsupported project says so in words, with its reason', async () => {
    const project = ProjectSummary.parse({ ...projectOf('bahtraku', 'id_tb1', 'bible'), metadata_format: 'rc', editability: { state: 'unsupported', reason: 'Resource Container project. Import it into a new project to manage it here.' } });
    render(<Portfolio account={{ login: 'tc-admin-qa', name: 'tC Admin QA' }} onFailure={() => {}} />);
    await vi.waitFor(() => expect(worker.waiting()).toContain('GET /api/portfolio?show=supported'));
    await worker.answer('GET', '/api/portfolio?show=supported', { organizations: [{ name: 'bahtraku', projects: [project] }], freshness, analysis: { complete: 1, pending: 0 } });
    const row = screen.getByText('id_tb1').closest('li')!;
    expect(within(row).getByText('Unsupported')).toBeTruthy();
    expect(row.textContent).toContain('Resource Container project. Import it into a new project to manage it here.');
  });
});
