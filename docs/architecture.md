# tC Admin Architecture

Status: Accepted planning baseline. Amended 18 September 2026 with the layer tower, the operation layer, and the module map (ADR 0011, ADR 0012). Amended 1 October 2026 (proposed) for import, upload, and the three-state selection (ADR 0013); accepted when that pull request merges. Section 10 fixed by #7 on 1 October 2026.

## 1. System shape

```text
Manager browser
    │  HTTPS, secure session cookie
    ▼
Hosted web frontend
    │  same-origin application API
    ▼
Cloudflare Worker (tC Admin backend-for-frontend)
    ├─ Door43 OAuth callback and session handling
    ├─ Project/repository adapter
    ├─ Metadata and file-operation workflows
    ├─ Scripture Burrito model fed by Door43 Scripture Burrito archives
    ├─ Health-check adapter
    ├─ Release snapshot orchestrator
    └─ Error/idempotency boundaries
             │
             ├─ Door43 Swagger v1 API
             └─ Door43 health-check service
```

The frontend is a hosted web application. The Worker is the trust boundary for Door43 credentials and all mutations. The implementation should follow the newer unfoldingWord application pattern: a web frontend plus a server-side Worker rather than browser-held DCS tokens.

### Layers

The system is a tower of five layers. Each layer speaks only to the one below it, and each has one vocabulary.

| Layer | Owns | Vocabulary | Never |
| --- | --- | --- | --- |
| 5 Presentation (`web/`) | portfolio, wizard, stepper, copy | glossary terms | decides permission, health, or release contents |
| 4 Operations (`worker/src/operations/`) | the [operation catalog](operations.md): reads, plans, applies, receipts, errors, preconditions | glossary identifiers | calls Door43 except through the adapter |
| 3 Domain model (`worker/src/model/`) | Scripture Burrito reader and writer, project classification, coverage, candidates, version rules, state machines | glossary identifiers | performs I/O |
| 2 Door43 adapter (`worker/src/door43/`) | OAuth, API client, pagination, archive download, health read | Door43's own shapes, which stop here | interprets health or permission |
| 1 Door43 | identity, permissions, files, history, releases, health | Gitea and DCS | — |

A sixth surface, an MCP server for agent clients, is deferred; it would be another consumer of layer 4 with no logic of its own. Types cross layers through one shared schema package (`shared/schema`), which is the executable form of the catalog and the only source of API types for `web/`, `worker/`, and tests.

### Principle: one catalog, many surfaces

Everything tC Admin can do is a named operation (ADR 0011). A read returns a complete situation with provenance and age on every derived fact. A mutation is a plan that announces its writes without writing, and an apply that performs exactly those writes and returns a receipt. The UI is one projection of the catalog; tests exercise the catalog directly against recorded fixtures (ADR 0012). The invariants in [invariants.md](invariants.md) are enforced in layers 3 and 4, once.

## 2. Frontend responsibilities

The frontend owns:

- Portfolio layout, organization grouping, sorting, and filters.
- Project pills and accessible health indicators.
- Async loading and refresh states.
- Creation wizard and structured metadata form.
- Upload selection, overwrite warnings, diffs, and final summaries.
- Release stepper, candidate review, release-note editing, and promotion controls.
- Preservation of unsaved form state across re-authentication where safe.

The frontend must not:

- Store Door43 access tokens in local storage, IndexedDB, URLs, or JavaScript-visible state.
- Decide whether a user has Door43 write permission.
- Decide whether a health result is release-safe.
- Construct release contents without a server-confirmed candidate.

## 3. Worker responsibilities

### Authentication

1. Redirect the manager to Door43 OAuth.
2. Receive the authorization callback.
3. Exchange the code server-side.
4. Resolve the Door43 account and create a short-lived application session.
5. Use a secure HttpOnly session cookie for browser requests.
6. Remove the session and credential material on logout or expiry.

