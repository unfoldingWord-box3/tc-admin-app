// The common shapes of the operation catalog §2: freshness, references, plan,
// receipt, and warnings. Operation-specific previews and results are passed in.

import { z } from 'zod';
import { FreshnessSource } from './states';

/** Every output carries its read time, source, and age (P3). */
export const Freshness = z.object({
  read_at: z.string(),
  source: FreshnessSource,
  age_seconds: z.number().nonnegative(),
});
export type Freshness = z.infer<typeof Freshness>;

/** A repository on the configured Door43 host. */
export const RepoRef = z.object({ owner: z.string().min(1), repo: z.string().min(1) });
export type RepoRef = z.infer<typeof RepoRef>;

/** A project's reference in a project report. */
export const ProjectRef = RepoRef.extend({ id: z.number().int(), url: z.string() });
export type ProjectRef = z.infer<typeof ProjectRef>;

/** The Door43 write kinds a plan announces (R3, W5). */
export const WRITE_KINDS = ['repo', 'branch', 'commit', 'tag', 'release'] as const;
export const WriteKind = z.enum(WRITE_KINDS);
export type WriteKind = z.infer<typeof WriteKind>;

export const Warning = z.object({ code: z.string(), message: z.string() });
export type Warning = z.infer<typeof Warning>;

/** The SHAs a plan or preparation was computed from (R5); `default_branch_sha` is `null` for `project.create.plan`, which has no source. */
export const BoundTo = z.object({
  default_branch_sha: z.string().nullable(),
  release_tag: z.string().nullable(),
  release_tag_sha: z.string().nullable(),
});
export type BoundTo = z.infer<typeof BoundTo>;

/** A plan: what an apply would write, bound to its source, never writing (ADR 0011). */
export function plan<Preview extends z.ZodType>(preview: Preview) {
  return z.object({
    id: z.string(),
    operation: z.string(),
    created_at: z.string(),
    expires_at: z.string(),
    bound_to: BoundTo,
    preview,
    would_write: z.array(z.object({ kind: WriteKind, target: z.string() })),
    warnings: z.array(Warning),
  });
}

/** A receipt: what an apply wrote, a subset of its plan's `would_write`. */
export function receipt<Result extends z.ZodType>(result: Result) {
  return z.object({
    operation: z.string(),
    request_id: z.string(),
    plan_id: z.string().nullable(),
    started_at: z.string(),
    finished_at: z.string(),
    wrote: z.array(z.object({ kind: WriteKind, target: z.string(), sha: z.string().optional(), url: z.string().optional() })),
    result,
    warnings: z.array(Warning),
  });
}
