// The upload screen's test shapes (#76): E64's live `upload.plan` answer, and
// builders for plans, receipts, and catalog errors, each parsed by the shared
// schema as the client parses them.
import { OPERATIONS, ProjectReport, catalogMessage } from '@tc-admin/shared/schema';
import type { ErrorCode, OperationDefinition, OperationErrorShape, OperationOutput } from '@tc-admin/shared/schema';

type UploadPlan = OperationOutput<'upload.plan'>;
type PlannedFile = UploadPlan['preview']['files'][number];

/**
 * E64: `upload.plan` on QA for `tc-admin-qa-org/id_obs1948`, 8 October 2026, as recorded in
 * `fixtures/door43/qa.door43.org/2026-10-08/upload-plan/upload-plan__id_obs1948.json` (copied: `web/` reads no file
 * system). `05.md` new, `04.md` an overwrite with the branch's own bytes (empty diff), `notes.txt` held back.
 */
export const E64_PLAN = {
  id: '55f18b53-c6a6-4b50-addd-49a90e1b5db1',
  operation: 'upload.plan',
  created_at: '2026-10-08T01:56:43.585Z',
  expires_at: '2026-10-08T02:26:43.585Z',
  bound_to: { default_branch_sha: '928afcf7c9c6022ae11304ca7fce04f39230ecce', release_tag: null, release_tag_sha: null },
  preview: {
    files: [
      { name: '05.md', identified: { story: '05' }, path: 'ingredients/content/05.md', size: 3839, md5: '0408a70af06b8ec6cfc9e09b56bb286f', overwrite: false, diff: null },
      { name: '04.md', identified: { story: '04' }, path: 'ingredients/content/04.md', size: 3597, md5: 'c7da03b4cea376d67e41b4a7834312db', overwrite: true, diff: '' },
      { name: 'notes.txt', identified: null, path: null, size: 12, md5: '487713bcf8a59a3f5b83e751093bd00c', overwrite: false, diff: null },
    ],
    metadata_diff: {
      ingredients: [
        { path: 'ingredients/content/05.md', before: null, after: { checksum: { md5: '0408a70af06b8ec6cfc9e09b56bb286f' }, mimeType: 'text/markdown', size: 3839 } },
        { path: 'ingredients/content/04.md', before: null, after: { checksum: { md5: 'c7da03b4cea376d67e41b4a7834312db' }, mimeType: 'text/markdown', size: 3597 } },
      ],
    },
    unknown: ['notes.txt'],
  },
  would_write: [{ kind: 'commit', target: 'tc-admin-qa-org/id_obs1948@master' }],
  warnings: [],
} as const;

export const parsePlan = (value: unknown): UploadPlan => (OPERATIONS['upload.plan'] as OperationDefinition).output!.parse(value) as UploadPlan;

/** A plan of these files, with an entry added for every new file and updated for every overwrite, and the plan's warnings. */
export function uploadPlanOf(id: string, files: readonly PlannedFile[], target = 'tc-admin-qa-org/id_obs1948@master', warnings: readonly { code: string; message: string }[] = []): UploadPlan {
  const identified = files.filter(file => file.identified !== null);
  return parsePlan({
    id,
    operation: 'upload.plan',
    created_at: '2026-10-08T10:00:00.000Z',
    expires_at: '2026-10-08T10:30:00.000Z',
    bound_to: { default_branch_sha: 'a'.repeat(40), release_tag: null, release_tag_sha: null },
    preview: {
      files,
      metadata_diff: {
        ingredients: identified.map(file => ({
          path: file.path,
          before: file.overwrite ? { checksum: { md5: 'f'.repeat(32) }, mimeType: 'text/markdown', size: 10 } : null,
          after: { checksum: { md5: file.md5 }, mimeType: 'text/markdown', size: file.size },
        })),
      },
      unknown: files.filter(file => file.identified === null).map(file => file.name),
    },
    would_write: identified.length > 0 ? [{ kind: 'commit', target }] : [],
    warnings,
  });
}

export const story = (name: string, id: string | null, overwrite = false, diff: string | null = null): PlannedFile => ({
  name,
  identified: id === null ? null : { story: id },
  path: id === null ? null : `ingredients/content/${id}.md`,
  size: 3,
  md5: `${name}-md5`,
  overwrite,
  diff,
});

/** `upload.apply`'s receipt: the project report after the commit. */
export const uploadReceiptOf = (planId: string, owner = 'tc-admin-qa-org', repo = 'id_obs1948', present = 6) => ({
  operation: 'upload.apply',
  request_id: 'r9',
  plan_id: planId,
  started_at: '2026-10-08T10:01:00.000Z',
  finished_at: '2026-10-08T10:01:02.000Z',
  wrote: [{ kind: 'commit', target: `${owner}/${repo}@master`, sha: 'd'.repeat(40) }],
  result: ProjectReport.parse({
    ref: { owner, repo, id: 1, url: `https://qa.door43.org/${owner}/${repo}` },
    title: 'Cerita Alkitab',
    description: '',
    default_branch: 'master',
    language: { code: 'id', title: 'Bahasa Indonesia' },
    last_activity_at: '2026-10-08T10:01:01.000Z',
    project_type: 'obs',
    metadata_format: 'sb',
    editability: { state: 'editable', reason: 'A Scripture Burrito project.' },
    coverage: { present, target: 50, scope: 'obs', basis: 'archive', units: [] },
    health: { state: 'never_checked', severity_raw: null, ref: null, checked_at: null, issue_count: null, issues: null, source: 'door43' },
    latest_full_release: null,
    default_branch_head: { sha: 'd'.repeat(40), committed_at: '2026-10-08T10:01:01.000Z' },
    active_preparation: null,
    setup: { state: 'complete', failed_step: null },
    permissions: { push: true, admin: true, checked_at: '2026-10-08T10:01:00.000Z' },
    freshness: { read_at: '2026-10-08T10:01:02.000Z', source: 'live', age_seconds: 0 },
  }),
  warnings: [],
});

/** A catalog error as the Worker answers it: the catalog's message, or the given one for a code whose message the failure supplies. */
export const errorOf = (code: ErrorCode, details: Record<string, unknown> = {}, message?: string): OperationErrorShape => ({
  code,
  message: message ?? catalogMessage(code),
  retryable: false,
  next_action: '',
  request_id: 'r1',
  details,
  invariant: null,
});