The DCS credential may be held only in a short-lived protected server session as required to call Door43. It must not be exposed to browser JavaScript or retained as a long-term application credential.

### Authorization

The Worker must treat Door43 as live authority:

- Discover organizations and repositories using the authenticated account.
- Filter the portfolio to repositories with write access.
- Re-check access before repository creation, file commits, metadata commits, branch changes, release creation, and promotion.
- Fail closed when permission status is ambiguous.

### Project adapter

Provide a narrow internal interface over the Door43 API for:

- Owner and writable-repository discovery, including the account's own repositories
- Catalog owner search and catalog search by owner and flavor, for import sources (E35)
- Repository metadata and default branch
- File tree and raw file reads
- File create/update operations
- Commit and branch/ref reads
- Temporary branch creation and deletion
- Release and tag reads
- Release creation and promotion/editing
- Door43 compare and history links
- Scripture Burrito archive download for any ref of any repository (`GET /api/v1/repos/{owner}/{repo}/sb/{ref}.zip`, E34, also served as the web route `/{owner}/{repo}/sb/{ref}.zip`), for imports and for a release's included books

Keep the Swagger-generated/API-specific shapes at the adapter boundary. The product and domain layers should use tC Admin concepts such as `Project`, `ProjectMetadata`, `Ingredient`, `Book`, `Story`, `ReleaseSnapshot`, and `ProjectVersion`.

### Operation layer

The operation layer is the catalog in [operations.md](operations.md), one module per operation. Shared preconditions run first for every apply: session valid, CSRF token present (A4), permission re-read from Door43 and failing closed (A2), plan not expired, and the plan's `bound_to` SHAs unchanged (R5). Every apply performs only the writes its plan announced and returns a receipt listing them (R3, W5). Every error thrown anywhere below is mapped to one code from the error catalog with the specification's message, `retryable`, `next_action`, and a request id (X2).

Three resources carry state across calls:

- The **project report** (`project.read`) is the complete situation of one project: type, format, editability with reason, coverage with basis, health with provenance, latest full release, default-branch head, active preparation, setup state, permissions, freshness. Type, coverage, and health come from the catalog metadata in Door43's repository search, which is the same for every project type (E12, Q17); no archive is downloaded for a portfolio or a project report.
- A **plan** is bound to the source SHAs it was computed from, lists `would_write`, expires, and is the idempotency key of its apply. Plans live in Workers KV for their lifetime; a release plan is small because it holds tree comparisons, not archives, which `release.prepare` downloads when it needs the bytes (E17: about one second and 1.5 MB for a 66-book Bible).
- A **preparation** is the release state machine in [domain-model.md](domain-model.md) §6 as an addressable record: state, binding, selection, snapshot, health, version, notes, release, last error, history. `preparation.read` is how the UI polls and how a lost session, a support engineer, or an agent resumes.

### Health adapter

Door43 runs the health check automatically on every branch push and tag; there is no trigger endpoint. The adapter reads `GET /repos/{owner}/{repo}/healthcheck?ref=` and polls after a push: every 5 seconds for up to 3 minutes, then returns a running state and lets the manager refresh. The response shape, the severity vocabulary (`error`, `warning`, `info`, `success`), and the 422 answer for a ref without a result are recorded as E15; the rule sets differ by metadata format.

The health adapter accepts a repository/ref target and returns:

- Running state
- Successful health result
- Authoritative findings and severities
- Door43 unavailable/error state
- Timestamp and target ref

The UI should receive normalized data, while the raw service response remains available for diagnostics. A health error is not equivalent to a healthy result.

### Snapshot orchestrator

The orchestrator must:

1. Read the latest full release tag and the current default branch head; bind preparation to the default-branch commit SHA.
2. Detect new, changed released, unchanged, administrative, and unknown files by comparing the recursive git trees of the two refs book by book (E19), mapping book code to path through each ref's catalog entry (E20). Give each book its default selection state (R4). This is the plan; nothing is downloaded yet.
3. On prepare, download the Scripture Burrito archive for the default branch and, when a release exists, for the latest full release tag (E17); the archive is the source of included books' bytes (ADR 0008).
4. Create `temp-tca-release/<version>` from the latest full release tag, or from the default branch head for a first release or an Open Bible Stories release (ADR 0010).
5. Make the branch match the selection in one or more commits (Q22): carried-forward books are already present from the tag and are not touched; included books are uploaded one at a time from the default-branch archive, spread over several commits when they exceed one request; books left out are deleted from the branch and listed as removals (R2); refreshed root files and administrative ingredients and the merged `metadata.json` (exactly the released books, size and md5 recomputed for every file, scope set to the released books) complete the tree. For Open Bible Stories only `metadata.json` is refreshed.
6. Push each commit with the multi-file contents endpoint; the plan announced their number.
7. Poll the health check for the temporary branch.
8. Re-check the default-branch SHA before release creation.
9. Create the tag and Door43 release targeting the snapshot commit.
10. Delete the temporary branch only after successful release creation.

If the source SHA changes, the orchestrator must stop and return a restart-required result. It must never silently merge the new project state into an already reviewed candidate.

## 4. Data ownership and storage

### Door43-owned

- Users and OAuth authorization
- Organization and repository permissions
- Repository files and commits
- Branches, tags, releases, and release notes
- Repository health service results as the authoritative source

### tC Admin-owned

- Session state needed to operate the hosted application
- User display preferences such as sorting and filters
- Temporary workflow state needed to render an active wizard
- Normalized transient health/repository metadata where caching improves the experience

tC Admin must not become a content database or a second release-history database. Cached metadata must have freshness and invalidation rules, and stale data must be labeled.

## 5. File and metadata safety

- Normalize and validate repository-relative paths.
- Reject absolute paths, traversal, symlinks, and unsupported unsafe file types.
- Enforce Worker and Door43 size limits before mutation.
- Build an upload operation plan before writing any file.
- Require explicit confirmation for overwrites and unknown-file inclusion.
- Commit accepted file changes together.
- Identify each uploaded or imported file as a book or story from its header and name; require manager confirmation; hold back a file that identifies nothing.
- Never write to a repository that is not a Scripture Burrito project tC Admin manages; an import reads the source repository's archive and writes only the destination project (W2). A release touches only the temporary branch, the tag, and the Door43 release.
- Never provide a Scripture/OBS text editor in version one.

## 6. Release safety and idempotency

### Stale source protection

Every release preparation stores the source default-branch commit SHA. Before snapshot creation and again before release creation, the Worker verifies that the source has not moved.

### Duplicate release protection

When release creation returns an ambiguous network result, the Worker queries Door43 for the expected tag/release. If it exists, tC Admin displays it and does not create another release.

### Branch lifecycle

- Create branch: preparation begins.
- Retain branch: health failure, commit failure, or release failure.
- Delete branch: only after release creation succeeds.
- Promotion: acts on the existing Door43 release/tag and does not rebuild contents.

## 7. Failure model

All mutations return normalized, user-actionable errors with an internal request ID. Never silently retry a mutation whose outcome is unknown (X1). The complete list of codes, messages, and next actions is the error catalog in [operations.md](operations.md) §6; product spec §11 maps each required behavior to its code.

Required user-visible behaviors:

- Door43 unavailable: `Door43 is unavailable currently. Please refresh later.`
- Commit failure: `Commit failed: <error message>.`
- Concurrent change: `Project has been edited. The release process will need to restart.`
- Promotion failure: `Pre-release promotion failed. <error message>.`

Diagnostics may include request ID, project, commit SHA, version, target ref, health status, and Door43 response status. They must exclude file contents, OAuth tokens, and secrets.

## 8. Security requirements

