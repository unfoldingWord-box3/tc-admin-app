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
- A **preparation** is the release state machine in [domain-model.md](domain-model.md) §6 as an addressable record: state, binding, selection, snapshot, health, version, notes, release, last error, history. `preparation.read` is how the UI polls and how a lost session, a support engineer, or an agent resumes; `preparation.list` is how they find a preparation's id again, from the store by project (#125).

### Health adapter

Door43 runs the health check automatically on every branch push and tag; there is no trigger endpoint. The adapter reads `GET /repos/{owner}/{repo}/healthcheck?ref=` once per `preparation.read`; the client polls after a push, every 5 seconds for up to 3 minutes (`HEALTH_POLL` in the shared schema, the numbers #5 recorded, E28), and then offers the manager a refresh; a 422 before the check has run is a running state, however long after the push. The response shape, the severity vocabulary (`error`, `warning`, `info`, `success`), and the 422 answer for a ref without a result are recorded as E15; the rule sets differ by metadata format.

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

Concurrency (decided 7 October 2026 by Rich): plans, receipts, and preparations live in Workers KV, which offers no compare-and-set, so two calls that overlap on one preparation can each store the state it read, and the later write wins. Milestone 1 accepts this: a project has one manager preparing one release at a time, the interface disables its buttons while a call is in flight, every apply re-reads Door43 before it writes, and a receipt stored under its key answers a repeated request. If the pilot shows overlapping writes, the preparation moves to a store with a precondition (a Durable Object), a Milestone 2 change recorded as an ADR. Listing is eventually consistent too: `preparation.list` may miss a preparation stored a moment ago, or show the state before the last write, so the stepper holds the preparation it made from its receipt and never relies on the list for it (#125).

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
  src/env.ts         bindings and variables; of KV, get, put, delete, and the key listing by prefix, a page at a time (#125)
  src/door43/        Door43 shapes stop here
    host.ts          the configured host, QA or production only
    api.ts           reads with the session token, pagination (P1)
    auth.ts          OAuth with PKCE, code exchange, the signed-in account from /user
    archive.ts       the Scripture Burrito archive of a ref, opened from its central directory, each file inflated on demand (E34, E4, E53; #18)
    repos.ts         repository search and permissions read strictly (P2); one repository; whether a name is taken; the account's creation rights (E43)
    catalog.ts       the catalog view of a repository (#19); its stages and the catalog entry of one ref (E14, E20; #33)
    trees.ts         the recursive git tree of a ref, every page; its own sha is the tree's, not a commit's (E19, E52, E63; #33)
    languages.ts     the full language list and an owner's languages, in glossary names (E25; #28)
    owners.ts        the owners an import can come from: the account's organizations, every page, and the catalog's owners by partial name, every match in one answer (E43, E35, E61; #77)
    writes.ts        repository creation and the multi-file commit, uploads and deletions by blob SHA, sent once and never retried (W5, X1, A3, W4; #30, #34); a created repository's state for the retry (#31)
    branches.ts      the temporary branch a release is prepared on, created from a commit; one already there is preparation_active (E21, E27; #34); its deletion after the release, reported and never thrown (R7; #39, #58); a branch's head commit, for the retry of a first commit (E63; #31)
    health.ts        the health check of one ref, read once per call: a result with its issues, pending, unavailable, or an error (E15, E28; #36)
    releases.ts      one release by its tag, with the commit it targets (E21, E20, R6; #40), and with when and by whom it was published, for a project report (#75); the release created on the snapshot commit, tag and all, and the one edit that promotes it (E27, R8; #39)
    catalog-search.ts  an owner's Bible and Open Bible Stories catalog entries at a stage, every page, with each repository's stages (E35, E14; #78)
  src/model/         no I/O
    books.ts         book and story ids (#19)
    language.ts      the language tag rule of the Scripture Burrito schema (E44, Q30; #28)
    project.ts       type, editability, coverage (#19); the books or stories a ref offers as an import source (H3; #78)
    health.ts        Door43 severity to health state, and one health-check read to a health value (H1, H3; #25, #36)
    burrito.ts       the Scripture Burrito writer: a new Bible or Open Bible Stories project's metadata and files (#29, #82, W1, R10), a book's or story's path and ingredient entry (#72, W1), the metadata an upload proposes, its entries added or replaced with the new bytes' size and md5 (#74, R10), and the release merge (#35, Q7, Q8)
    burrito-reader.ts  the Scripture Burrito reader: a project's metadata.json as read, every ingredient classified as book, story, or administrative (#17)
    classify.ts      every file of a ref as a book, story, administrative, or unknown file, given its metadata and tree (#20, R1, S5)
    obs-scope.ts     the fixed currentScope of every Open Bible Stories project (E46)
    md5.ts           ingredient checksums (R10)
    git-blob.ts      git blob ids, whether a ref holds exactly a plan's files (X1; #31), and whether it holds an upload's planned files among others (X1; #75)
    license-cc-by-sa-4.0.ts  the license text of ingredients/license.md (Q20)
    candidates.ts    candidate detection by blob SHA, the R4 defaults, removals, administrative files (#33)
    version.ts       the version rules: coercion, baseline, increment (R9; #37)
    notes.ts         the release notes draft (#38)
    snapshot.ts      what a release snapshot uploads and deletes, by blob SHA against the ref the branch starts from, in commits of at most 32 MB (R1, R2, Q22; #34)
    upload-paths.ts  an upload batch's names as repository-relative paths, and its entries and sizes checked, before anything else reads it (W6, Q15; #73)
    upload.ts        an uploaded or imported file identified as a book (its \id line, checked against its name) or a story (its name), or held back; a manager's confirmation applied (E36, W1; #72)
    text-diff.ts     the unified line diff an overwrite shows, where practical: text only, bounded in edits, lines, and length (#74)
                     planned: states
  src/operations/    one module per catalog operation, plus shared preconditions
    index.ts         the built operations by name
    context.ts       what every operation receives, with the session's Door43 client (A3)
    sign-in.ts       begin and complete sign-in for http/session; not catalog operations (#12)
    situation-read.ts  situation.read; the account from /user when signed in
    portfolio-list.ts  the writable filter (P1, P2); the operation: #23
    plans.ts         plans and receipts in Workers KV, by plan id; a creation's attempt and the retry's receipt, each in its own key (Q29, #31); preparations by project and id, for thirty days (operations.md §2), and every preparation of a project, through every page of the key listing (#125)
    project-create-plan.ts  project.create.plan (#29)
    project-create-apply.ts  project.create.apply: the first Door43 writes, idempotent by plan id (#30)
    project-create-retry.ts  project.create.retry: the first commit of a setup-incomplete project, once, after reading the repository; a commit already made adopted; Q29's adoption of a repository the plan could not learn of (W4, X1, A2; #31)
    language-list.ts  language.list: the wizard's language list, each tag marked as accepted or not (#28)
    owner-list.ts    owner.list: the owners the account may create a project in, from its teams (E43, A2; #28)
    owner-search.ts  owner.search: the account's organizations first and always, then the catalog's owners by partial name (E35, P3; #77)
    release-plan.ts  release.plan: candidates, defaults, version, notes, bound to both refs (#33)
    release-lookup.ts  release.lookup: is there a release under this tag, and which commit does it target (R6; #40)
    release-prepare.ts  release.prepare: the confirmed selection and version, the snapshot's branch and commits, no more than the plan announced, the preparation stored (#34)
    release-create.ts  release.create: the gates (H2, R9, R5, A2), one release on the snapshot commit, the branch deleted after, a refusal kept for retry, a lost answer never retried, and the tag looked up before any retry after one (R3, R6, R7, X1; #39, #40)
    release-promote.ts  release.promote: one edit of the pre-release flag (R8; #39)
    preparation-discard.ts  preparation.discard: the manager's confirmed abandonment, one branch deletion, the preparation discarded (R7, A2, Q14; #58)
    preparation-list.ts  preparation.list: the push permission first (A2), then the project's stored preparations as stored, newest first, an unparseable record left out (R7; #125)
    preparation-read.ts  preparation.read: the stored preparation, restart_required when the default branch moved (R5), the branch's health and the state it moves to (H1, H2; #36)
    upload-plan.ts   upload.plan: the batch checked first (W6), the project writable and editable (A2, W2), every file identified or confirmed, two for one unit refused, overwrites and diffs from the default branch's tree and archive at its head, the proposed metadata (R10), one commit announced, bound to the head (R5), stored without the bytes (Q33; #74)
    upload-apply.ts  upload.apply: the same files sent again and matched to the plan by size and md5 (Q33), none held back, the plan's confirmations only, permission re-read (A2), still editable (W2), the head still the plan's (R5); one commit with the files and the metadata, create or update by blob, sent once (W5, A3, X1); the attempt recorded first, an unknown outcome never sent again and a landed commit adopted (X1); the receipt by plan id (#75)
    source-search.ts  source.search: an owner's Bible and Open Bible Stories repositories as import sources, at the last release or the default branch (E35, Q25; #78)
                     planned: one module per remaining operation; preconditions (#14)
  src/http/          the HTTP projection: routes are the catalog's
    app.ts           Hono: one route per operation from shared/schema; validate input, run, validate output, answer (Q27)
    errors.ts        every failure to the error shape (X2, X3)
    session.ts       /auth/login, /auth/callback, /auth/logout; the token in Workers KV under a hash of the cookie (A1)
    csrf.ts          same-origin and CSRF token checks ahead of every POST (A4)
    multipart.ts     a multipart body to an operation's plain input: each file's name, mode, and bytes, the confirmations, and the plan id for an operation that names one (upload.plan, upload.apply, Q33); an oversized body refused before it is read (W6)
  test/              model/, door43/, operations/, http/, contract/ (against fixtures); support/ (the recordings reader, a zip builder)
web/
  src/api/client.ts  typed client: one call per operation, from shared/schema; a route that says body: 'multipart' is sent as multipart/form-data, the files' bytes as file parts (upload.plan, Q33)
  src/               the application shell; portfolio, wizard, stepper, design system (#8)
  src/CreateProject.tsx, src/create-project.ts  the creation wizard, and its form logic, owners, language search, field errors, and the retry of an incomplete setup as pure functions (#28, #31)
  src/ReleaseView.tsx  one release by its tag: the lookup and the promotion of a pre-release from its own page, whether or not the stepper that made it is open (S7, R8)
  src/ReleaseStepper.tsx, src/release-stepper.ts  the release stepper: one operation per step, the selection from the plan's defaults, the health poll, the warnings acknowledged, the release and its promotion, the discard; its logic as pure functions (#41); on opening, the preparations under way to continue or discard, a preparation's own address, and the preparation a preparation_active refusal names (#125)
  src/preparations.ts  which preparations are under way and which finished, their words, a preparation's address and links, the preparation a refusal names, as pure functions (#125)
  src/ProjectView.tsx  one project's report, shown from the portfolio and after creation; from the portfolio, its release preparations, each with a link and the discard (#125); "Add books" or "Add stories" opens the upload screen, whose receipt's report replaces the one shown (#76)
  src/UploadScreen.tsx, src/upload.ts  the upload screen: files, a folder, or a drop to upload.plan; the plan shown before any write (each file's book or story, unknown files held back with a choice or to leave out, each overwrite's diff and its own confirmation, the ingredient entries, the warnings, the summary); a choice plans again; the confirmation through applyUpload, the one call to upload.apply; refusals in place; its wording, gate, diff lines, and refusals as pure functions (#76)
  src/HealthFindings.tsx, src/health-findings.ts, src/door43-text.ts  Door43's health findings: the summary when a release is blocked or a warning needs confirmation, each finding's severity as an icon and a word (H4), errors first; Door43's bold, code, and links rendered from tokens, never inserted as HTML (H1, #124)
  test/              the pure functions and the client in Node; mounted components (`*-mounted.test.tsx`, marked `// @vitest-environment jsdom`) under jsdom with Testing Library, the Worker stubbed so each answer arrives in the order a test sets; support/ (the stub and the shapes it answers with)
fixtures/
  door43/            recorded responses and archives, each with host, ref, and date (ADR 0012)
scripts/
  check-docs.mjs     the document check
  probe/             live Door43 probes that write to docs/evidence.md: qa-write-probe (the release writes),
                     qa-create-probe (project.create.plan and apply through the Worker's own code, #30)
                     qa-release-probe (the release flow through the Worker's own code on a seeded repository: plan, prepare, read, create, lookup, promote, discard; E54)
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
