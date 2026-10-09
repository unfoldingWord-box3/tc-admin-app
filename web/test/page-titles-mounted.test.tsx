// @vitest-environment jsdom
// Each page names itself (#154): the portfolio's one top heading is "Your
// projects", and every other page (a project, creating one, the release
// stepper, a release by its tag, importing, adding books) has its own title as
// its one top heading, not "Your projects" above it. Signed out, the page still says "Your
// projects" (the sign-in test waits on it, e2e/sign-in.spec.ts).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetCsrfToken } from '../src/api/client';
import { App } from '../src/App';
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
});
