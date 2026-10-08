// The upload screen's logic (#76): the wording of the plan and its confirm
// button, what blocks the confirmation, the diff's lines, a refusal's files,
// and the one request `upload.apply` is sent as.
import { IDEMPOTENCY_HEADER, UPLOAD_CONFIRMATIONS_PART, uploadPartName } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { multipartBody, operationRequest } from '../src/api/client';
import {
  addAction,
  applyUpload,
  canConfirm,
  confirmBlockers,
  confirmLabel,
  diffCounts,
  diffLines,
  mergeChosen,
  overwriteKey,
  problemFiles,
  unidentifiedMessage,
  uploadName,
  uploadSummary,
  wayForward,
  withConfirmation,
  withoutFile,
} from '../src/upload';
import { E64_PLAN, errorOf, parsePlan, story, uploadPlanOf, uploadReceiptOf } from './support/upload';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('wording', () => {
  test('the confirm button names the write: "Add 3 books", "Add 1 story"', () => {
    expect(confirmLabel('bible', 3)).toBe('Add 3 books');
    expect(confirmLabel('bible', 1)).toBe('Add 1 book');
    expect(confirmLabel('obs', 1)).toBe('Add 1 story');
    expect(confirmLabel('obs', 2)).toBe('Add 2 stories');
    expect(addAction('bible')).toBe('Add books');
    expect(addAction('obs')).toBe('Add stories');
  });

  test('W5: the summary of E64\'s plan names the one commit, the new and the replaced story, and the metadata entries', () => {
    expect(uploadSummary(parsePlan(E64_PLAN), 'obs')).toBe(
      'One commit to tc-admin-qa-org/id_obs1948@master: 1 new story (Story 05) · 1 story replaced (Story 04) · 2 ingredient entries in metadata.json.',
    );
    const books = uploadPlanOf('p1', [
      { name: 'MAT.usfm', identified: { book: 'mat' }, path: 'ingredients/MAT.usfm', size: 1, md5: 'a', overwrite: false, diff: null },
      { name: 'MRK.usfm', identified: { book: 'mrk' }, path: 'ingredients/MRK.usfm', size: 1, md5: 'b', overwrite: false, diff: null },
      { name: '08-RUT.usfm', identified: { book: 'rut' }, path: 'ingredients/RUT.usfm', size: 1, md5: 'c', overwrite: true, diff: '' },
    ], 'o/r@master');
    expect(uploadSummary(books, 'bible')).toBe('One commit to o/r@master: 2 new books (MAT, MRK) · 1 book replaced (RUT) · 3 ingredient entries in metadata.json.');
  });

  test('X2: a held-back file reads the catalog\'s unidentified_file message, with its name', () => {
    expect(unidentifiedMessage('notes.txt')).toBe('notes.txt does not identify a book or story. Choose one or leave the file out.');
  });
});

describe('the confirmation gate', () => {
  test('W6: E64\'s plan cannot be confirmed while notes.txt is held back, nor before the overwrite of 04.md is confirmed', () => {
    const plan = parsePlan(E64_PLAN);
    const overwrite = plan.preview.files[1]!;
    expect(confirmBlockers(plan, 'obs', new Set())).toEqual([
      'notes.txt is held back: choose its story or leave the file out.',
      'Confirm that ingredients/content/04.md is replaced.',
    ]);
    expect(confirmBlockers(plan, 'obs', new Set([overwriteKey(overwrite)]))).toEqual(['notes.txt is held back: choose its story or leave the file out.']);
    expect(canConfirm(plan, 'obs', new Set([overwriteKey(overwrite)]))).toBe(false);
  });

  test('W6: once every file is identified and every overwrite confirmed, the plan can be confirmed', () => {
    const plan = uploadPlanOf('p2', [story('05.md', '05'), story('04.md', '04', true, ''), story('notes.txt', '06')]);
    const confirmed = new Set(plan.preview.files.filter(file => file.overwrite).map(overwriteKey));
    expect(canConfirm(plan, 'obs', confirmed)).toBe(true);
  });

  test('W5: a plan that would write nothing cannot be confirmed', () => {
    const plan = uploadPlanOf('p3', [story('notes.txt', null)]);
    expect(confirmBlockers(plan, 'obs', new Set())).toContain('No file is identified as a story yet, so nothing would be written.');
  });

  test('an overwrite confirmed for one plan stays confirmed in the next only when the same bytes replace the same file the same way', () => {
    const first = story('04.md', '04', true, '@@ -1 +1 @@\n-a\n+b\n');
    expect(overwriteKey(first)).toBe(overwriteKey({ ...first }));
    expect(overwriteKey(first)).not.toBe(overwriteKey({ ...first, diff: '@@ -1 +1 @@\n-c\n+b\n' }));
    expect(overwriteKey(first)).not.toBe(overwriteKey({ ...first, md5: 'other' }));
  });
});

