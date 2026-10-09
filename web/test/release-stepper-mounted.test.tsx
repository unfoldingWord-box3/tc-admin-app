// @vitest-environment jsdom
// The release stepper mounted (#125): the answers of `release.plan`,
// `preparation.list`, and `preparation.read` are released in each order they
// can arrive, and the stepper must keep the preparation the manager chose to
// continue, its address, and the one click on "Prepare the snapshot". A
// project change mounts a fresh stepper, so no offer of the last project is
// discarded under the next one's name.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ReleaseStepper, writtenLabel } from '../src/ReleaseStepper';
import { freshness, heldWorker, planOf, preparationOf, projectOf, receiptOf } from './support/mounted';
import { errorOf } from './support/upload';

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

describe('a refused version (#161, found in the demo walkthrough)', () => {
  /** Opens the stepper at a preparation ready for release, at the step that creates the release. */
  async function atRelease() {
    window.history.replaceState(null, '', '#/tc-admin-qa-org/id_obs1948/release/v1.1.0');
    render(<ReleaseStepper project={project} preparationId="v1.1.0" onFailure={() => {}} />);
    const ready = preparationOf('tc-admin-qa-org', 'id_obs1948', 'v1.1.0', 'ready_for_release');
    for (const [method, url, body] of [
      ['GET', `${base}/preparations/v1.1.0`, ready],
      ['GET', `${base}/preparations`, { preparations: [ready], freshness }],
      ['POST', `${base}/releases/plan`, planOf('p1')],
    ] as const) {
      if (worker.waiting().includes(`${method} ${url}`)) await worker.answer(method, url, body);
    }
    await vi.waitFor(() => expect(screen.getByLabelText('Version:')).toBeTruthy());
    return screen.getByLabelText('Version:') as HTMLInputElement;
  }
  const createUrl = `${base}/preparations/v1.1.0/release`;
  const create = () => fireEvent.click(screen.getByRole('button', { name: /^Create the (pre-)?release$/ }));

  test('R9, #161: Door43\'s refusal of the version goes when the version is changed, with nothing sent', async () => {
    const version = await atRelease();
    fireEvent.change(version, { target: { value: 'v1.0.0' } });
    create();
    await vi.waitFor(() => expect(worker.waiting()).toContain(`POST ${createUrl}`));
    await worker.answer('POST', createUrl, errorOf('invalid_version', {}, 'Version must be valid and greater than v1.0.9.'), 400);
    expect(screen.getByRole('alert').textContent).toBe('Version must be valid and greater than v1.0.9.');
    const sent = worker.sent.length;
    fireEvent.change(version, { target: { value: 'v1.1.0' } });
    expect(screen.queryByText('Version must be valid and greater than v1.0.9.')).toBeNull();
    expect(worker.sent.length).toBe(sent);
  });

  test('#161: another refusal stays when the version is changed', async () => {
    const version = await atRelease();
    create();
    await vi.waitFor(() => expect(worker.waiting()).toContain(`POST ${createUrl}`));
    await worker.answer('POST', createUrl, errorOf('release_failed', {}, 'Release creation failed: Door43 answered 500.'), 502);
    await vi.waitFor(() => expect(screen.getByText('Release creation failed: Door43 answered 500.')).toBeTruthy());
    fireEvent.change(version, { target: { value: 'v1.1.1' } });
    expect(screen.getByText('Release creation failed: Door43 answered 500.')).toBeTruthy();
  });
});

describe('what the stepper says it wrote (#161)', () => {
  test('#161: a commit is named by its hash; a branch, a tag, and a release by their targets', () => {
    expect(writtenLabel({ kind: 'commit', target: 'o/r@temp-tca-release/v1.1.1', sha: '9102a6cd81aa' })).toBe('Commit 9102a6cd');
    expect(writtenLabel({ kind: 'branch', target: 'o/r@temp-tca-release/v1.1.1' })).toBe('Branch o/r@temp-tca-release/v1.1.1');
    expect(writtenLabel({ kind: 'release', target: 'v1.1.1' })).toBe('Release v1.1.1');
  });

  test('R8, #161: promoting the pre-release lists the promotion beside what the release wrote', async () => {
    window.history.replaceState(null, '', '#/tc-admin-qa-org/id_obs1948/release/v1.1.0');
    render(<ReleaseStepper project={project} preparationId="v1.1.0" onFailure={() => {}} />);
    const pre = { ...preparationOf('tc-admin-qa-org', 'id_obs1948', 'v1.1.0', 'pre_release'), release: { tag: 'v1.1.0', sha: 'c'.repeat(40), prerelease: true, url: 'https://qa.door43.org/tc-admin-qa-org/id_obs1948/releases/tag/v1.1.0' } };
    for (const [method, url, body] of [
      ['GET', `${base}/preparations/v1.1.0`, pre],
      ['GET', `${base}/preparations`, { preparations: [pre], freshness }],
      ['POST', `${base}/releases/plan`, planOf('p1')],
    ] as const) {
      if (worker.waiting().includes(`${method} ${url}`)) await worker.answer(method, url, body);
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Promote to a full release' }));
    await vi.waitFor(() => expect(worker.waiting()).toContain(`POST ${base}/releases/v1.1.0/promote`));
    await worker.answer('POST', `${base}/releases/v1.1.0/promote`, {
      operation: 'release.promote', request_id: 'r1', plan_id: null, started_at: freshness.read_at, finished_at: freshness.read_at,
      wrote: [{ kind: 'release', target: 'v1.1.0' }], result: { ...pre.release, prerelease: false }, warnings: [],
    });
    await vi.waitFor(() => expect(screen.getByText(/Written: .*Release v1\.1\.0, promoted to a full release/)).toBeTruthy());
  });
});
