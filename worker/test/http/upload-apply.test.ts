// `upload.apply` through the HTTP projection: `POST
// /api/projects/{owner}/{repo}/uploads` (operations.md §7) takes a
// multipart/form-data body as `upload.plan` does (Q33), the same files sent
// again, with the plan id in a `plan_id` part and as the Idempotency-Key
// header; the same-origin and CSRF checks run first (A4); anything else is
// validation_failed before the operation runs.
import { IDEMPOTENCY_HEADER, OPERATIONS, OperationErrorShape, UPLOAD_CONFIRMATIONS_PART, UPLOAD_PLAN_ID_PART, uploadPartName } from '@tc-admin/shared/schema';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env, KVNamespace } from '../../src/env';
import worker from '../../src/index';
import { HANDLERS } from '../../src/operations';

const ORIGIN = 'https://tc-admin.test';
const PATH = '/api/projects/bahtraku/Perjanjian-Baru-Pendau/uploads';
const kv: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const env: Env = {
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SESSIONS: kv,
  PLANS: kv,
  DOOR43_ORIGIN: 'https://qa.door43.org',
};
const post = (body: FormData, headers: Record<string, string> = {}, path = PATH) => worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { origin: ORIGIN, ...headers }, body }), env);

/** The form the client sends: the plan id, each file's name and bytes again, and the confirmations as JSON. */
function form(planId: string | null, files: { name: string; content: string }[], confirmations?: unknown): FormData {
  const data = new FormData();
  if (planId !== null) data.append(UPLOAD_PLAN_ID_PART, planId);
  files.forEach((file, index) => {
    data.append(uploadPartName(index, 'name'), file.name);
    data.append(uploadPartName(index, 'content'), new Blob([file.content]), file.name);
  });
  if (confirmations !== undefined) data.append(UPLOAD_CONFIRMATIONS_PART, JSON.stringify(confirmations));
  return data;
}