describe('the diff', () => {
  test('each line of a unified diff is classified, and its kind is a sign and a word, not color alone', () => {
    const lines = diffLines('--- a/ingredients/RUT.usfm\n+++ b/ingredients/RUT.usfm\n@@ -1,3 +1,3 @@\n \\id RUT\n-\\c 1 old\n+\\c 1 new\n--- not a header\n\\ No newline at end of file\n');
    expect(lines.map(line => line.kind)).toEqual(['file', 'file', 'hunk', 'context', 'removed', 'added', 'removed', 'note']);
    expect(lines.map(line => line.sign)).toEqual(['', '', '', '', '−', '+', '−', '']);
    expect(lines.map(line => line.word)).toEqual(['File', 'File', 'Lines', 'Unchanged', 'Removed', 'Added', 'Removed', 'Note']);
    expect(lines[4]!.text).toBe('\\c 1 old');
    expect(lines[6]!.text).toBe('-- not a header');
    expect(lines[7]!.text).toBe('No newline at end of file');
    expect(diffCounts(lines)).toBe('1 line added · 2 removed');
    expect(diffLines('')).toEqual([]);
  });
});

describe('choices', () => {
  test('a file chosen again replaces the earlier one of the same name, in its place', () => {
    const merged = mergeChosen([{ name: 'a.md', content: bytes('1') }, { name: 'b.md', content: bytes('2') }], [{ name: './a.md', content: bytes('3') }, { name: 'c.md', content: bytes('4') }]);
    expect(merged.map(file => [file.name, new TextDecoder().decode(file.content)])).toEqual([['./a.md', '3'], ['b.md', '2'], ['c.md', '4']]);
  });

  test('W6: leaving a file out drops its confirmation too, since a confirmation naming no file is refused', () => {
    const left = withoutFile([{ name: 'notes.txt', content: bytes('x') }, { name: '05.md', content: bytes('y') }], { 'notes.txt': { story: '06' } }, 'notes.txt');
    expect(left.files.map(file => file.name)).toEqual(['05.md']);
    expect(left.confirmations).toEqual({});
    expect(withConfirmation({ 'notes.txt': { story: '06' } }, 'notes.txt', { story: '07' })).toEqual({ 'notes.txt': { story: '07' } });
    expect(withConfirmation({ 'notes.txt': { story: '06' } }, 'notes.txt', null)).toEqual({});
  });

  test('a file in a chosen folder is sent by its path inside the folder', () => {
    expect(uploadName({ name: 'MAT.usfm', webkitRelativePath: 'nt/MAT.usfm' })).toBe('nt/MAT.usfm');
    expect(uploadName({ name: 'MAT.usfm', webkitRelativePath: '' })).toBe('MAT.usfm');
  });
});

