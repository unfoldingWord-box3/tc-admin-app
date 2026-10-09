// @vitest-environment jsdom
// The import screen mounted (#81): the owner picker lists the account's
// organizations before anything is typed and searches the catalog as the
// manager types; each source shows its format and whether it was released,
// one of the other type cannot be picked; a source Door43 does not itemize
// imports all; nothing is sent to `import.apply` until the plan's summary is
// confirmed, and then once (W5, X1); a refusal is shown in place by code with
// the catalog's message (X2).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetCsrfToken } from '../src/api/client';
import { ImportScreen } from '../src/ImportScreen';
import { ProjectView } from '../src/ProjectView';
import { errorOf } from './support/upload';
import { book, importPlanOf, importReceiptOf, ownersOf, sourceOf, sourcesOf } from './support/import';
import { heldWorker, projectOf } from './support/mounted';

const project = projectOf('tc-admin-qa', 'id_tcai1633', 'bible');
const base = '/api/projects/tc-admin-qa/id_tcai1633';
const planUrl = `${base}/imports/plan`;
const applyUrl = `${base}/imports`;
const ownersUrl = '/api/owners';
const sourcesUrl = (owner: string, stage: string) => `/api/sources?owner=${owner}&stage=${stage}`;

let worker: ReturnType<typeof heldWorker>;

