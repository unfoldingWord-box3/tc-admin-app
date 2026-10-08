// @vitest-environment jsdom
// The release stepper mounted (#125): the answers of `release.plan`,
// `preparation.list`, and `preparation.read` are released in each order they
// can arrive, and the stepper must keep the preparation the manager chose to
// continue, its address, and the one click on "Prepare the snapshot". A
// project change mounts a fresh stepper, so no offer of the last project is
// discarded under the next one's name.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ReleaseStepper } from '../src/ReleaseStepper';
import { freshness, heldWorker, planOf, preparationOf, projectOf, receiptOf } from './support/mounted';

const project = projectOf('tc-admin-qa-org', 'id_obs1948');
const base = '/api/projects/tc-admin-qa-org/id_obs1948';
const listed = { preparations: [preparationOf('tc-admin-qa-org', 'id_obs1948', 'v1.1.0', 'health_blocked')], freshness };

let worker: ReturnType<typeof heldWorker>;

beforeEach(() => {
  worker = heldWorker();
  vi.stubGlobal('fetch', worker.fetch);
  window.history.replaceState(null, '', '#/tc-admin-qa-org/id_obs1948/release');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const continueButton = () => screen.getByRole('button', { name: 'Continue the preparation' });

describe('continuing a listed preparation while the plan is still being read (Frank, round 2)', () => {
  // Each order the three answers can arrive in, Continue clicked as soon as the list offers the preparation.
  const orders: { name: string; steps: ('list' | 'plan' | 'continue' | 'read')[] }[] = [
    { name: 'the list, Continue, the plan, then the read', steps: ['list', 'continue', 'plan', 'read'] },
    { name: 'the list, Continue, the read, then the plan', steps: ['list', 'continue', 'read', 'plan'] },
    { name: 'the plan, the list, Continue, then the read', steps: ['plan', 'list', 'continue', 'read'] },
  ];

  for (const order of orders) {
    test(`R7: ${order.name}: the preparation stays open and the address names it`, async () => {
      render(<ReleaseStepper project={project} onFailure={() => {}} />);
      for (const step of order.steps) {
        if (step === 'list') await worker.answer('GET', `${base}/preparations`, listed);
        if (step === 'plan') await worker.answer('POST', `${base}/releases/plan`, planOf('p1'));
        if (step === 'continue') fireEvent.click(continueButton());
        if (step === 'read') await worker.answer('GET', `${base}/preparations/v1.1.0`, preparationOf('tc-admin-qa-org', 'id_obs1948', 'v1.1.0', 'health_blocked'));
      }
      expect(screen.getByText(/Health check blocks the release · version v1\.1\.0/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Prepare the snapshot' })).toBeNull();
      expect(window.location.hash).toBe('#/tc-admin-qa-org/id_obs1948/release/v1.1.0');
      expect(worker.waiting()).toEqual([]);
    });
  }
});

describe('one click on "Prepare the snapshot" (E66: a first click that sent nothing)', () => {
  const orders: { name: string; steps: ('list' | 'plan' | 'prepare')[] }[] = [
    { name: 'the list, the plan, then the click', steps: ['list', 'plan', 'prepare'] },
    { name: 'the plan, the click, then the list', steps: ['plan', 'prepare', 'list'] },
    { name: 'the plan, the list, then the click', steps: ['plan', 'list', 'prepare'] },
  ];

  for (const order of orders) {
    test(`R5: ${order.name}: the click right after the plan's answer sends one release.prepare, with that plan`, async () => {
      render(<ReleaseStepper project={project} onFailure={() => {}} />);
      for (const step of order.steps) {
        if (step === 'list') await worker.answer('GET', `${base}/preparations`, { preparations: [], freshness });
        if (step === 'plan') await worker.answer('POST', `${base}/releases/plan`, planOf('p1'));
        if (step === 'prepare') fireEvent.click(screen.getByRole('button', { name: 'Prepare the snapshot' }));
      }
      const prepares = worker.sent.filter(request => request.method === 'POST' && request.url === `${base}/preparations`);
      expect(prepares).toHaveLength(1);
      expect(prepares[0]!.body).toMatchObject({ plan_id: 'p1' });
      await worker.answer('POST', `${base}/preparations`, receiptOf('release.prepare', preparationOf('tc-admin-qa-org', 'id_obs1948', 'v1.0.1', 'health_blocked'), 'p1'));
      expect(window.location.hash).toBe('#/tc-admin-qa-org/id_obs1948/release/v1.0.1');
    });
  }
});

describe('another project mounts a fresh stepper (George, round 1 #1)', () => {
  test('R7: a preparation offered for one project is never discarded under another project\'s name, and the next shows no discard until its own list', async () => {
    const other = projectOf('tc-admin-qa', 'id_tcar1546');
    const otherBase = '/api/projects/tc-admin-qa/id_tcar1546';
    const view = render(<ReleaseStepper project={project} onFailure={() => {}} />);
    await worker.answer('GET', `${base}/preparations`, listed);
    fireEvent.click(screen.getByRole('button', { name: 'Discard the preparation' }));
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();

    view.rerender(<ReleaseStepper project={other} onFailure={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Discard the preparation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep it' })).toBeNull();
    expect(screen.queryByText(/version v1\.1\.0/)).toBeNull();

    // The same version id on the other project (E66), offered only once its own list has answered, and not already confirming.
    await worker.answer('GET', `${otherBase}/preparations`, { preparations: [preparationOf('tc-admin-qa', 'id_tcar1546', 'v1.1.0', 'health_blocked'), preparationOf('tc-admin-qa', 'id_tcar1546', 'v2.0.0', 'ready_for_release')], freshness });
    expect(screen.queryByRole('button', { name: 'Keep it' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard the preparation' })[1]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard the preparation' }).find(button => !button.classList.contains('secondary'))!);
    const discards = worker.sent.filter(request => request.url.endsWith('/discard'));
    expect(discards.map(request => request.url)).toEqual([`${otherBase}/preparations/v2.0.0/discard`]);
  });
});
