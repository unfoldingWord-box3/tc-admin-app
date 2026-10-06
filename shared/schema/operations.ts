// The operation catalog (operations.md §3, §4) as data: every operation's
// kind, milestone, HTTP route (§7), and input and output schemas. The Worker
// routes from this table, the web client calls through it, and the tests
// check it against the catalog document. Milestone 2 operations are listed
// by name only; their shapes are specified with #46 and #49.

import { z } from 'zod';
import { Freshness, RepoRef, plan, receipt } from './common';
import { Preparation } from './preparation';
import { CoverageScope, MetadataFormat, ProjectReport, ProjectSummary, ProjectType } from './project';
import { CandidateGroup, HealthState, SelectionState, VersionRule } from './states';

export const OPERATION_KINDS = ['read', 'plan', 'apply'] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const HTTP_METHODS = ['GET', 'POST'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Route {
  method: HttpMethod;
  /** A path under `/api/`; `{name}` is a path segment that fills the input field `name`. */
  path: string;
}

/**
 * The HTTP projection's headers (operations.md §7). The Worker issues a signed-in
 * browser's CSRF token in `x-csrf-token` on every `/api/` response, and every `POST`
 * must send it back in the same header from the Worker's own origin (A4).
 */
export const CSRF_HEADER = 'x-csrf-token';
/** An apply's idempotency key: the plan id (operations.md §1 rule 6). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface OperationDefinition {
  kind: OperationKind;
  milestone: 1 | 2;
  /** `null` until the operation's shapes are specified (Milestone 2). */
  route: Route | null;
  input: z.ZodType | null;
  output: z.ZodType | null;
}

const Language = z.object({ code: z.string(), title: z.string() });
/** The wizard's language, with the script direction when Door43's language list gives it (E25), for the metadata's `scriptDirection`. */
const ChosenLanguage = Language.extend({ direction: z.enum(['ltr', 'rtl']).nullish() });
const Account = z.object({ login: z.string(), name: z.string() });
const Unit = z.union([z.object({ book: z.string() }), z.object({ story: z.string() })]);
const PlanId = z.object({ plan_id: z.string().min(1) });
const PreparationRef = RepoRef.extend({ preparation_id: z.string().min(1) });
const TagRef = RepoRef.extend({ tag: z.string().min(1) });

/** A file an upload or import would write (`upload.plan`, `import.plan`). */
const PlannedFile = z.object({
  name: z.string(),
  identified: Unit.nullable(),
  path: z.string(),
  overwrite: z.boolean(),
  diff: z.string().nullable(),
});

const PortfolioList = z.object({
  organizations: z.array(z.object({ name: z.string(), projects: z.array(ProjectSummary) })),
  freshness: Freshness,
  analysis: z.object({ complete: z.number().int().nonnegative(), pending: z.number().int().nonnegative() }),
});

const Release = z.object({ tag: z.string(), url: z.string(), prerelease: z.boolean() });

