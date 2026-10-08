// `upload.plan` through the HTTP projection: `POST
// /api/projects/{owner}/{repo}/uploads/plan` (operations.md §7) takes a
// multipart/form-data body (Q33), one part per field of each file, its bytes
// as they were sent, and the confirmations as JSON; the same-origin and CSRF
// checks run first (A4); anything else is validation_failed before the
// operation runs.
import { OPERATIONS, OperationErrorShape, UPLOAD_CONFIRMATIONS_PART, uploadPartName } from '@tc-admin/shared/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env, KVNamespace } from '../../src/env';
import worker from '../../src/index';
import { HANDLERS, UPLOAD_REQUEST_BYTES } from '../../src/operations';

const ORIGIN = 'https://tc-admin.test';
const PATH = '/api/projects/bahtraku/Perjanjian-Baru-Pendau/uploads/plan';
const kv: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {} };
const env: Env = {
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SESSIONS: kv,
  PLANS: kv,
  DOOR43_ORIGIN: 'https://qa.door43.org',
};
const post = (body: FormData | string, headers: Record<string, string> = {}) => worker.fetch(new Request(`${ORIGIN}${PATH}`, { method: 'POST', headers: { origin: ORIGIN, ...headers }, body }), env);

/** The form a browser sends: each file's name, mode, and bytes as parts, and the confirmations as JSON. */
function form(files: { name: string; mode?: string; content: Uint8Array | string }[], confirmations?: unknown): FormData {
  const data = new FormData();
  files.forEach((file, index) => {
    data.append(uploadPartName(index, 'name'), file.name);
    if (file.mode !== undefined) data.append(uploadPartName(index, 'mode'), file.mode);
    data.append(uploadPartName(index, 'content'), new Blob([file.content]), file.name);
  });
  if (confirmations !== undefined) data.append(UPLOAD_CONFIRMATIONS_PART, JSON.stringify(confirmations));
  return data;
}