- OAuth authorization-code flow with server-side code exchange.
- Secure, HttpOnly, SameSite session cookie.
- CSRF protection on browser mutations.
- No token in URL, local storage, IndexedDB, or client logs.
- Least-privilege Door43 scopes: `read:user write:repository write:organization write:user`, each needed by a Milestone 1 operation (Q10; `write:user` for a project under the manager's own account, Q28), requested explicitly at sign-in because Gitea grants full access when none is asked.
- Live permission checks at mutation boundaries.
- Path traversal and symlink defenses for uploads.
- No automatic repository deletion.
- Redacted operational diagnostics.
- Accessible UI that does not use color as the only health signal.

## 9. Non-functional targets

- Hosted web app, desktop-first and responsive on smaller screens.
- WCAG 2.2 AA target.
- Support typical portfolios of 1–50 repositories and remain usable beyond 100.
- Dashboard load and refresh must show asynchronous progress rather than blocking the whole portfolio on one repository.
- Production Door43 is the normal deployment target; QA hosts are deployment configuration for testing.
- Architect for future interface localization; English is the initial interface language.

## 10. Repository layout and module map

Fixed by [#7](https://github.com/unfoldingWord-box3/tc-admin-app/issues/7) on 1 October 2026; the invariants and traceability documents cite these paths. One module per operation and per model concept keeps each change small enough to read whole. Each file is named for its concept or its operation, with the dots of the operation name as hyphens (`release.prepare` is `operations/release-prepare.ts`). Modules marked *planned* are created by the issue in brackets.

```text
package.json         npm workspaces (shared, worker, web); `npm run check`, `build`, `dev`
wrangler.jsonc       the Worker, its assets (web/dist), and the qa and production environments (deployment.md §1)
.oxlintrc.json       lint, including the layer rules below as import restrictions
.env.example         every local variable, no values
shared/              @tc-admin/shared
  schema/            the operation catalog as Zod schemas and their types (ADR 0011)
    operations.ts    every operation: kind, milestone, route, input, output
    errors.ts        the error catalog, the error shape, CatalogError
    common.ts        freshness, references, plan, receipt
    project.ts       project report and classification
    preparation.ts   release preparation
    states.ts        the state identifiers of the catalog §5
  test/              the schema against docs/operations.md and CONTEXT.md
worker/
  src/index.ts       the Worker: /api/ and /auth/ to the HTTP projection, everything else to the web assets
  src/env.ts         bindings and variables
  src/door43/        Door43 shapes stop here
    host.ts          the configured host, QA or production only
    api.ts           reads with the session token, pagination (P1)
    auth.ts          OAuth with PKCE, code exchange, the signed-in account from /user
    repos.ts         repository search and permissions read strictly (P2); whether a name is taken; the account's creation rights (E43)
    catalog.ts       the catalog view of a repository (#19)
    archive.ts       the Scripture Burrito archive of a ref, opened from its central directory, each file inflated on demand (E34, E4, E53; #18)
    languages.ts     the full language list and an owner's languages, in glossary names (E25; #28)
    writes.ts        repository creation and the multi-file commit, sent once and never retried, no delete (W5, X1, A3, W4; #30)
                     planned: health (#36), branches, tags, releases (#34, #39)
  src/model/         no I/O
    books.ts         book and story ids (#19)
    language.ts      the language tag rule of the Scripture Burrito schema (E44, Q30; #28)
    project.ts       type, editability, coverage (#19)
    health.ts        Door43 severity to health state (H1, H3)
    burrito.ts       the Scripture Burrito writer: a new Bible or Open Bible Stories project's metadata and files (#29, #82, W1, R10), and the release merge (#35, Q7, Q8)
    burrito-reader.ts  the Scripture Burrito reader: a project's metadata.json as read, every ingredient classified as book, story, or administrative (#17)
    classify.ts      every file of a ref as a book, story, administrative, or unknown file, given its metadata and tree (#20, R1, S5)
    obs-scope.ts     the fixed currentScope of every Open Bible Stories project (E46)
    md5.ts           ingredient checksums (R10)
    license-cc-by-sa-4.0.ts  the license text of ingredients/license.md (Q20)
                     planned: upload identification (#45), candidates (#33), version (#37), states
  src/operations/    one module per catalog operation, plus shared preconditions
    index.ts         the built operations by name
    context.ts       what every operation receives, with the session's Door43 client (A3)
    sign-in.ts       begin and complete sign-in for http/session; not catalog operations (#12)
    situation-read.ts  situation.read; the account from /user when signed in
    portfolio-list.ts  the writable filter (P1, P2); the operation: #23
    plans.ts         plans and receipts in Workers KV, by plan id (operations.md §2)
    project-create-plan.ts  project.create.plan (#29)
    project-create-apply.ts  project.create.apply: the first Door43 writes, idempotent by plan id (#30)
    language-list.ts  language.list: the wizard's language list, each tag marked as accepted or not (#28)
    owner-list.ts    owner.list: the owners the account may create a project in, from its teams (E43, A2; #28)
                     planned: one module per remaining operation; preconditions (#14)
  src/http/          the HTTP projection: routes are the catalog's
    app.ts           Hono: one route per operation from shared/schema; validate input, run, validate output, answer (Q27)
    errors.ts        every failure to the error shape (X2, X3)
    session.ts       /auth/login, /auth/callback, /auth/logout; the token in Workers KV under a hash of the cookie (A1)
    csrf.ts          same-origin and CSRF token checks ahead of every POST (A4)
  test/              model/, door43/, operations/, http/, contract/ (against fixtures)
web/
  src/api/client.ts  typed client: one call per operation, from shared/schema
  src/               the application shell; portfolio, wizard, stepper, design system (#8)
  src/CreateProject.tsx, src/create-project.ts  the creation wizard, and its form logic, owners, language search, and field errors as pure functions (#28)
  src/ProjectView.tsx  one project's report, shown from the portfolio and after creation
  test/
fixtures/
  door43/            recorded responses and archives, each with host, ref, and date (ADR 0012)
scripts/
  check-docs.mjs     the document check
  probe/             live Door43 probes that write to docs/evidence.md: qa-write-probe (the release writes),
                     qa-create-probe (project.create.plan and apply through the Worker's own code, #30)
                     planned: seed-qa (#3)
docs/                this tower
prototypes/door43-mcp  a Door43 MCP proof of concept, not a deliverable; prototypes/tc-admin was retired by #7
```

The layers of section 1 are enforced by lint: `model/` imports nothing from `door43/`, `operations/`, `http/`, or `node:`; `door43/` nothing from `operations/` or `http/`; `operations/` nothing from `http/`; `http/` nothing from `door43/` or `model/`; `shared/schema/` nothing from `worker/`, `web/`, or `node:`; `web/` nothing from `worker/`. The adapter may read the model's input types, since it produces them.

Rule of placement: if a module imports a Door43 shape, it belongs in `door43/`. If it has no I/O, it belongs in `model/`. If it decides preconditions or writes, it belongs in `operations/`. If it renders, it belongs in `web/`.

## 11. External implementation references

- [Door43 API Swagger](https://git.door43.org/swagger.v1.json)
- [Scripture Burrito specification](https://docs.burrito.bible/)
- [Resource Container manifest specification](https://resource-container.readthedocs.io/en/latest/manifest.html) (read-only mapping)
- [Door43 RC-to-SB converter](https://github.com/unfoldingWord/go-rc2sb), used by Door43's Scripture Burrito archive
- [Door43 health-check service](https://github.com/unfoldingWord/dcs/tree/release/dcs/v1.27/services/door43healthcheck)
- [Reference release tooling](https://github.com/unfoldingWord-dev/release_uw_resources)
- [Newer unfoldingWord application pattern](https://github.com/unfoldingWord/bible-editor)
