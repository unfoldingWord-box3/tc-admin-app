// @vitest-environment jsdom
// The upload screen mounted (#76): files chosen in the browser go to
// `upload.plan` as multipart, its answer is shown before anything is written,
// and only the confirmation sends `upload.apply`, once, with the planned files.
// A held-back file and an overwrite each block the confirmation until the
// manager decides; a choice plans again; every refusal is shown in place.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetCsrfToken } from '../src/api/client';
import { ProjectView } from '../src/ProjectView';
import { UploadScreen } from '../src/UploadScreen';
import { heldWorker, projectOf, settle } from './support/mounted';
import { E64_PLAN, errorOf, story, uploadPlanOf, uploadReceiptOf } from './support/upload';

const project = projectOf('tc-admin-qa-org', 'id_obs1948');
const base = '/api/projects/tc-admin-qa-org/id_obs1948';
const planUrl = `${base}/uploads/plan`;
const applyUrl = `${base}/uploads`;

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

const file = (name: string, text = name) => new File([text], name, { type: 'text/plain' });
const plans = () => worker.sent.filter(request => request.url === planUrl);
const applies = () => worker.sent.filter(request => request.url === applyUrl);
const confirmButton = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const partNames = (form: FormData | null) => [...(form?.keys() ?? [])];

/** Chooses files with the "Choose files" input and waits for the plan request. */
async function choose(...files: File[]) {
  fireEvent.change(screen.getByLabelText('Choose files'), { target: { files } });
  await vi.waitFor(() => expect(worker.waiting()).toContain(`POST ${planUrl}`));
}

const mount = () => render(<UploadScreen project={project} type="obs" onUploaded={() => {}} onCancel={() => {}} />);