const seen: unknown[] = [];
const receipt = {
  operation: 'upload.apply',
  request_id: 'r1',
  plan_id: 'p1',
  started_at: '2026-10-08T12:00:00.000Z',
  finished_at: '2026-10-08T12:00:01.000Z',
  wrote: [{ kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@master', sha: 'c'.repeat(40), url: 'https://qa.door43.org/c' }],
  result: {
    ref: { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau', id: 1, url: 'https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau' },
    title: 'Pendau',
    description: '',
    default_branch: 'master',
    language: { code: 'ped', title: 'Pendau' },
    last_activity_at: '2026-10-08T10:00:00.000Z',
    project_type: 'bible',
    metadata_format: 'sb',
    editability: { state: 'editable', reason: 'Scripture Burrito Bible project.' },
    coverage: { present: 1, target: 27, scope: 'nt', basis: 'archive', units: [] },
    health: { state: 'never_checked', severity_raw: null, ref: 'c'.repeat(40), checked_at: null, issue_count: null, issues: null, source: 'door43' },
    latest_full_release: null,
    release_health: null,
    default_branch_head: { sha: 'c'.repeat(40), committed_at: '2026-10-08T12:00:01Z' },
    active_preparation: null,
    setup: { state: 'complete', failed_step: null },
    permissions: { push: true, admin: false, checked_at: '2026-10-08T12:00:01.000Z' },
    freshness: { read_at: '2026-10-08T12:00:01.000Z', source: 'live', age_seconds: 0 },
  },
  warnings: [],
};
const built = HANDLERS['upload.apply'];
beforeEach(() => {
  seen.length = 0;
  HANDLERS['upload.apply'] = (async (input: unknown) => (seen.push(input), receipt)) as never;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  if (built) HANDLERS['upload.apply'] = built;
  else delete HANDLERS['upload.apply'];
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

describe('POST /api/projects/{owner}/{repo}/uploads', () => {
  test('is upload.apply, taking a multipart body: the path fields, the plan id, each file\'s name and bytes, and the confirmations reach the operation as plain data', async () => {
    expect(OPERATIONS['upload.apply'].route).toEqual({ method: 'POST', path: '/api/projects/{owner}/{repo}/uploads', body: 'multipart' });
    const response = await post(form('p1', [{ name: 'GEN.usfm', content: '\\id GEN\n' }], { 'GEN.usfm': { book: 'gen' } }), { [IDEMPOTENCY_HEADER]: 'p1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt);
    const input = seen[0] as { owner: string; repo: string; plan_id: string; files: { name: string; content: Uint8Array }[]; confirmations: unknown };
    expect([input.owner, input.repo, input.plan_id]).toEqual(['bahtraku', 'Perjanjian-Baru-Pendau', 'p1']);
    expect(input.files.map(file => file.name)).toEqual(['GEN.usfm']);
    expect(new TextDecoder().decode(input.files[0]!.content)).toBe('\\id GEN\n');
    expect(input.confirmations).toEqual({ 'GEN.usfm': { book: 'gen' } });
  });

  test('#146: a receipt stored before release_health existed is answered again as 200, stating none', async () => {
    const { release_health: _, ...older } = receipt.result;
    HANDLERS['upload.apply'] = (async (input: unknown) => (seen.push(input), { ...receipt, result: older })) as never;
    const response = await post(form('p1', [{ name: 'GEN.usfm', content: '\\id GEN\n' }]), { [IDEMPOTENCY_HEADER]: 'p1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt);
  });

  test('#24: a receipt stored before last_activity_at existed is answered again as 200, stating none, and Door43 is not asked', async () => {
    const { last_activity_at: _, ...older } = receipt.result;
    HANDLERS['upload.apply'] = (async (input: unknown) => (seen.push(input), { ...receipt, result: older })) as never;
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const response = await post(form('p1', [{ name: 'GEN.usfm', content: '\\id GEN\n' }]), { [IDEMPOTENCY_HEADER]: 'p1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...receipt, result: { ...older, last_activity_at: null } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('A4: a multipart POST from another origin is csrf_rejected and the operation does not run', async () => {
    const response = await post(form('p1', [{ name: 'GEN.usfm', content: '\\id GEN\n' }]), { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(OperationErrorShape.parse(await response.json())).toMatchObject({ code: 'csrf_rejected', invariant: 'A4' });
    expect(seen).toEqual([]);
  });

  test('an Idempotency-Key header naming another plan is validation_failed before the operation runs', async () => {
    const body = await refusal(await post(form('p1', [{ name: 'GEN.usfm', content: 'x' }]), { [IDEMPOTENCY_HEADER]: 'p2' }));
    expect(body.details).toEqual({ fields: [{ path: 'plan_id', message: 'the Idempotency-Key header names another plan' }] });
  });

  test('a missing plan id, a plan id sent twice, or a plan id sent as a file is validation_failed naming it', async () => {
    expect((await refusal(await post(form(null, [{ name: 'GEN.usfm', content: 'x' }])))).details).toMatchObject({ fields: [{ path: 'plan_id' }] });
    const twice = form('p1', [{ name: 'GEN.usfm', content: 'x' }]);
    twice.append(UPLOAD_PLAN_ID_PART, 'p2');
    expect((await refusal(await post(twice))).details).toEqual({ fields: [{ path: 'plan_id', message: 'sent more than once' }] });
    const file = form(null, [{ name: 'GEN.usfm', content: 'x' }]);
    file.append(UPLOAD_PLAN_ID_PART, new Blob(['p1']), 'plan');
    expect((await refusal(await post(file))).details).toEqual({ fields: [{ path: 'plan_id', message: 'must be text' }] });
  });

  test('upload.plan takes no plan id: the part is validation_failed there, as any part the operation does not take', async () => {
    const built = HANDLERS['upload.plan'];
    HANDLERS['upload.plan'] = (async (input: unknown) => (seen.push(input), {})) as never;
    try {
      const body = await refusal(await post(form('p1', [{ name: 'GEN.usfm', content: 'x' }]), {}, `${PATH}/plan`));
      expect(body.details).toEqual({ fields: [{ path: 'plan_id', message: 'not a part of this operation' }] });
    } finally {
      if (built) HANDLERS['upload.plan'] = built;
    }
  });

  test('with the operation built and no session, the answer is session_expired and Door43 is not asked', async () => {
    if (built) HANDLERS['upload.apply'] = built;
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const response = await post(form('p1', [{ name: 'GEN.usfm', content: '\\id GEN\n' }]));
    expect(response.status).toBe(401);
    expect(OperationErrorShape.parse(await response.json()).code).toBe('session_expired');
    expect(fetch).not.toHaveBeenCalled();
  });
});
