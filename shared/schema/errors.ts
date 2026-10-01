// The error catalog (operations.md §6) as data, and the error shape every
// failure is returned in (X2). Messages are quoted from the catalog, which
// quotes the product specification §11 where it fixes the wording; `<name>`
// marks a value filled in at the point of failure. A `null` message is
// supplied by the failure itself: the field that failed validation, the
// project's editability reason, or the health-check state.

import { z } from 'zod';

export interface ErrorEntry {
  /** HTTP status; `null` for `setup_incomplete`, which is a receipt warning, not an error response. */
  http: number | null;
  /** `true` unless the catalog says "no"; how to retry is in `next_action`. */
  retryable: boolean;
  message: string | null;
  /** Further fixed messages for the same code, by case. */
  variants?: Readonly<Record<string, string>>;
  next_action: string;
  invariants: readonly string[];
}

export const ERROR_CATALOG = {
  door43_unavailable: { http: 503, retryable: true, message: 'Door43 is unavailable currently. Please refresh later.', next_action: 'refresh later; nothing was written', invariants: ['X1'] },
  session_expired: { http: 401, retryable: true, message: 'Your Door43 session expired. Please sign in again.', next_action: 'sign in; unsaved form state preserved where safe', invariants: ['A1'] },
  permission_denied: { http: 403, retryable: false, message: 'You no longer have write access to this project.', next_action: 'refresh the portfolio', invariants: ['A2', 'P2'] },
  csrf_rejected: { http: 403, retryable: false, message: 'This request could not be verified. Reload and try again.', next_action: 'reload', invariants: ['A4'] },
  not_found: { http: 404, retryable: false, message: 'This project or release was not found on Door43.', next_action: 'refresh the portfolio', invariants: [] },
  validation_failed: { http: 400, retryable: false, message: null, next_action: 'fix the input', invariants: [] },
  name_taken: { http: 409, retryable: false, message: 'A repository named <repo_name> already exists in <owner>. Change the abbreviation.', next_action: 'change the abbreviation or the owner', invariants: [] },
  not_editable: { http: 409, retryable: false, message: null, next_action: 'import into a new project when the reason offers it', invariants: ['W2', 'P1'] },
  not_releasable: { http: 409, retryable: false, message: null, next_action: 'import into a new project when the reason offers it', invariants: ['P1'] },
  invalid_selection: { http: 400, retryable: false, message: 'Include or carry forward at least one book.', next_action: 'fix the selection', invariants: ['R4'] },
  unidentified_file: { http: 400, retryable: false, message: '<file name> does not identify a book or story. Choose one or leave the file out.', next_action: 'choose the book or story, or drop the file', invariants: ['W6'] },
  source_unavailable: { http: 502, retryable: true, message: "Door43 could not provide the source repository's archive. Try again later.", next_action: 'retry `import.plan`', invariants: [] },
  invalid_version: {
    http: 400,
    retryable: false,
    message: 'Version must be valid and greater than <latest>.',
    variants: { removal: 'Removing a book needs a new major version, at least <major>.' },
    next_action: 'edit the version',
    invariants: ['R9'],
  },
  plan_expired: { http: 409, retryable: true, message: 'This plan has expired. Review the project again.', next_action: 'rerun the plan', invariants: ['R5'] },
  source_changed: { http: 409, retryable: true, message: 'Project has been edited. The release process will need to restart.', next_action: 'discard the preparation and plan again', invariants: ['R5'] },
  commit_failed: { http: 502, retryable: true, message: 'Commit failed: <error message>.', next_action: 'retry', invariants: ['X1', 'R7'] },
  archive_failed: { http: 502, retryable: true, message: 'Door43 could not provide the project archive. Try again later.', next_action: 'retry `release.prepare`', invariants: [] },
  health_blocked: { http: 409, retryable: true, message: null, next_action: 'refresh health; retry when Door43 recovers', invariants: ['H2'] },
  warning_not_acknowledged: { http: 409, retryable: true, message: 'The health check reported warnings. Review them and confirm to release anyway.', next_action: 'show the warnings; resend with `acknowledge_warnings: true`', invariants: ['H2'] },
  release_failed: { http: 502, retryable: true, message: 'Release creation failed: <error message>.', next_action: 'retry; the temporary branch is kept', invariants: ['R7'] },
  release_outcome_unknown: { http: 502, retryable: true, message: 'Door43 did not confirm the release.', next_action: 'run `release.lookup` for the tag before retrying', invariants: ['R6', 'X1'] },
  release_exists: { http: 409, retryable: false, message: 'This release already exists on Door43.', next_action: 'open the existing release', invariants: ['R6'] },
  not_prerelease: { http: 409, retryable: false, message: 'This release is already a full release.', next_action: 'none', invariants: ['R8'] },
  already_released: { http: 409, retryable: false, message: 'This preparation has been released and cannot be discarded.', next_action: 'open the release', invariants: ['R7'] },
  promotion_failed: { http: 502, retryable: true, message: 'Pre-release promotion failed. <error message>.', next_action: 'retry', invariants: ['R8'] },
  setup_incomplete: { http: null, retryable: true, message: 'Setup incomplete. The repository exists but its first commit failed.', next_action: 'retry the first commit', invariants: ['W4'] },
  preparation_active: { http: 409, retryable: false, message: 'A release is being prepared for this project. Finish or discard it first.', next_action: 'open the preparation', invariants: ['W7'] },
  portfolio_too_large: { http: 507, retryable: false, message: 'This portfolio exceeds the current read limit. No partial portfolio was substituted.', next_action: 'Milestone 3', invariants: ['P1'] },
  unknown_operation: { http: 404, retryable: false, message: 'This request is not an operation tC Admin offers.', next_action: 'check the route in the operation catalog', invariants: ['X2'] },
  unexpected: { http: 500, retryable: false, message: 'Something went wrong. Reference <request_id>.', next_action: 'report with the request id', invariants: ['X2'] },
} as const satisfies Record<string, ErrorEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
export const ERROR_CODES = Object.keys(ERROR_CATALOG) as [ErrorCode, ...ErrorCode[]];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