describe('plan before apply', () => {
  test('W5, X1: from the project view, nothing is sent to upload.apply until the confirmation; then the planned files go once, and the receipt\'s report replaces the view', async () => {
    render(<ProjectView project={project} onFailure={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add stories' }));
    await choose(file('05.md', 'five'), file('04.md', 'four'));
    expect(partNames(plans()[0]!.form)).toEqual(['files.0.name', 'files.0.content', 'files.1.name', 'files.1.content']);
    expect(await (plans()[0]!.form!.get('files.1.content') as Blob).text()).toBe('four');

    await worker.answer('POST', planUrl, uploadPlanOf('p1', [story('05.md', '05'), story('04.md', '04', true, '@@ -1 +1 @@\n-old\n+new\n')]));
    expect(screen.getByText('Review before adding')).toBeTruthy();
    expect(screen.getByText(/One commit to tc-admin-qa-org\/id_obs1948@master: 1 new story \(Story 05\) · 1 story replaced \(Story 04\)/)).toBeTruthy();
    const add = confirmButton(/^Add 2 stories$/);
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(applies()).toEqual([]);

    fireEvent.click(screen.getByLabelText(/Replace ingredients\/content\/04\.md with 04\.md/));
    expect(add.disabled).toBe(false);
    expect(applies()).toEqual([]);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(applies()).toHaveLength(1);
    const apply = applies()[0]!;
    expect(apply.headers.get('idempotency-key')).toBe('p1');
    expect(partNames(apply.form)).toEqual(['plan_id', 'files.0.name', 'files.0.content', 'files.1.name', 'files.1.content', 'confirmations']);
    expect(apply.form!.get('plan_id')).toBe('p1');
    expect(await (apply.form!.get('files.0.content') as Blob).text()).toBe('five');

    await worker.answer('POST', applyUrl, uploadReceiptOf('p1'));
    expect(screen.getByRole('status').textContent).toContain('Added 2 stories in one commit.');
    expect(screen.getByRole('heading', { name: 'Cerita Alkitab' })).toBeTruthy();
    expect(screen.queryByText('Review before adding')).toBeNull();
  });

  test('W6: E64\'s plan holds notes.txt back; confirmation waits until its story is chosen, and the choice plans again with the confirmation', async () => {
    mount();
    await choose(file('05.md'), file('04.md'), file('notes.txt'));
    await worker.answer('POST', planUrl, E64_PLAN);

    const unknown = screen.getByRole('region', { name: 'Unknown files' });
    expect(within(unknown).getByText('notes.txt does not identify a book or story. Choose one or leave the file out.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Replace ingredients\/content\/04\.md with 04\.md/));
    expect(confirmButton(/^Add 2 stories$/).disabled).toBe(true);
    expect(screen.getByText('notes.txt is held back: choose its story or leave the file out.')).toBeTruthy();

    fireEvent.change(within(unknown).getByLabelText(/Story for notes\.txt/), { target: { value: '06' } });
    await vi.waitFor(() => expect(plans()).toHaveLength(2));
    expect(JSON.parse(String(plans()[1]!.form!.get('confirmations')))).toEqual({ 'notes.txt': { story: '06' } });
    // While the new plan is made, the old one cannot be confirmed.
    expect(confirmButton(/^Add 2 stories$/).disabled).toBe(true);

    await worker.answer('POST', planUrl, { ...E64_PLAN, id: 'p2', preview: { ...E64_PLAN.preview, files: [E64_PLAN.preview.files[0], E64_PLAN.preview.files[1], { ...E64_PLAN.preview.files[2], identified: { story: '06' }, path: 'ingredients/content/06.md' }], unknown: [] } });
    expect(screen.queryByRole('region', { name: 'Unknown files' })).toBeNull();
    expect(screen.getByText('Chosen by you')).toBeTruthy();
    // The overwrite of 04.md is the same in the new plan, so its confirmation stands.
    const add = confirmButton(/^Add 3 stories$/);
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(applies()).toHaveLength(1);
    expect(applies()[0]!.form!.get('plan_id')).toBe('p2');
    expect(JSON.parse(String(applies()[0]!.form!.get('confirmations')))).toEqual({ 'notes.txt': { story: '06' } });
  });

  test('W6: a held-back file left out is planned again without it', async () => {
    mount();
    await choose(file('05.md'), file('04.md'), file('notes.txt'));
    await worker.answer('POST', planUrl, E64_PLAN);
    fireEvent.click(screen.getByRole('button', { name: 'Leave out notes.txt' }));
    await vi.waitFor(() => expect(plans()).toHaveLength(2));
    expect(plans()[1]!.form!.getAll('files.2.name')).toEqual([]);
    expect([plans()[1]!.form!.get('files.0.name'), plans()[1]!.form!.get('files.1.name')]).toEqual(['05.md', '04.md']);
    expect(plans()[1]!.form!.has('confirmations')).toBe(false);
  });

  test('W6: an overwrite shows its diff, each line\'s kind in words, and needs its own confirmation', async () => {
    mount();
    await choose(file('04.md'));
    await worker.answer('POST', planUrl, uploadPlanOf('p1', [story('04.md', '04', true, '--- a/ingredients/content/04.md\n+++ b/ingredients/content/04.md\n@@ -1,2 +1,2 @@\n # Story 4\n-old line\n+new line\n')]));
    const diff = screen.getByLabelText('Changes to ingredients/content/04.md');
    expect(diff.textContent).toContain('Removed: old line');
    expect(diff.textContent).toContain('Added: new line');
    expect(screen.getByText(/1 line added · 1 removed/)).toBeTruthy();
    const add = confirmButton(/^Add 1 story$/);
    expect(add.disabled).toBe(true);
    const box = screen.getByLabelText(/Replace ingredients\/content\/04\.md with 04\.md/) as HTMLInputElement;
    fireEvent.click(box);
    expect(add.disabled).toBe(false);
    fireEvent.click(box);
    expect(add.disabled).toBe(true);
  });

  test('files dropped on the screen are planned like files chosen, and more files join those already chosen', async () => {
    mount();
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file('05.md')] } });
    await vi.waitFor(() => expect(plans()).toHaveLength(1));
    await worker.answer('POST', planUrl, uploadPlanOf('p1', [story('05.md', '05')]));
    fireEvent.change(screen.getByLabelText('Choose a folder'), { target: { files: [file('06.md')] } });
    await vi.waitFor(() => expect(plans()).toHaveLength(2));
    expect([plans()[1]!.form!.get('files.0.name'), plans()[1]!.form!.get('files.1.name')]).toEqual(['05.md', '06.md']);
    expect(screen.getByLabelText('Choose a folder').hasAttribute('webkitdirectory')).toBe(true);
    expect(applies()).toEqual([]);
  });

  test('a plan\'s id_line_mismatch warning is shown with the plan', async () => {
    render(<UploadScreen project={projectOf('tc-admin-qa', 'en_ult', 'bible')} type="bible" onUploaded={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file('notes.usfm', '\\id GEN')] } });
    await vi.waitFor(() => expect(worker.waiting()).toContain('POST /api/projects/tc-admin-qa/en_ult/uploads/plan'));
    const message = 'notes.usfm is confirmed as MAT, but its \\id line does not name it. The file is committed unchanged.';
    await worker.answer(
      'POST',
      '/api/projects/tc-admin-qa/en_ult/uploads/plan',
      uploadPlanOf('p1', [{ name: 'notes.usfm', identified: { book: 'mat' }, path: 'ingredients/MAT.usfm', size: 7, md5: 'm', overwrite: false, diff: null }], 'tc-admin-qa/en_ult@master', [{ code: 'id_line_mismatch', message }]),
    );
    expect(within(screen.getByRole('list', { name: 'Warnings' })).getByText(message)).toBeTruthy();
    expect(confirmButton(/^Add 1 book$/).disabled).toBe(false);
  });
});