const seen: unknown[] = [];
const answer = {
  id: 'p1',
  operation: 'upload.plan',
  created_at: '2026-10-08T12:00:00.000Z',
  expires_at: '2026-10-08T12:30:00.000Z',
  bound_to: { default_branch_sha: 'a'.repeat(40), release_tag: null, release_tag_sha: null },
  preview: { files: [], metadata_diff: { ingredients: [] }, unknown: [] },
  would_write: [],
  warnings: [],
};
const built = HANDLERS['upload.plan'];
beforeEach(() => {
  seen.length = 0;
  HANDLERS['upload.plan'] = (async (input: unknown) => (seen.push(input), answer)) as never;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  if (built) HANDLERS['upload.plan'] = built;
  else delete HANDLERS['upload.plan'];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const refusal = async (response: Response) => {
  expect(response.status).toBe(400);
  const body = OperationErrorShape.parse(await response.json());
  expect(body.code).toBe('validation_failed');
  expect(seen).toEqual([]);
  return body;
};

describe('POST /api/projects/{owner}/{repo}/uploads/plan', () => {
  test('is upload.plan, taking a multipart body: the path fields, each file\'s name, mode, and bytes, and the confirmations reach the operation as plain data', async () => {
    expect(OPERATIONS['upload.plan'].route).toEqual({ method: 'POST', path: '/api/projects/{owner}/{repo}/uploads/plan', body: 'multipart' });
    const usfm = '\\id RUT\n\\c 1\n';
    const bytes = new Uint8Array([0x00, 0xff, 0x10, 0x80]);
    const response = await post(form([{ name: 'books/08-RUT.usfm', mode: '33188', content: usfm }, { name: 'draft.usfm', mode: '', content: bytes }], { 'draft.usfm': { book: 'jon' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer);
    expect(seen).toHaveLength(1);
    const input = seen[0] as { owner: string; repo: string; files: { name: string; mode: number | null; content: Uint8Array }[]; confirmations: unknown };
    expect([input.owner, input.repo]).toEqual(['bahtraku', 'Perjanjian-Baru-Pendau']);
    expect(input.files.map(file => [file.name, file.mode])).toEqual([['books/08-RUT.usfm', 0o100644], ['draft.usfm', null]]);
    expect(input.files[0]!.content).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(input.files[0]!.content)).toBe(usfm);
    // The bytes arrive as sent, not as text.
    expect([...input.files[1]!.content]).toEqual([...bytes]);
    expect(input.confirmations).toEqual({ 'draft.usfm': { book: 'jon' } });
  });

  test('A4: a multipart POST from another origin is csrf_rejected and the operation does not run', async () => {
    const response = await post(form([{ name: 'RUT.usfm', content: '\\id RUT\n' }]), { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(OperationErrorShape.parse(await response.json())).toMatchObject({ code: 'csrf_rejected', invariant: 'A4' });
    expect(seen).toEqual([]);
  });

  test('a JSON body is validation_failed: the bytes travel only as multipart parts', async () => {
    const body = await refusal(await post(JSON.stringify({ files: [{ name: 'RUT.usfm', content: '\\id RUT\n' }] }), { 'content-type': 'application/json' }));
    expect(body.message).toBe('The request body must be multipart/form-data.');
  });

  test('W6: a body declaring more than one batch and its framing is refused from its length, before it is read', async () => {
    const body = await refusal(await post(form([{ name: 'RUT.usfm', content: '\\id RUT\n' }]), { 'content-length': String(UPLOAD_REQUEST_BYTES + 1) }));
    expect(body.details).toEqual({ batch: { bytes: UPLOAD_REQUEST_BYTES + 1, limit: UPLOAD_REQUEST_BYTES } });
  });

  test('a part the operation does not take, a missing file, a mode that is no number, or confirmations that are not JSON are validation_failed naming the field', async () => {
    const extra = form([{ name: 'RUT.usfm', content: 'x' }]);
    extra.append('files.0.size', '1');
    extra.append('content_ref', 'r');
    expect((await refusal(await post(extra))).details).toEqual({ fields: [{ path: 'files.0.size', message: 'not a part of this operation' }, { path: 'content_ref', message: 'not a part of this operation' }] });

    const gap = form([{ name: 'RUT.usfm', content: 'x' }]);
    gap.append(uploadPartName(2, 'name'), 'JON.usfm');
    gap.append(uploadPartName(2, 'content'), new Blob(['y']), 'JON.usfm');
    expect((await refusal(await post(gap))).details).toMatchObject({ fields: [{ path: 'files.1' }] });

    const mode = await refusal(await post(form([{ name: 'RUT.usfm', mode: 'rwxr-xr-x', content: 'x' }])));
    expect(mode.details).toMatchObject({ fields: [{ path: 'files.0.mode' }] });

    const notJson = form([{ name: 'RUT.usfm', content: 'x' }]);
    notJson.append(UPLOAD_CONFIRMATIONS_PART, '{not json');
    expect((await refusal(await post(notJson))).message).toBe('confirmations: the part is not valid JSON.');

    expect((await refusal(await post(new FormData()))).details).toMatchObject({ fields: [{ path: 'files' }] });
  });

  test('a file\'s content sent as a text field, not a file part, is validation_failed', async () => {
    const data = new FormData();
    data.append(uploadPartName(0, 'name'), 'RUT.usfm');
    data.append(uploadPartName(0, 'content'), '\\id RUT\n');
    expect((await refusal(await post(data))).details).toMatchObject({ fields: [{ path: 'files.0.content' }] });
  });

  test('with the operation built and no session, the answer is session_expired and Door43 is not asked', async () => {
    if (built) HANDLERS['upload.plan'] = built;
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const response = await post(form([{ name: '../RUT.usfm', content: '\\id RUT\n' }]));
    expect(response.status).toBe(401);
    expect(OperationErrorShape.parse(await response.json()).code).toBe('session_expired');
    expect(fetch).not.toHaveBeenCalled();
  });
});