export const OPERATIONS = {
  'situation.read': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/situation' },
    input: z.object({}),
    output: z.object({
      /** `null` when no session exists. */
      account: Account.nullable(),
      host: z.object({ origin: z.string(), name: z.enum(['QA', 'Production']), development: z.boolean() }),
      portfolio: z
        .object({
          projects: z.number().int().nonnegative(),
          writable_organizations: z.number().int().nonnegative(),
          needs_attention: z.number().int().nonnegative(),
          awaiting_check: z.number().int().nonnegative(),
          last_loaded_at: z.string(),
        })
        .nullable(),
      configured: z.boolean(),
    }),
  },
  'portfolio.list': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/portfolio' },
    input: z.object({
      /** `supported` (the default) lists Scripture Burrito Bible and Open Bible Stories projects only; `all` adds every unsupported writable repository (ADR 0014). */
      show: z.enum(['supported', 'all']).optional(),
      organization: z.string().optional(),
      language: z.string().optional(),
      project_type: ProjectType.optional(),
      health_state: HealthState.optional(),
      sort: z.string().optional(),
    }),
    output: PortfolioList,
  },
  'project.read': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/projects/{owner}/{repo}' },
    input: RepoRef,
    output: ProjectReport,
  },
  'project.refresh': {
    kind: 'read',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/refresh' },
    input: RepoRef,
    output: ProjectReport,
  },
  'project.create.plan': {
    kind: 'plan',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/plan' },
    input: z.object({
      owner: z.string().min(1),
      project_type: z.enum(['bible', 'obs']),
      title: z.string().min(1),
      abbreviation: z.string().min(1),
      language: ChosenLanguage,
      testament_scope: CoverageScope.extract(['nt', 'ot', 'full']).nullable(),
      license: z.literal('cc-by-sa-4.0'),
    }),
    output: plan(
      z.object({
        repo_name: z.string(),
        metadata_json: z.record(z.string(), z.unknown()),
        files: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative(), md5: z.string() })),
      }),
    ),
  },
  'project.create.apply': {
    kind: 'apply',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects' },
    input: PlanId,
    output: receipt(ProjectReport),
  },
  'project.create.retry': {
    kind: 'apply',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/setup/retry' },
    input: RepoRef,
    output: receipt(ProjectReport),
  },
  'release.plan': {
    kind: 'plan',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/releases/plan' },
    input: RepoRef,
    output: plan(
      z.object({
        books: z.array(z.object({ id: z.string(), group: CandidateGroup, selection: SelectionState })),
        removals: z.array(z.string()),
        administrative: z.array(z.string()),
        version: z.object({ baseline_tag: z.string().nullable(), proposed: z.string(), rule_applied: VersionRule }),
        notes_draft: z.string(),
      }),
    ),
  },
  'release.prepare': {
    kind: 'apply',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/preparations' },
    input: RepoRef.extend({
      plan_id: z.string().min(1),
      selection: z.record(z.string(), SelectionState),
      unknown_included: z.array(z.string()),
      version: z.string().nullable(),
    }),
    output: receipt(Preparation),
  },
  'preparation.read': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/projects/{owner}/{repo}/preparations/{preparation_id}' },
    input: PreparationRef,
    output: Preparation,
  },
  'release.create': {
    kind: 'apply',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/preparations/{preparation_id}/release' },
    input: PreparationRef.extend({
      version: z.string().min(1),
      notes: z.string(),
      prerelease: z.boolean(),
      acknowledge_warnings: z.boolean(),
    }),
    output: receipt(Preparation).extend({ acknowledged_warnings: z.boolean() }),
  },
  'release.lookup': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/projects/{owner}/{repo}/releases/{tag}' },
    input: TagRef,
    output: z.object({ found: z.boolean(), release: Release.extend({ target_sha: z.string() }).nullable() }),
  },
  'release.promote': {
    kind: 'apply',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/releases/{tag}/promote' },
    input: TagRef,
    output: receipt(Release.extend({ prerelease: z.literal(false) })),
  },
  'preparation.discard': {
    kind: 'apply',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/preparations/{preparation_id}/discard' },
    input: PreparationRef,
    output: receipt(Preparation),
  },
  'upload.plan': {
    kind: 'plan',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/uploads/plan' },
    input: RepoRef.extend({
      files: z.array(z.object({ name: z.string().min(1), size: z.number().int().nonnegative(), content_ref: z.string().min(1) })),
    }),
    output: plan(z.object({ files: z.array(PlannedFile), metadata_diff: z.unknown(), unknown: z.array(z.string()) })),
  },
  'upload.apply': {
    kind: 'apply',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/uploads' },
    input: RepoRef.extend({ plan_id: z.string().min(1), confirmations: z.record(z.string(), Unit) }),
    output: receipt(ProjectReport),
  },
  'owner.search': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/owners' },
    input: z.object({ q: z.string().nullish() }),
    output: z.object({ own: z.array(Account), matches: z.array(Account), freshness: Freshness }),
  },
  'source.search': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/sources' },
    input: z.object({ owner: z.string().min(1), stage: z.enum(['prod', 'latest']) }),
    output: z.object({
      sources: z.array(
        z.object({
          ref: RepoRef,
          title: z.string(),
          language: Language,
          project_type: ProjectType,
          metadata_format: MetadataFormat,
          stage: z.enum(['prod', 'latest']),
          revision: z.union([z.object({ tag: z.string(), sha: z.string() }), z.object({ branch: z.string(), sha: z.string() })]),
          released: z.boolean(),
          books: z.array(z.object({ id: z.string(), title: z.string() })).nullable(),
        }),
      ),
      freshness: Freshness,
    }),
  },
  'import.plan': {
    kind: 'plan',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/imports/plan' },
    input: RepoRef.extend({
      source: RepoRef.extend({ revision: z.string().min(1) }),
      units: z.union([z.array(z.string()), z.literal('all')]),
    }),
    output: plan(
      z.object({ source: RepoRef.extend({ revision: z.string() }), files: z.array(PlannedFile), metadata_diff: z.unknown() }),
    ),
  },
  'import.apply': {
    kind: 'apply',
    milestone: 1,
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/imports' },
    input: RepoRef.extend({ plan_id: z.string().min(1) }),
    output: receipt(ProjectReport),
  },
  'metadata.plan': { kind: 'plan', milestone: 2, route: null, input: null, output: null },
  'metadata.apply': { kind: 'apply', milestone: 2, route: null, input: null, output: null },
  'project.create.resume': { kind: 'apply', milestone: 2, route: null, input: null, output: null },
} as const satisfies Record<string, OperationDefinition>;

export type OperationName = keyof typeof OPERATIONS;
export const OPERATION_NAMES = Object.keys(OPERATIONS) as OperationName[];

/** The operations with a route and schemas: Milestone 1. */
export type RoutedOperation = {
  [Name in OperationName]: (typeof OPERATIONS)[Name]['route'] extends null ? never : Name;
}[OperationName];

type Definition<Name extends RoutedOperation> = (typeof OPERATIONS)[Name];
/** What a caller sends. */
export type OperationInput<Name extends RoutedOperation> = z.input<NonNullable<Definition<Name>['input']>>;
/** What an implementation receives, after validation. */
export type ParsedInput<Name extends RoutedOperation> = z.output<NonNullable<Definition<Name>['input']>>;
export type OperationOutput<Name extends RoutedOperation> = z.output<NonNullable<Definition<Name>['output']>>;

/** The path fields of a route template, in order. */
export function routeParams(path: string): string[] {
  return [...path.matchAll(/\{([a-z_]+)\}/g)].map(match => match[1]!);
}
