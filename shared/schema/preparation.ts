// A release preparation (operations.md §2): the release state machine of
// domain model §6 as an addressable record.

import { z } from 'zod';
import { BoundTo, Freshness, RepoRef } from './common';
import { OperationErrorShape } from './errors';
import { Health } from './project';
import { PreparationState } from './states';

/**
 * The health poll after a push (#5, Q2, E28): the client reads the preparation every
 * `interval_ms` for `window_ms` after the push, then offers a refresh. The Worker reads
 * Door43 once per `preparation.read`.
 */
export const HEALTH_POLL = { interval_ms: 5_000, window_ms: 180_000 } as const;

export const Preparation = z.object({
  /** The version the preparation was created with; its temporary branch is `temp-tca-release/<version>`. */
  id: z.string(),
  project_ref: RepoRef,
  state: PreparationState,
  bound_to: BoundTo,
  selection: z.object({ new: z.array(z.string()), revised: z.array(z.string()), unknown_included: z.array(z.string()) }),
  snapshot: z
    .object({
      branch: z.string(),
      commit_sha: z.string(),
      files: z.array(z.object({ path: z.string(), source: z.enum(['tag', 'default_branch']), unit: z.string().nullable() })),
    })
    .nullable(),
  /** Health of the temporary branch. */
  health: Health,
  /** `preparation.read`: true when health is `warning`; release creation then needs `acknowledge_warnings` (H2). */
  requires_acknowledgement: z.boolean(),
  version: z.object({ baseline_tag: z.string().nullable(), proposed: z.string(), confirmed: z.string().nullable() }),
  notes: z.object({ draft: z.string(), confirmed: z.string().nullable() }),
  release: z.object({ tag: z.string(), url: z.string(), prerelease: z.boolean() }).nullable(),
  last_error: OperationErrorShape.nullable(),
  history: z.array(z.object({ at: z.string(), from: PreparationState.nullable(), to: PreparationState, event: z.string() })),
  freshness: Freshness,
});
export type Preparation = z.infer<typeof Preparation>;