/** A file whose bytes are read only when the test releases them. */
function slowFile(name: string, text = name) {
  const slow = file(name, text);
  let release: () => void = () => {};
  const read = new Promise<ArrayBuffer>(resolve => (release = () => resolve(new TextEncoder().encode(text).buffer as ArrayBuffer)));
  Object.defineProperty(slow, 'arrayBuffer', { value: () => read });
  return { file: slow, release: async () => act(async () => { release(); await settle(); }) };
}
const planNames = (form: FormData | null) => [...(form?.entries() ?? [])].filter(([key]) => key.endsWith('.name')).map(([, value]) => value).sort();

describe('overlapping choices', () => {
  test('W5: a slow read and then a fast one both stay in the batch, planned once the last is read', async () => {
    mount();
    const slow = slowFile('05.md');
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [slow.file] } });
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file('06.md')] } });
    await settle();
    expect(plans()).toHaveLength(0);
    await slow.release();
    await vi.waitFor(() => expect(plans()).toHaveLength(1));
    expect(planNames(plans()[0]!.form)).toEqual(['05.md', '06.md']);
  });

  test('W5: a plan answered while a newer choice is still read is not offered for confirmation', async () => {
    mount();
    await choose(file('05.md'));
    const slow = slowFile('06.md');
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [slow.file] } });
    await worker.answer('POST', planUrl, uploadPlanOf('p1', [story('05.md', '05')]));
    expect(screen.queryByRole('button', { name: /^Add 1 story$/ })).toBeNull();
    await slow.release();
    await vi.waitFor(() => expect(plans()).toHaveLength(2));
    expect(planNames(plans()[1]!.form)).toEqual(['05.md', '06.md']);
    await worker.answer('POST', planUrl, uploadPlanOf('p2', [story('05.md', '05'), story('06.md', '06')]));
    expect(confirmButton(/^Add 2 stories$/).disabled).toBe(false);
  });

  test('X1: files chosen while an apply is sent are not taken, and the apply\'s receipt is still delivered', async () => {
    const onUploaded = vi.fn();
    render(<UploadScreen project={project} type="obs" onUploaded={onUploaded} onCancel={() => {}} />);
    await choose(file('05.md'));
    await worker.answer('POST', planUrl, uploadPlanOf('p1', [story('05.md', '05')]));
    fireEvent.click(confirmButton(/^Add 1 story$/));
    expect(applies()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file('06.md')] } });
    await settle();
    await worker.answer('POST', applyUrl, uploadReceiptOf('p1'));
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(plans()).toHaveLength(1);
  });

  test('W6: an overwrite with no text diff, planned again against a moved branch, needs its confirmation again', async () => {
    mount();
    await choose(file('04.md'), file('05.md'));
    await worker.answer('POST', planUrl, uploadPlanOf('p1', [story('04.md', '04', true, null), story('05.md', '05')]));
    fireEvent.click(screen.getByLabelText(/Replace ingredients\/content\/04\.md with 04\.md/));
    expect(confirmButton(/^Add 2 stories$/).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Leave out 05.md' }));
    await vi.waitFor(() => expect(plans()).toHaveLength(2));
    const moved = uploadPlanOf('p2', [story('04.md', '04', true, null)]);
    await worker.answer('POST', planUrl, { ...moved, bound_to: { ...moved.bound_to, default_branch_sha: 'c'.repeat(40) } });
    expect((screen.getByLabelText(/Replace ingredients\/content\/04\.md with 04\.md/) as HTMLInputElement).checked).toBe(false);
    expect(confirmButton(/^Add 1 story$/).disabled).toBe(true);
  });
});

