// @vitest-environment jsdom
// The portfolio mounted (#14): a project the Worker refuses for permission
// from an open view leaves the list at once, its address says why, and the
// other projects stay (A2).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetCsrfToken } from '../src/api/client';
import { Portfolio } from '../src/Portfolio';
import { errorOf } from './support/upload';
import { freshness, heldWorker, projectOf } from './support/mounted';

const LOST = projectOf('bahtraku', 'id_tb1', 'bible');
const KEPT = projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible');
const portfolio = { organizations: [{ name: 'bahtraku', projects: [LOST, KEPT] }], freshness, analysis: { complete: 2, pending: 0 } };

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

describe('A2: a project the manager lost write access to leaves the portfolio', () => {
  test('A2: permission_denied from an open project\'s read drops it from the list and says why at its address; the other project stays', async () => {
    window.location.hash = '#/bahtraku/id_tb1';
    render(<Portfolio account={{ login: 'tc-admin-qa', name: 'tC Admin QA' }} onFailure={() => {}} />);
    await answerWhenSent('GET', '/api/portfolio?show=supported', portfolio);
    // The project view opened, and its preparations read is refused: the push right is gone.
    expect(screen.getByRole('heading', { name: 'bahtraku/id_tb1' })).toBeTruthy();
    await answerWhenSent('GET', '/api/projects/bahtraku/id_tb1/preparations', errorOf('permission_denied', { owner: 'bahtraku', repo: 'id_tb1' }), 403);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('You no longer have write access to this project.');
    expect(alert.textContent).toContain('bahtraku/id_tb1 is no longer listed, and nothing was written.');
    expect(screen.queryByRole('heading', { name: 'bahtraku/id_tb1' })).toBeNull();
    expect(screen.queryByRole('link', { name: /bahtraku\/id_tb1/ })).toBeNull();
    expect(screen.getByText('bahtraku/Perjanjian-Baru-Pendau')).toBeTruthy();
  });
});
