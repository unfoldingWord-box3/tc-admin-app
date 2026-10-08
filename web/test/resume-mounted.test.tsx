// @vitest-environment jsdom
// Coming back after a sign-in, mounted (#15): the sign-in link remembers the
// address, the app restores it once the same account is signed in, and an open
// preparation is read again by its id (`preparation.read`); the wizard comes
// back with the form it had.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetCsrfToken } from '../src/api/client';
import { App } from '../src/App';
import { CreateProject } from '../src/CreateProject';
import { newForm } from '../src/create-project';
import { rememberReturn, saveDraft, takeReturn } from '../src/resume';
import { freshness, heldWorker, projectOf } from './support/mounted';

const host = { origin: 'https://qa.door43.org', name: 'QA', development: true };
const situation = (account: { login: string; name: string } | null) => ({ account, host, portfolio: null, configured: true });
const PENDAU = projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible');
const PREPARATION = '#/bahtraku/Perjanjian-Baru-Pendau/release/v1.3.0';

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
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function answerWhenSent(method: string, url: string, body: unknown, status = 200) {
  await vi.waitFor(() => expect(worker.waiting()).toContain(`${method} ${url}`));
  await worker.answer(method, url, body, status);
}

describe('#15: the address survives a sign-in', () => {
  test('A1, #15: the sign-in link remembers an open preparation\'s address; after the sign-in the app opens it again and reads the preparation by its id', async () => {
    window.history.replaceState(null, '', `/${PREPARATION}`);
    render(<App />);
    await answerWhenSent('GET', '/api/situation', situation(null));
    // Following the link leaves the page (jsdom does not navigate); what matters is what it remembered.
    const link = screen.getByRole('link', { name: 'Sign in with Door43 QA' });
    link.addEventListener('click', event => event.preventDefault());
    fireEvent.click(link);
    cleanup();

    // Door43's sign-in returns to `/`.
    window.history.replaceState(null, '', '/');
    render(<App />);
    await answerWhenSent('GET', '/api/situation', situation({ login: 'tc-admin-qa', name: 'tC Admin QA' }));
    expect(window.location.hash).toBe(PREPARATION);
    await answerWhenSent('GET', '/api/portfolio?show=supported', { organizations: [{ name: 'bahtraku', projects: [PENDAU] }], freshness, analysis: { complete: 1, pending: 0 } });
    await vi.waitFor(() => expect(worker.waiting()).toContain('GET /api/projects/bahtraku/Perjanjian-Baru-Pendau/preparations/v1.3.0'));
  });

  test('an address already in the bar after the sign-in is kept; the remembered one is not forced over it', async () => {
    rememberReturn(PREPARATION, 'tc-admin-qa');
    window.history.replaceState(null, '', '/#/bahtraku/id_tb1');
    render(<App />);
    await answerWhenSent('GET', '/api/situation', situation({ login: 'tc-admin-qa', name: 'tC Admin QA' }));
    expect(window.location.hash).toBe('#/bahtraku/id_tb1');
  });

  test('#15: a return to the wizard not applied over an address in the bar does not offer its form to a later opening', async () => {
    saveDraft({ ...newForm('tc-admin-qa-org'), title: 'Alkitab Pendau' }, 'tc-admin-qa');
    rememberReturn('#/new', 'tc-admin-qa');
    window.history.replaceState(null, '', '/#/bahtraku/id_tb1');
    render(<App />);
    await answerWhenSent('GET', '/api/situation', situation({ login: 'tc-admin-qa', name: 'tC Admin QA' }));
    expect(window.location.hash).toBe('#/bahtraku/id_tb1');
    cleanup();
    render(<CreateProject account="tc-admin-qa" onCreated={() => {}} onFailure={() => {}} />);
    expect((screen.getByLabelText('Project title') as HTMLInputElement).value).toBe('');
  });
});

describe('#15: the wizard\'s form survives a sign-in', () => {
  test('#15: account A\'s form is never shown to account B, whose own return lands on the wizard in the same tab (bench round 2)', async () => {
    // A filled the wizard and left; B opened the wizard, and B's session expired before it mounted; B signs in again.
    saveDraft({ ...newForm('tc-admin-qa-org'), title: 'A form of another account' }, 'birch');
    rememberReturn('#/new', 'tc-admin-qa');
    expect(takeReturn('tc-admin-qa')).toBe('#/new');
    render(<CreateProject account="tc-admin-qa" onCreated={() => {}} onFailure={() => {}} />);
    expect((screen.getByLabelText('Project title') as HTMLInputElement).value).toBe('');
  });

  test('#15: signing out forgets the kept form', async () => {
    saveDraft({ ...newForm('tc-admin-qa-org'), title: 'Alkitab Pendau' }, 'tc-admin-qa');
    render(<App />);
    await answerWhenSent('GET', '/api/situation', situation({ login: 'tc-admin-qa', name: 'tC Admin QA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(window.sessionStorage.getItem('tca:wizard-draft')).toBeNull();
  });

  test('#15: returning to the wizard as the same account restores the title, abbreviation, and scope; a later opening starts afresh', async () => {
    saveDraft({ ...newForm('tc-admin-qa-org'), title: 'Alkitab Pendau', abbreviation: 'APD', testament_scope: 'nt' }, 'tc-admin-qa');
    rememberReturn('#/new', 'tc-admin-qa');
    expect(takeReturn('tc-admin-qa')).toBe('#/new');
    render(<CreateProject account="tc-admin-qa" onCreated={() => {}} onFailure={() => {}} />);
    expect((screen.getByLabelText('Project title') as HTMLInputElement).value).toBe('Alkitab Pendau');
    expect((screen.getByLabelText('Abbreviation') as HTMLInputElement).value).toBe('APD');
    expect(document.querySelector<HTMLInputElement>('input[name="testament_scope"][value="nt"]')?.checked).toBe(true);
    cleanup();

    render(<CreateProject account="tc-admin-qa" onCreated={() => {}} onFailure={() => {}} />);
    expect((screen.getByLabelText('Project title') as HTMLInputElement).value).toBe('');
  });
});
