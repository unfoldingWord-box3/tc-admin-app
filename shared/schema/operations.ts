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
  /** How a `POST` sends its input: a JSON body unless this says `multipart`, a `multipart/form-data` body carrying file bytes (`upload.plan`, Q33). */
  body?: 'multipart';
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

/**
 * The translation details of a Bible project: the three fields the Scripture Burrito
 * `textTranslation` flavor requires beyond its books (E44), spelled as the schema
 * spells them because they are written to `type.flavorType.flavor` as given. The
 * wizard shows them with the defaults preselected, and a client that sends none
 * gets the defaults (decided 5 October 2026 by Rich, Q4).
 */
export const TEXT_TRANSLATION_PROJECT_TYPES = ['standard', 'daughter', 'studyBible', 'studyBibleAdditions', 'backTranslation', 'auxiliary', 'transliterationManual', 'transliterationWithEncoder'] as const;
export const TEXT_TRANSLATION_TYPES = ['firstTranslation', 'newTranslation', 'revision', 'studyOrHelpMaterial'] as const;
export const TEXT_TRANSLATION_AUDIENCES = ['basic', 'common', 'common-literary', 'literary', 'liturgical', 'children'] as const;
export const TextTranslationFlavor = z.object({
  projectType: z.enum(TEXT_TRANSLATION_PROJECT_TYPES).optional(),
  translationType: z.enum(TEXT_TRANSLATION_TYPES).optional(),
  audience: z.enum(TEXT_TRANSLATION_AUDIENCES).optional(),
});
export type TextTranslationFlavor = z.infer<typeof TextTranslationFlavor>;
/** What is written when a client sends none: Scribe's values for a new project (E17, Q4). */
export const TEXT_TRANSLATION_FLAVOR_DEFAULTS = { projectType: 'standard', translationType: 'firstTranslation', audience: 'common' } as const satisfies Required<TextTranslationFlavor>;

/** One language as `language.list` offers it (E25), with whether the Scripture Burrito schema accepts its tag (E44, Q30). */
const ListedLanguage = z.object({
  code: z.string(),
  title: z.string(),
  english: z.string(),
  direction: z.enum(['ltr', 'rtl']).nullable(),
  alternates: z.array(z.string()),
  tag_accepted: z.boolean(),
});
const Account = z.object({ login: z.string(), name: z.string() });
const Unit = z.union([z.object({ book: z.string() }), z.object({ story: z.string() })]);
const PlanId = z.object({ plan_id: z.string().min(1) });
const PreparationRef = RepoRef.extend({ preparation_id: z.string().min(1) });
const TagRef = RepoRef.extend({ tag: z.string().min(1) });

/**
 * A file of an upload or import (`upload.plan`, `import.plan`). A file held back, `identified: null`, has no
 * `path`: nothing is written for it until the manager names its book or story. `size` and `md5` are those of
 * the bytes received, which the apply receives again and matches (Q33). `diff` is a unified text diff against
 * the default branch's file when the file overwrites one and a diff is practical, `''` when the bytes are the
 * branch's own, and `null` otherwise.
 */
const PlannedFile = z.object({
  name: z.string(),
  identified: Unit.nullable(),
  path: z.string().nullable(),
  size: z.number().int().nonnegative(),
  md5: z.string(),
  overwrite: z.boolean(),
  diff: z.string().nullable(),
});

/** One ingredient entry an upload adds or replaces in `metadata.json`: the entry as it stands (`null` when new) and as it will be (R10). */
const MetadataEntryChange = z.object({
  path: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()),
});

/**
 * How `upload.plan`'s files travel (operations.md §7, Q33): a `multipart/form-data` body with, for the file at
 * index `i`, the parts `files.<i>.name`, `files.<i>.mode` (optional, decimal), and `files.<i>.content` (the bytes),
 * and an optional `confirmations` part holding the confirmations as JSON.
 */
export const UPLOAD_FILE_FIELDS = ['name', 'mode', 'content'] as const;
export type UploadFileField = (typeof UPLOAD_FILE_FIELDS)[number];
export const uploadPartName = (index: number, field: UploadFileField): string => `files.${index}.${field}`;
export const UPLOAD_CONFIRMATIONS_PART = 'confirmations';
/** A file's bytes, as the HTTP projection reads them from a multipart part: any `Uint8Array`. */
const FileBytes = z.custom<Uint8Array>(value => value instanceof Uint8Array, { message: 'expected the file\'s bytes as a file part' });

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
      /** Bible only; absent fields take the defaults. For an Open Bible Stories project it is absent, `null`, or empty. */
      flavor: TextTranslationFlavor.nullish(),
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
    /** The plan whose first commit is retried, which is also the idempotency key (operations.md §1 rule 6, §7). */
    input: RepoRef.extend({ plan_id: z.string().min(1) }),
    output: receipt(ProjectReport),
  },
  'language.list': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/languages' },
    /** With an owner, the tags of the languages that owner already has repositories in are returned too, for the wizard to show first (Q20). */
    input: z.object({ owner: z.string().nullish() }),
    output: z.object({ languages: z.array(ListedLanguage), owner_languages: z.array(z.string()).nullable(), freshness: Freshness }),
  },
  'owner.list': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/owners/writable' },
    input: z.object({}),
    /** The owners the account may create a project in (E43), organizations by name and the account last; nothing else is offered (decided 6 October 2026). */
    output: z.object({ owners: z.array(Account.extend({ kind: z.enum(['organization', 'account']) })), freshness: Freshness }),
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
  'preparation.list': {
    kind: 'read',
    milestone: 1,
    route: { method: 'GET', path: '/api/projects/{owner}/{repo}/preparations' },
    input: RepoRef,
    /** The project's stored preparations, newest first, each as last stored (decided 8 October 2026 by Rich, #125); `preparation.read` gives one live. */
    output: z.object({ preparations: z.array(Preparation), freshness: Freshness }),
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
    route: { method: 'POST', path: '/api/projects/{owner}/{repo}/uploads/plan', body: 'multipart' },
    input: RepoRef.extend({
      // `mode`: the POSIX file mode the client read, when it has one; a browser reports none (W6, #73). `content`: the file's bytes,
      // sent in the request and never stored; a file's size is the length of its bytes (Q33).
      files: z.array(z.object({ name: z.string().min(1), mode: z.number().int().min(0).max(0o177777).nullish(), content: FileBytes })).min(1),
      /** The manager's choice of book or story for a file, by its name: the same confirmations `upload.apply` takes, so the plan shows what they write. */
      confirmations: z.record(z.string(), Unit).optional(),
    }),
    output: plan(z.object({ files: z.array(PlannedFile), metadata_diff: z.object({ ingredients: z.array(MetadataEntryChange) }), unknown: z.array(z.string()) })),
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