describe('refusals', () => {
  test('X2, W6: a validation_failed names each file at fault with its field message', () => {
    const error = errorOf(
      'validation_failed',
      {
        fields: [
          { path: 'files.1.name', message: '"%2e%2e/05.md": the name contains a percent sign' },
          { path: 'files.2.name', message: '"05.md": the file is story 05 (ingredients/content/05.md), as is "5.md"' },
        ],
        files: [
          { name: '%2e%2e/05.md', reason: 'percent_encoding' },
          { name: '5.md', reason: 'same_unit' },
        ],
      },
      'files.1.name: …',
    );
    expect(problemFiles(error, ['04.md', '%2e%2e/05.md', '5.md'])).toEqual([
      { name: '%2e%2e/05.md', message: '"%2e%2e/05.md": the name contains a percent sign' },
      { name: '5.md', message: '"05.md": the file is story 05 (ingredients/content/05.md), as is "5.md"' },
    ]);
    expect(problemFiles(errorOf('plan_expired'), ['a'])).toEqual([]);
  });

  test('X1, R5: after an apply that failed the way forward is a new plan, never the same apply again', () => {
    for (const code of ['source_changed', 'plan_expired', 'unidentified_file', 'commit_failed', 'door43_unavailable'] as const) expect(wayForward(code, 'apply')).toBe('plan_again');
    expect(wayForward('validation_failed', 'plan')).toBe('leave_out');
    expect(wayForward('not_editable', 'plan')).toBe('back');
    expect(wayForward('door43_unavailable', 'plan')).toBe('try_again');
  });
});

describe('requests', () => {
  test('upload.plan is sent as multipart: each file\'s name and bytes as its parts, the confirmations as JSON, no JSON content type', async () => {
    const { url, init } = operationRequest('upload.plan', { owner: 'o', repo: 'r', files: [{ name: 'MAT.usfm', content: bytes('\\id MAT') }, { name: 'x.usfm', mode: 0o100644, content: bytes('x') }], confirmations: { 'x.usfm': { book: 'mrk' } } });
    expect(url).toBe('/api/projects/o/r/uploads/plan');
    expect(new Headers(init.headers).has('content-type')).toBe(false);
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual([uploadPartName(0, 'name'), uploadPartName(0, 'content'), uploadPartName(1, 'name'), uploadPartName(1, 'mode'), uploadPartName(1, 'content'), UPLOAD_CONFIRMATIONS_PART]);
    expect(form.get('files.1.mode')).toBe(String(0o100644));
    expect(await (form.get('files.0.content') as Blob).text()).toBe('\\id MAT');
    expect(JSON.parse(String(form.get('confirmations')))).toEqual({ 'x.usfm': { book: 'mrk' } });
  });

  test('W5: applyUpload sends upload.apply once: the plan id, the same files, and the confirmations as multipart, keyed by the plan id', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const receipt = await applyUpload({ owner: 'tc-admin-qa-org', repo: 'id_obs1948' }, 'p1', [{ name: '05.md', content: bytes('five') }, { name: 'notes.txt', content: bytes('n') }], { 'notes.txt': { story: '06' } }, async (url, init) => {
      sent.push({ url, init: init! });
      return new Response(JSON.stringify(uploadReceiptOf('p1')));
    });
    expect(receipt.result.coverage.present).toBe(6);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/api/projects/tc-admin-qa-org/id_obs1948/uploads');
    expect(sent[0]!.init.method).toBe('POST');
    expect(new Headers(sent[0]!.init.headers).get(IDEMPOTENCY_HEADER)).toBe('p1');
    const form = sent[0]!.init.body as FormData;
    expect([...form.keys()]).toEqual(['plan_id', 'files.0.name', 'files.0.content', 'files.1.name', 'files.1.content', 'confirmations']);
    expect(form.get('plan_id')).toBe('p1');
    expect(await (form.get('files.0.content') as Blob).text()).toBe('five');
    expect(JSON.parse(String(form.get('confirmations')))).toEqual({ 'notes.txt': { story: '06' } });
  });

  test('a body part list leaves out what is not given', () => {
    expect([...multipartBody({ plan_id: 'p', files: [], confirmations: undefined }).keys()]).toEqual(['plan_id']);
  });
});
