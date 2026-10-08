// For the mounted component tests (jsdom, Testing Library): a stubbed Worker
// whose answers the test releases one at a time, in the order it chooses, so a
// race between two operations is a sequence the test writes; and the shapes
// those answers carry, parsed by the shared schema as the client parses them.
import { OPERATIONS, Preparation, ProjectSummary } from '@tc-admin/shared/schema';
import type { OperationDefinition, OperationOutput } from '@tc-admin/shared/schema';
import { act } from '@testing-library/react';

export interface Sent {
  method: string;
  url: string;
  body: unknown;
  /** A multipart body as sent (`upload.plan`, `upload.apply`); `null` for any other. */
  form: FormData | null;
  headers: Headers;
}

interface Pending extends Sent {
  answer: (response: Response) => void;
}

/** A Worker that holds every request until the test answers it; `sent` records each request in the order it was made. */
export function heldWorker() {
  const pending: Pending[] = [];
  const sent: Sent[] = [];
  const fetch = (url: string, init?: RequestInit): Promise<Response> =>
    new Promise(answer => {
      const request = {
        method: init?.method ?? 'GET',
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        form: init?.body instanceof FormData ? init.body : null,
        headers: new Headers(init?.headers),
      };
      sent.push(request);
      pending.push({ ...request, answer });
    });

  /** Answers the oldest held request for `method url` with `body`, then lets React apply it. */
  const answer = async (method: string, url: string, body: unknown, status = 200): Promise<void> => {
    const index = pending.findIndex(request => request.method === method && request.url === url);
    if (index < 0) throw new Error(`no ${method} ${url} is waiting; waiting: ${pending.map(request => `${request.method} ${request.url}`).join(', ') || 'none'}`);
    const [request] = pending.splice(index, 1);
    await act(async () => {
      request!.answer(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
      await settle();
    });
  };

  const waiting = () => pending.map(request => `${request.method} ${request.url}`);
  return { fetch, answer, sent, waiting };
}

/** Lets the client read and parse an answer and React render it: a few turns of the event loop. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

export const freshness = { read_at: '2026-10-08T10:00:00.000Z', source: 'live', age_seconds: 0 } as const;

export const projectOf = (owner: string, repo: string, project_type: 'bible' | 'obs' = 'obs'): ProjectSummary =>
  ProjectSummary.parse({
    ref: { owner, repo, id: 1, url: `https://qa.door43.org/${owner}/${repo}` },
    title: `${owner}/${repo}`,
    description: '',
    default_branch: 'master',
    language: { code: 'id', title: 'Bahasa Indonesia' },
    last_activity_at: '2026-10-07T10:00:00.000Z',
    project_type,
    metadata_format: 'sb',
    editability: { state: 'editable', reason: 'A Scripture Burrito project.' },
    coverage: { present: 4, target: 50, scope: 'obs', basis: 'catalog', units: [] },
    health: { state: 'healthy', severity_raw: 'success', ref: 'master', checked_at: null, issue_count: 0, issues: null, source: 'door43' },
    permissions: { push: true, admin: true, checked_at: '2026-10-08T10:00:00.000Z' },
  });

export const preparationOf = (owner: string, repo: string, id: string, state: Preparation['state']): Preparation =>
  Preparation.parse({
    id,
    project_ref: { owner, repo },
    state,
    bound_to: { default_branch_sha: 'a'.repeat(40), release_tag: 'v1.0.0', release_tag_sha: 'b'.repeat(40) },
    selection: { new: [], revised: [], unknown_included: [] },
    snapshot: { branch: `temp-tca-release/${id}`, commit_sha: 'c'.repeat(40), files: [] },
    health: { state: 'failing', severity_raw: 'error', ref: `temp-tca-release/${id}`, checked_at: '2026-10-08T10:00:00.000Z', issue_count: 0, issues: [], source: 'door43' },
    requires_acknowledgement: false,
    version: { baseline_tag: 'v1.0.0', proposed: id, confirmed: id },
    notes: { draft: `Release ${id}`, confirmed: null },
    release: null,
    last_error: null,
    history: [{ at: '2026-10-08T10:00:00.000Z', from: 'health_checking', to: state, event: 'health read' }],
    freshness: { read_at: '2026-10-08T10:00:00.000Z', source: 'cache', age_seconds: 60 },
  });

export const planOf = (id: string): OperationOutput<'release.plan'> =>
  (OPERATIONS['release.plan'] as OperationDefinition).output!.parse({
    id,
    operation: 'release.plan',
    created_at: '2026-10-08T10:00:00.000Z',
    expires_at: '2026-10-08T10:30:00.000Z',
    bound_to: { default_branch_sha: 'a'.repeat(40), release_tag: 'v1.0.0', release_tag_sha: 'b'.repeat(40) },
    preview: {
      books: [{ id: '01', group: 'changed_released', selection: 'include' }],
      removals: [],
      administrative: ['README.md'],
      version: { baseline_tag: 'v1.0.0', proposed: 'v1.0.1', rule_applied: 'revisions' },
      notes_draft: '## v1.0.1',
    },
    would_write: [{ kind: 'branch', target: 'o/r@temp-tca-release/v1.0.1' }],
    warnings: [],
  }) as OperationOutput<'release.plan'>;

export const receiptOf = (operation: string, result: Preparation, plan_id: string | null = null) => ({
  operation,
  request_id: 'r1',
  plan_id,
  started_at: '2026-10-08T10:00:00.000Z',
  finished_at: '2026-10-08T10:00:01.000Z',
  wrote: [],
  result,
  warnings: [],
});
