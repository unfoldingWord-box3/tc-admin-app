// @vitest-environment jsdom
// The project view mounted (#125): its release preparations belong to the
// project it shows. When the project changes, the last project's rows, its
// confirmation, and its discard go in the same render, and the next project
// offers a discard only once its own `preparation.list` has answered.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProjectView } from '../src/ProjectView';
import { freshness, heldWorker, preparationOf, projectOf, receiptOf } from './support/mounted';

let worker: ReturnType<typeof heldWorker>;

beforeEach(() => {
  worker = heldWorker();
  vi.stubGlobal('fetch', worker.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const discardButtons = () => screen.queryAllByRole('button', { name: 'Discard the preparation' });

describe('switching from one project to another (George, round 1 #1)', () => {
  test('R7: #/a/r1 to #/b/r2 never sends preparation.discard for b/r2 with r1\'s preparation, and b/r2 shows no discard until its list has answered', async () => {
    const a = projectOf('tc-admin-qa-org', 'id_obs1948');
    const b = projectOf('tc-admin-qa', 'id_tcar1546');
    const view = render(<ProjectView project={a} onFailure={() => {}} />);
    await worker.answer('GET', '/api/projects/tc-admin-qa-org/id_obs1948/preparations', { preparations: [preparationOf('tc-admin-qa-org', 'id_obs1948', 'v1.0.9', 'health_blocked')], freshness });
    fireEvent.click(discardButtons()[0]!);
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();

    view.rerender(<ProjectView project={b} onFailure={() => {}} />);
    expect(discardButtons()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Keep it' })).toBeNull();
    expect(screen.queryByText(/Version v1\.0\.9/)).toBeNull();
    expect(screen.getByText('Reading the release preparations…')).toBeTruthy();

    await worker.answer('GET', '/api/projects/tc-admin-qa/id_tcar1546/preparations', { preparations: [preparationOf('tc-admin-qa', 'id_tcar1546', 'v2.0.0', 'ready_for_release')], freshness });
    expect(screen.queryByRole('button', { name: 'Keep it' })).toBeNull();
    fireEvent.click(discardButtons()[0]!);
    fireEvent.click(discardButtons()[0]!);
    const discards = worker.sent.filter(request => request.url.endsWith('/discard'));
    expect(discards.map(request => `${request.method} ${request.url}`)).toEqual(['POST /api/projects/tc-admin-qa/id_tcar1546/preparations/v2.0.0/discard']);
    expect(worker.sent.some(request => request.url.includes('v1.0.9') && request.url.includes('id_tcar1546'))).toBe(false);
  });

  test('R7: a version id both projects use (E66) does not carry the confirmation across, and a late answer of the last project is not shown', async () => {
    const a = projectOf('tc-admin-qa-org', 'id_obs1948');
    const b = projectOf('tc-admin-qa', 'id_tcar1546');
    const view = render(<ProjectView project={a} onFailure={() => {}} />);
    await worker.answer('GET', '/api/projects/tc-admin-qa-org/id_obs1948/preparations', { preparations: [preparationOf('tc-admin-qa-org', 'id_obs1948', 'v1.1.0', 'health_blocked')], freshness });
    fireEvent.click(discardButtons()[0]!);
    // The discard a confirmed on a, still under way when the project changes, stays a's.
    fireEvent.click(discardButtons()[0]!);

    view.rerender(<ProjectView project={b} onFailure={() => {}} />);
    await worker.answer('GET', '/api/projects/tc-admin-qa/id_tcar1546/preparations', { preparations: [preparationOf('tc-admin-qa', 'id_tcar1546', 'v1.1.0', 'health_blocked')], freshness });
    expect(screen.queryByRole('button', { name: 'Keep it' })).toBeNull();
    expect(discardButtons()).toHaveLength(1);
    expect((discardButtons()[0] as HTMLButtonElement).disabled).toBe(false);

    await worker.answer('POST', '/api/projects/tc-admin-qa-org/id_obs1948/preparations/v1.1.0/discard', receiptOf('preparation.discard', preparationOf('tc-admin-qa-org', 'id_obs1948', 'v1.1.0', 'discarded')));
    expect(screen.getByText(/Version v1\.1\.0 · Health check blocks the release/)).toBeTruthy();
    expect(worker.sent.filter(request => request.url.endsWith('/discard')).map(request => request.url)).toEqual(['/api/projects/tc-admin-qa-org/id_obs1948/preparations/v1.1.0/discard']);
  });
});