describe('refusals shown in place', () => {
  test('X2, W6: validation_failed names each file at fault, and leaving one out plans again without it', async () => {
    mount();
    await choose(file('05.md'), file('5.md'));
    await worker.answer(
      'POST',
      planUrl,
      errorOf(
        'validation_failed',
        { fields: [{ path: 'files.1.name', message: '"5.md": the file is story 05 (ingredients/content/05.md), as is "05.md"' }], files: [{ name: '05.md', reason: 'same_unit' }, { name: '5.md', reason: 'same_unit' }] },
        'files.1.name: "5.md": the file is story 05 (ingredients/content/05.md), as is "05.md"',
      ),
      400,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('These 2 files cannot be uploaded:')).toBeTruthy();
    expect(within(alert).getByText('"5.md": the file is story 05 (ingredients/content/05.md), as is "05.md"')).toBeTruthy();
    expect(within(alert).getByText(/Leave out each file named here/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Leave out 5.md' }));
    await vi.waitFor(() => expect(plans()).toHaveLength(2));
    expect(partNames(plans()[1]!.form)).toEqual(['files.0.name', 'files.0.content']);
    expect(applies()).toEqual([]);
  });

  const applyRefusals = [
    { code: 'unidentified_file', message: 'notes.txt does not identify a book or story. Choose one or leave the file out.', forward: /Plan again, then choose the book or story/ },
    { code: 'source_changed', message: 'Project has been edited. The release process will need to restart.', forward: /The default branch changed after this plan was made/ },
    { code: 'plan_expired', message: 'This plan has expired. Review the project again.', forward: /Plan again to review the same files/ },
  ] as const;

  for (const refusal of applyRefusals) {
    test(`X2, X1, R5: ${refusal.code} from upload.apply is shown with the catalog message and "Plan again"; the same apply is not offered again`, async () => {
      mount();
      await choose(file('05.md'));
      await worker.answer('POST', planUrl, uploadPlanOf('p1', [story('05.md', '05')]));
      fireEvent.click(confirmButton(/^Add 1 story$/));
      await worker.answer('POST', applyUrl, errorOf(refusal.code, {}, refusal.message), refusal.code === 'unidentified_file' ? 400 : 409);

      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(refusal.message)).toBeTruthy();
      expect(within(alert).getByText(refusal.forward)).toBeTruthy();
      expect(confirmButton(/^Add 1 story$/).disabled).toBe(true);
      fireEvent.click(confirmButton(/^Add 1 story$/));
      expect(applies()).toHaveLength(1);

      fireEvent.click(within(alert).getByRole('button', { name: 'Plan again' }));
      await vi.waitFor(() => expect(plans()).toHaveLength(2));
      await worker.answer('POST', planUrl, uploadPlanOf('p2', [story('05.md', '05')]));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(confirmButton(/^Add 1 story$/).disabled).toBe(false);
    });
  }

  test('X2: not_editable from upload.plan shows the project\'s reason and the way back, and plans nothing more', async () => {
    const onCancel = vi.fn<() => void>();
    render(<UploadScreen project={project} type="obs" onUploaded={() => {}} onCancel={onCancel} />);
    await choose(file('05.md'));
    await worker.answer('POST', planUrl, errorOf('not_editable', {}, 'This repository is not a Scripture Burrito project.'), 409);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('This repository is not a Scripture Burrito project.')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Back to the project' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(applies()).toEqual([]);
  });
});