/** The error shape (operations.md §2). `details` is redacted and operation-specific (X3). */
export const OperationErrorShape = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  next_action: z.string(),
  request_id: z.string(),
  details: z.record(z.string(), z.unknown()),
  invariant: z.string().nullable(),
});
export type OperationErrorShape = z.infer<typeof OperationErrorShape>;

/** Fill `<name>` placeholders; a placeholder without a value stays as written. */
export function formatMessage(template: string, values: Readonly<Record<string, string>> = {}): string {
  return template.replace(/<([^<>]+)>/g, (whole, name: string) => values[name] ?? whole);
}

export interface CatalogErrorOptions {
  /** Values for the message's `<name>` placeholders. */
  values?: Readonly<Record<string, string>>;
  /** The message, for a code whose catalog message is supplied by the failure. */
  message?: string;
  /** A key of the entry's `variants`. */
  variant?: string;
  /** Redacted, operation-specific details: never a token, a secret, or file contents (X3). */
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

/**
 * A failure carrying its catalog code. Any layer may throw one; the HTTP
 * projection turns it into the error shape, and anything else thrown becomes
 * `unexpected` (X2).
 */
export class CatalogError extends Error {
  readonly code: ErrorCode;
  readonly values: Readonly<Record<string, string>>;
  readonly variant: string | undefined;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, options: CatalogErrorOptions = {}) {
    super(options.message ?? catalogMessage(code, options.variant, options.values), { cause: options.cause });
    this.name = 'CatalogError';
    this.code = code;
    this.values = options.values ?? {};
    this.variant = options.variant;
    this.details = options.details ?? {};
  }
}

/** The fixed message for a code, with its placeholders filled; the code itself when the failure must supply it. */
export function catalogMessage(code: ErrorCode, variant?: string, values?: Readonly<Record<string, string>>): string {
  const entry: ErrorEntry = ERROR_CATALOG[code];
  const template = (variant !== undefined ? entry.variants?.[variant] : undefined) ?? entry.message;
  return template === null ? code : formatMessage(template, values);
}