beforeEach(() => {
  worker = heldWorker();
  vi.stubGlobal('fetch', worker.fetch);
  forgetCsrfToken();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const plans = () => worker.sent.filter(request => request.url === planUrl);
const applies = () => worker.sent.filter(request => request.url === applyUrl);
const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;
/** Chooses a source: each listed repository is one radio choice, its whole row the label (#151). */
const pick = (name: RegExp) => fireEvent.click(screen.getByRole('radio', { name }));
const mount = () => render(<ImportScreen project={project} type="bible" onImported={() => {}} onCancel={() => {}} />);
/** Waits for a request to be sent, then answers it. */
async function answerWhenSent(method: string, url: string, body: unknown, status = 200) {
  await vi.waitFor(() => expect(worker.waiting()).toContain(`${method} ${url}`));
  await worker.answer(method, url, body, status);
}

const OWN = [{ login: 'tc-admin-qa-org', name: 'tC Admin QA' }];
/** id_tb1 as the latest content offers it (its default branch), and as the last release does (its tag `1974`). */
const TB1 = sourceOf('bahtraku', 'id_tb1', { title: 'Alkitab Terjemahan Baru', stage: 'latest', format: 'rc' });
const TB1_RELEASE = sourceOf('bahtraku', 'id_tb1', { title: 'Alkitab Terjemahan Baru', stage: 'prod', format: 'rc' });

/** Mounts, answers the owner search, types an owner, and picks it; answers its sources at the latest content. */
async function toSources(sources = [TB1]) {
  mount();
  await answerWhenSent('GET', ownersUrl, ownersOf(OWN));
  fireEvent.change(screen.getByLabelText(/Search owners by name/), { target: { value: 'bah' } });
  await answerWhenSent('GET', `${ownersUrl}?q=bah`, ownersOf(OWN, [{ login: 'bahtraku', name: 'Yayasan BahtraKu' }]));
  fireEvent.click(button('Yayasan BahtraKu (bahtraku)'));
  await worker.answer('GET', sourcesUrl('bahtraku', 'latest'), sourcesOf(sources));
}

describe('finding the source', () => {
  test('the owner picker lists the account\'s organizations before typing, searches the catalog as the manager types, and reads the chosen owner\'s sources', async () => {
    await toSources();
    expect(worker.sent.map(request => request.url)).toEqual([ownersUrl, `${ownersUrl}?q=bah`, sourcesUrl('bahtraku', 'latest')]);
    expect(screen.getByText('Yayasan BahtraKu (bahtraku)')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Repositories' });
    // Read aloud as two phrases: the title with its language code, then the repository and its facts.
    expect(within(list).getByRole('radio', { name: /^Alkitab Terjemahan Baru \(id\),\s?bahtraku\/id_tb1 · Resource Container · Released · branch master$/ })).toBeTruthy();
    // #151: the title with its language code, then `owner/repo` as code and the facts but the type, which every listed source shares.
    expect(within(list).getByText('bahtraku/id_tb1').tagName).toBe('CODE');
    expect(list.textContent).toContain('bahtraku/id_tb1 · Resource Container · Released · branch master');
    expect(screen.getByRole('group', { name: 'Bible projects' })).toBeTruthy();
  });

  test('before typing, the organizations are offered under their own heading', async () => {
    mount();
    await answerWhenSent('GET', ownersUrl, ownersOf(OWN));
    expect(screen.getByRole('list', { name: 'Your organizations' }).textContent).toContain('tC Admin QA (tc-admin-qa-org)');
    expect(screen.queryByRole('list', { name: 'Matching owners' })).toBeNull();
  });

  test('"Last release" retires the list, the source, and a plan in flight at once, and reads the sources again at that stage; the other stage\'s list is never shown or planned', async () => {
    await toSources();
    pick(/Alkitab Terjemahan Baru/);
    fireEvent.click(button('Plan the import of 3 books'));
    expect(plans()).toHaveLength(1);
    expect(plans()[0]!.body).toMatchObject({ source: { revision: 'master' } });
    // Switched while the plan is in flight: the list is gone before the new one is read, and nothing can be picked.
    fireEvent.click(screen.getByLabelText(/Last release/));
    expect(screen.queryByRole('list', { name: 'Repositories' })).toBeNull();
    // The late answer for the old stage's plan is not shown.
    await worker.answer('POST', planUrl, importPlanOf('stale', [book('gen')], { owner: 'bahtraku', repo: 'id_tb1', revision: 'master' }));
    expect(screen.queryByText('Review before importing')).toBeNull();
    await answerWhenSent('GET', sourcesUrl('bahtraku', 'prod'), sourcesOf([TB1_RELEASE]));
    expect(screen.getByRole('list', { name: 'Repositories' }).textContent).toContain('release 1974');
    pick(/Alkitab Terjemahan Baru/);
    fireEvent.click(button('Plan the import of 3 books'));
    expect(plans()).toHaveLength(2);
    expect(plans()[1]!.body).toMatchObject({ source: { revision: '1974' } });
  });

  test('#151: a source of the other project type is not listed, and nothing is said of it while a source of this type is', async () => {
    await toSources([TB1, sourceOf('bahtraku', 'id_obs', { title: 'Cerita', type: 'obs', books: null })]);
    const list = screen.getByRole('list', { name: 'Repositories' });
    expect(within(list).getAllByRole('radio')).toHaveLength(1);
    expect(screen.queryByText(/Cerita/)).toBeNull();
    expect(screen.queryByText(/cannot be imported/)).toBeNull();
    expect(screen.getByText('1 repository')).toBeTruthy();
    expect(plans()).toEqual([]);
  });

  test('#151: an owner with no source of this type says so, and how many of the other type are not listed', async () => {
    await toSources([sourceOf('bahtraku', 'id_obs', { title: 'Cerita', type: 'obs', books: null }), sourceOf('bahtraku', 'id_obs2', { title: 'Cerita 2', type: 'obs', books: null })]);
    expect(screen.queryByRole('list', { name: 'Repositories' })).toBeNull();
    expect(screen.getByText('bahtraku has no Bible repository at its latest content. 2 Open Bible Stories repositories are not listed, since they cannot be imported here.')).toBeTruthy();
  });

  test('#151: the filter narrows the list by title, language code, or repository name, and keeps the chosen source', async () => {
    const english = { ...sourceOf('bahtraku', 'en_ult', { title: 'Literal Text' }), language: { code: 'en', title: 'English' } };
    await toSources([TB1, sourceOf('bahtraku', 'id_tb2', { title: 'Kitab Kedua' }), english]);
    pick(/Kitab Kedua/);
    const filter = screen.getByLabelText(/Filter repositories/);
    const listed = () => within(screen.getByRole('list', { name: 'Repositories' })).getAllByRole('radio').map(radio => (radio as HTMLInputElement).value);
    fireEvent.change(filter, { target: { value: 'ALKITAB' } });
    expect(listed()).toEqual(['bahtraku/id_tb1']);
    expect(screen.getByText('1 of 3 repositories')).toBeTruthy();
    fireEvent.change(filter, { target: { value: 'en' } });
    expect(listed()).toEqual(['bahtraku/en_ult']);
    fireEvent.change(filter, { target: { value: 'tb2' } });
    expect(listed()).toEqual(['bahtraku/id_tb2']);
    expect((screen.getByRole('radio', { name: /Kitab Kedua/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(filter, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No Bible repository of bahtraku matches "nothing like it".')).toBeTruthy();
    // The source chosen before filtering stays chosen: its books are still offered.
    expect(screen.getByRole('group', { name: /Books of bahtraku\/id_tb2/ })).toBeTruthy();
  });

  test('E35: a source Door43 does not itemize still imports: the plan is asked for all', async () => {
    await toSources([sourceOf('bahtraku', 'id_tb1', { title: 'Alkitab', books: null })]);
    pick(/Alkitab/);
    expect(screen.getByText(/Door43 does not list this repository's books/)).toBeTruthy();
    fireEvent.click(button('Plan the import of all books'));
    expect(plans()[0]!.body).toEqual({ source: { owner: 'bahtraku', repo: 'id_tb1', revision: 'master' }, units: 'all' });
  });
});

describe('plan before apply', () => {
  test('W5, X1: from the project view, nothing is sent to import.apply until the confirmation; then the plan id goes once, and the receipt\'s report replaces the view', async () => {
    render(<ProjectView project={project} onFailure={() => {}} />);
    fireEvent.click(button('Import books'));
    await answerWhenSent('GET', ownersUrl, ownersOf(OWN, [{ login: 'bahtraku', name: 'Yayasan BahtraKu' }]));
    fireEvent.click(button('tC Admin QA (tc-admin-qa-org)'));
    await worker.answer('GET', sourcesUrl('tc-admin-qa-org', 'latest'), sourcesOf([TB1]));
    pick(/Alkitab Terjemahan Baru/);
    // Every offered book is chosen to begin with; Matthew is left out.
    fireEvent.click(screen.getByLabelText('MAT · Matius'));
    fireEvent.click(button('Plan the import of 2 books'));
    expect(plans()).toHaveLength(1);
    expect(plans()[0]!.body).toEqual({ source: { owner: 'bahtraku', repo: 'id_tb1', revision: 'master' }, units: ['gen', 'exo'] });

    await worker.answer('POST', planUrl, importPlanOf('p1', [book('gen'), book('exo', true, '@@ -1 +1 @@\n-old\n+new\n')]));
    expect(screen.getByText('Review before importing')).toBeTruthy();
    expect(screen.getByText(/One commit to tc-admin-qa\/id_tcai1633@master: 1 new book \(GEN\) · 1 book replaced \(EXO\)/)).toBeTruthy();
    expect(screen.getByText('Source recorded in metadata.json: bahtraku/id_tb1 at 1974.')).toBeTruthy();
    const confirm = button(/^Import 2 books$/);
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(applies()).toEqual([]);

    fireEvent.click(screen.getByLabelText(/Replace ingredients\/EXO\.usfm with ingredients\/EXO\.usfm/));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(applies()).toHaveLength(1);
    expect(applies()[0]!.body).toEqual({ plan_id: 'p1' });
    expect(applies()[0]!.headers.get('idempotency-key')).toBe('p1');

    await worker.answer('POST', applyUrl, importReceiptOf('p1'));
    expect(screen.getByRole('status').textContent).toContain('Imported 2 books in one commit.');
    expect(screen.getByRole('heading', { name: 'tC Admin import probe' })).toBeTruthy();
    expect(screen.queryByText('Review before importing')).toBeNull();
  });

  test('a plan\'s id_line_mismatch warning is shown with the plan', async () => {
    await toSources();
    pick(/Alkitab Terjemahan Baru/);
    fireEvent.click(button('Plan the import of 3 books'));
    const plan = importPlanOf('p2', [book('gen')]);
    await worker.answer('POST', planUrl, { ...plan, warnings: [{ code: 'id_line_mismatch', message: 'ingredients/GEN.usfm is imported as GEN, but its \\id line does not name it. The file is committed unchanged.' }] });
    expect(screen.getByRole('list', { name: 'Warnings' }).textContent).toContain('is imported as GEN');
  });

  test('W5, X1: changing the chosen books after planning retires the plan; nothing can be confirmed until import.plan runs again with the new choice', async () => {
    await toSources();
    pick(/Alkitab Terjemahan Baru/);
    fireEvent.click(button('Plan the import of 3 books'));
    await worker.answer('POST', planUrl, importPlanOf('p4', [book('gen'), book('exo'), book('mat')]));
    expect(screen.getByText('Review before importing')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('MAT · Matius'));
    expect(screen.queryByText('Review before importing')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Import \d+ books?$/ })).toBeNull();
    expect(applies()).toEqual([]);
    fireEvent.click(button('Plan the import of 2 books'));
    expect(plans()[1]!.body).toEqual({ source: { owner: 'bahtraku', repo: 'id_tb1', revision: 'master' }, units: ['gen', 'exo'] });
    await worker.answer('POST', planUrl, importPlanOf('p5', [book('gen'), book('exo')]));
    expect(screen.getByText('Review before importing')).toBeTruthy();
    fireEvent.click(button('Choose none'));
    expect(screen.queryByText('Review before importing')).toBeNull();
    expect(applies()).toEqual([]);
  });

  test('W5: a plan answered after the source or its books changed is dropped, not offered for confirmation', async () => {
    await toSources([TB1, sourceOf('bahtraku', 'id_tb2', { title: 'Kitab Kedua' })]);
    pick(/Alkitab Terjemahan Baru/);
    fireEvent.click(button('Plan the import of 3 books'));
    pick(/Kitab Kedua/);
    await worker.answer('POST', planUrl, importPlanOf('p6', [book('gen')]));
    expect(screen.queryByText('Review before importing')).toBeNull();

    fireEvent.click(button('Plan the import of 3 books'));
    fireEvent.click(screen.getByLabelText('MAT · Matius'));
    await worker.answer('POST', planUrl, importPlanOf('p7', [book('gen')]));
    expect(screen.queryByText('Review before importing')).toBeNull();
    expect(button('Plan the import of 2 books').disabled).toBe(false);
    expect(applies()).toEqual([]);
  });
});

describe('refusals shown in place', () => {
  test('X2: not_editable from import.plan shows the project\'s reason and the way back, and plans nothing more', async () => {
    await toSources();
    pick(/Alkitab Terjemahan Baru/);
    fireEvent.click(button('Plan the import of 3 books'));
    await worker.answer('POST', planUrl, errorOf('not_editable', {}, 'Resource Container project. Import it into a new project to manage it here.'), 409);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-code')).toBe('not_editable');
    expect(alert.textContent).toContain('Resource Container project. Import it into a new project to manage it here.');
    expect(within(alert).getByRole('button', { name: 'Back to the project' })).toBeTruthy();
    expect(screen.queryByText('Review before importing')).toBeNull();
  });

  test('X1, X2: an apply the source refused (source_changed in its source wording) is shown with the way forward, and the same plan is not sent again; "Plan again" plans anew', async () => {
    await toSources();
    pick(/Alkitab Terjemahan Baru/);
    fireEvent.click(button('Plan the import of 3 books'));
    await worker.answer('POST', planUrl, importPlanOf('p3', [book('gen')]));
    fireEvent.click(button(/^Import 1 book$/));
    expect(applies()).toHaveLength(1);
    await worker.answer('POST', applyUrl, errorOf('source_changed', { reason: 'the source file is not the one the plan showed' }, 'The source repository has changed since the plan. Plan the import again.'), 409);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-code')).toBe('source_changed');
    expect(alert.textContent).toContain('The source repository has changed since the plan. Plan the import again.');
    expect(alert.textContent).toContain('The project or the source changed after this plan was made');
    expect(button(/^Import 1 book$/).disabled).toBe(true);
    expect(screen.getByText(/This plan was sent once and is not sent again/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Plan again' }));
    expect(plans()).toHaveLength(2);
    expect(applies()).toHaveLength(1);
  });

  test('X2: a failed owner search is shown in place and "Try again" searches again', async () => {
    mount();
    await answerWhenSent('GET', ownersUrl, errorOf('door43_unavailable'), 503);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-code')).toBe('door43_unavailable');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await answerWhenSent('GET', ownersUrl, ownersOf(OWN));
    expect(worker.sent.filter(request => request.url === ownersUrl)).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('list', { name: 'Your organizations' }).textContent).toContain('tC Admin QA (tc-admin-qa-org)');
  });

  test('X2: a failed source search is shown in place and "Try again" reads the same owner\'s sources again', async () => {
    mount();
    await answerWhenSent('GET', ownersUrl, ownersOf(OWN));
    fireEvent.click(button('tC Admin QA (tc-admin-qa-org)'));
    await answerWhenSent('GET', sourcesUrl('tc-admin-qa-org', 'latest'), errorOf('door43_unavailable'), 503);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    await answerWhenSent('GET', sourcesUrl('tc-admin-qa-org', 'latest'), sourcesOf([TB1]));
    expect(worker.sent.filter(request => request.url === sourcesUrl('tc-admin-qa-org', 'latest'))).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Repositories' })).getByRole('radio', { name: /Alkitab Terjemahan Baru/ })).toBeTruthy();
  });
});
