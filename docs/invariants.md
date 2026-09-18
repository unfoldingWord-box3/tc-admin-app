# tC Admin Invariants

Status: proposed 18 September 2026; accepted when the pull request that adds this file merges
Audience: anyone, human or agent, changing tC Admin's design, code, or tests

An invariant is a safety property that must hold in every state of the system. This file is the single list. Every invariant already exists somewhere in the vision, specification, domain model, architecture, or an ADR; this file gives each one an identifier, the place in the code that enforces it, and the test that proves it.

## How to use this file

- **Cite the identifier.** An issue, pull request, test name, or code comment that upholds or touches an invariant names it: `R1`, `H3`. `grep R1` across the repository must find the invariant, its enforcement, and its tests.
- **Test names carry the identifier.** A test that verifies an invariant starts its title with the identifier and a colon: `R1: unselected default-branch changes are absent from the snapshot`.
- **Enforcement lives in one place.** Each invariant names the layer and module that enforces it (see the module map in [architecture.md](architecture.md) §10). Enforce once in the Worker; the UI may mirror the rule for feedback but never owns it.
- **Changing an invariant is a decision.** Weakening, removing, or adding an invariant needs an ADR and an update here. A pull request that changes an enforcement point without keeping its test green is not mergeable.
- **Module paths are the proposed layout** until [#7](https://github.com/unfoldingWord-box3/tc-admin-app/issues/7) lands. Update them when the layout is fixed.

Groups: **R** release safety, **H** health and coverage truthfulness, **A** access and identity, **W** writes and formats, **P** portfolio truthfulness, **X** failure and diagnostics.

## R — Release safety

### R1 — Unselected changes never enter a release
Unselected changes on the default branch never enter a release snapshot. Selected books come from the default-branch archive; every other previously released book comes from the release-tag archive.
Source: product spec §10 snapshot rules; ADR 0003, ADR 0005.
Enforced in: `worker/src/operations/release-prepare` (snapshot assembly); `worker/src/model/candidates` (source of each file).
Verified by: contract test with a fixture where an unselected released book differs between tag and default branch; the snapshot must contain the tag version byte for byte.
Issues: #33, #34.

### R2 — A released book is never removed
A book or story present in the latest full release is present in every later release. A selection that omits it is invalid; a snapshot that lacks it is invalid.
Source: ADR 0010; CONTEXT.md "Carried-forward content".
Enforced in: `worker/src/operations/release-prepare` (selection validation); `worker/src/model/burrito` (metadata merge keeps every released ingredient).
Verified by: selection without a released book returns `invalid_selection`; merged metadata and snapshot tree contain every released ingredient.
Issues: #33, #35.

### R3 — A release never writes to the default branch
The only Door43 writes a release performs are: create the temporary branch, one commit on it, the tag, and the Door43 release. Nothing else, and nothing on the default branch.
Source: ADR 0008, ADR 0010; architecture §5.
Enforced in: `worker/src/operations/release-prepare`, `release-create`; the Door43 adapter exposes no write to a default branch from the release operations.
Verified by: recorded-request test asserting the exact set of write calls for a release; a plan's `would_write` list contains only those four kinds.
Issues: #34, #39.

### R4 — Nothing is preselected; a first release needs a book
Release planning presents candidates with nothing selected. A first release requires at least one book or story.
Source: product spec §10.
Enforced in: `worker/src/operations/release-plan` (no default selection); `release-prepare` (rejects empty first-release selection).
Verified by: plan output has an empty selection; empty selection on a project with no release returns `invalid_selection`.
Issues: #33.

### R5 — Preparation is bound to the source commit
Every release preparation records the default-branch commit SHA it was planned from. Before the snapshot is written and again before the release is created, the Worker re-reads the SHA. If it moved, the preparation becomes `restart_required` and is never silently merged with the new state.
Source: product spec §10 "Project has been edited"; architecture §6 stale source protection.
Enforced in: `worker/src/operations/release-prepare`, `release-create` (precondition check).
Verified by: fixture where the default-branch head changes between plan and apply; apply returns `source_changed` and writes nothing.
Issues: #34, #40.

### R6 — Never a duplicate release
When release creation returns an ambiguous result, the Worker looks up the expected tag and release on Door43 before any retry. If one exists it is shown and nothing new is created.
Source: architecture §6 duplicate release protection; product spec §11.
Enforced in: `worker/src/operations/release-create` (ambiguous result path); `release-lookup`.
Verified by: simulated lost response followed by a fixture where the tag exists; retry returns `release_exists` and performs no write.
Issues: #40.

### R7 — The temporary branch outlives failure
The temporary branch is deleted only after release creation succeeds. On health failure, commit failure, or release failure it is retained for inspection and retry.
Source: ADR 0003; architecture §6 branch lifecycle.
Enforced in: `worker/src/operations/release-create` (delete branch is the last step and runs only on success).
Verified by: failed release fixture leaves the branch; successful release fixture deletes it; deletion failure after success is reported as a warning in the receipt, not as a release failure.
Issues: #34, #39.

### R8 — Promotion changes only status
Promoting a pre-release changes the Door43 release's pre-release flag and nothing else: not the tag, not the version, not the contents.
Source: product spec §10 versioning and §13 pre-release promotion.
Enforced in: `worker/src/operations/release-promote` (single PATCH of the pre-release flag).
Verified by: recorded-request test asserting the PATCH body contains only the pre-release flag.
Issues: #39.

### R9 — The version is valid and moves forward
The final version is valid semver and greater than the latest full release on Door43, whichever tool created that release. Loose tags are coerced before comparison; a bare year or no release baselines at `v1.0.0`.
Source: product spec §10 versioning; domain model §7.
Enforced in: `worker/src/model/version`; `worker/src/operations/release-create` (precondition).
Verified by: table-driven tests over the coercion and bump rules; edited version not greater than baseline returns `invalid_version`.
Issues: #37.

### R10 — Every release is Scripture Burrito with true sizes and checksums
Every release tC Admin creates is Scripture Burrito assembled from Door43's `/sb/` archives, and every ingredient in its `metadata.json` carries the size and md5 recomputed from the file actually in the snapshot. Base metadata is never trusted for these values.
Source: ADR 0008; product spec §7; evidence E5 (stale checksums in a real repository).
Enforced in: `worker/src/model/burrito` (metadata merge recomputes size and md5 for every ingredient).
Verified by: fixture with stale base checksums; merged metadata matches the snapshot files; a snapshot file without an ingredient entry, or an entry without a file, fails the test.
Issues: #35.

## H — Health and coverage truthfulness

### H1 — Door43 health is authoritative
Door43's health-check result is the health result. tC Admin maps severities to display states and never reinterprets a result into a more permissive release decision.
Source: ADR 0007; product spec §9.
Enforced in: `worker/src/model/health` (pure mapping, no local judgement); `worker/src/operations/release-create` (reads the state, adds no exceptions).
Verified by: mapping tests over every observed severity; no code path sets `healthy` without a Door43 success result.
Issues: #25, #36.

### H2 — Anything but a successful health result blocks release
A failing, unavailable, errored, running, or never-run health check on the snapshot branch blocks release creation. Open question Q6 decides how `warning` is treated.
Source: ADR 0007; product spec §9 and §11; domain model §5.
Enforced in: `worker/src/operations/release-create` (precondition on `preparation.health.state`).
Verified by: release attempt in each non-success state returns `health_blocked` and writes nothing.
Issues: #36, #39.

### H3 — Unknown is never shown as good
Unknown, unavailable, running, or never-checked health is never displayed as healthy. Unknown coverage is never displayed as complete or as zero.
Source: product spec §5; issues #19, #25.
Enforced in: `worker/src/model/health`, `worker/src/model/project` (coverage `present` is `null`, not `0`, when unknown); `web` renders each state distinctly.
Verified by: prototype tests carried over: missing severity maps to `never_checked`; OBS container entry yields `null` coverage.
Issues: #19, #25.

### H4 — Health is never color alone
Every health state is conveyed with text or an icon in addition to color.
Source: product spec §5; architecture §8; roadmap Milestone 3 accessibility epic.
Enforced in: `web` health components (label map is the source of visible text).
Verified by: component test that every health state renders a visible label; Milestone 3 WCAG audit.
Issues: #8, #25, #50.

### H5 — Coverage is file coverage
Coverage counts recognized books or stories present against the testament-scope target (27, 39, 66) or 50 stories. It is never presented as translation completeness.
Source: CONTEXT.md "Coverage"; product spec §5.
Enforced in: `worker/src/model/project` (coverage carries `basis` and `target`); `web` copy uses the glossary wording.
Verified by: coverage tests over each scope; UI copy review against CONTEXT.md.
Issues: #19, #24.

## A — Access and identity

### A1 — Door43 credentials never reach the browser
No Door43 access token appears in JavaScript-visible state, browser storage, URLs, or client or server logs. The browser holds only an opaque HttpOnly session cookie.
Source: ADR 0001; architecture §2 and §8.
Enforced in: `worker/src/http/session` (token lives in Workers KV keyed by session id); `worker/src/http` response serialization; logging redaction.
Verified by: response-shape tests assert no token field on any route; log redaction test; Playwright smoke test inspects storage and URLs.
Issues: #12, #15, #51.

### A2 — Permission is checked live before every mutation
Before repository creation, any commit, branch change, release creation, or promotion, the Worker re-reads the repository permission from Door43. Ambiguity fails closed. A project the user lost access to leaves the writable portfolio.
Source: product spec §2; architecture §3 authorization.
Enforced in: `worker/src/operations` shared precondition used by every apply operation.
Verified by: each apply operation with a fixture lacking push permission returns `permission_denied` and writes nothing; a missing `permissions` object is treated as no permission.
Issues: #14.

### A3 — Every write is attributed to the signed-in user
Every Door43 commit, tag, and release tC Admin creates is made with the signed-in manager's credential and carries their identity.
Source: ADR 0004; product spec §7.
Enforced in: `worker/src/door43` (no service account; requests use the session's token only).
Verified by: adapter test that every write request carries the session bearer token and no other credential.
Issues: #12, #30, #39.

### A4 — Browser mutations are same-origin with a CSRF token
Every mutation from the browser passes a same-origin check and a CSRF token. Cross-origin requests are rejected.
Source: architecture §8; issue #13.
Enforced in: `worker/src/http` middleware ahead of every apply route.
Verified by: route tests for missing token, wrong token, and foreign origin.
Issues: #13.

## W — Writes and formats

### W1 — tC Admin writes one format
Every project tC Admin creates is Scripture Burrito with tC Admin recorded as generator. tC Admin never writes Resource Container, translationStudio, or translationCore metadata.
Source: ADR 0008.
Enforced in: `worker/src/model/burrito` is the only metadata writer.
Verified by: generated metadata validates against the Scripture Burrito schema; no writer for other formats exists.
Issues: #17, #29.

### W2 — A release-only project's default branch is never written
For Resource Container, translationStudio, and translationCore projects, tC Admin performs no write to the default branch until a manager-confirmed conversion (Milestone 2).
Source: ADR 0009; architecture §5.
Enforced in: `worker/src/operations` editability precondition (`editable` required for upload, metadata, and convert applies).
Verified by: edit-class operations on a `release_only` project return `not_editable` and write nothing.
Issues: #21, #45, #46, #47.

### W3 — Project purpose is protected after the first save
The Scripture Burrito flavor is chosen in the wizard and cannot be changed through normal editing after the first valid metadata is saved.
Source: ADR 0006.
Enforced in: `worker/src/operations/metadata-apply` (Milestone 2) rejects flavor changes; the wizard sets it once.
Verified by: metadata plan that changes the flavor returns `validation_failed`.
Issues: #28, #46.

### W4 — No automatic repository deletion
tC Admin never deletes a repository. A partially created project is shown as setup incomplete with a retry path.
Source: product spec §6; architecture §8.
Enforced in: the Door43 adapter has no repository-delete method.
Verified by: adapter surface test; setup-incomplete fixture leaves the repository.
Issues: #31, #49.

### W5 — One operation, one commit
The accepted changes of one operation are committed together as one Door43 commit: the first commit of a new project, the single snapshot commit of a release, and, in Milestone 2, an upload batch or a metadata edit with its proposed ingredient entries.
Source: product spec §8; ADR 0004; ADR 0010.
Enforced in: `worker/src/door43` multi-file contents call used by every committing operation.
Verified by: recorded-request tests assert exactly one contents call per apply.
Issues: #30, #34, #45, #46.

### W6 — Upload paths are safe (Milestone 2)
Uploads reject absolute paths, path traversal, symlinks, executable behavior, and files or batches over the configured limits.
Source: product spec §8; architecture §5.
Enforced in: `worker/src/operations/upload-plan` path normalization.
Verified by: table-driven rejection tests.
Issues: #45, #51.

### W7 — No metadata edit during an active preparation (Milestone 2)
Metadata edits are rejected while a release preparation for the project is active.
Source: product spec §7.
Enforced in: `worker/src/operations/metadata-apply` precondition on active preparations.
Verified by: metadata apply with an active preparation returns `preparation_active`.
Issues: #46.

## P — Portfolio truthfulness

### P1 — Nothing writable is hidden
Every non-archived repository where the user has push or admin permission appears in the portfolio. Release-only and unsupported projects appear with a one-line reason.
Source: ADR 0009; product spec §2.
Enforced in: `worker/src/operations/portfolio-list` (no filter beyond writable and non-archived); `worker/src/model/project` (editability with reason).
Verified by: fixture portfolio containing sb, rc, ts, tc, and metadata-less repositories; all appear with the expected editability and reason.
Issues: #21, #23.

### P2 — Missing permission grants nothing
A repository is writable only when Door43 explicitly returns push or admin permission for it. A missing or ambiguous permissions object means not writable.
Source: product spec §2; prototype behavior carried over.
Enforced in: `worker/src/operations/portfolio-list` filter.
Verified by: prototype tests carried over.
Issues: #23.

### P3 — Cached data says how old it is
Every cached or derived fact carries its read time and source; the UI labels stale data with its age. tC Admin holds no durable content or release ledger.
Source: ADR 0002; architecture §4.
Enforced in: operation outputs carry `freshness`; Workers KV entries carry a read timestamp.
Verified by: output-shape tests; refresh test shows age reset.
Issues: #26.

## X — Failure and diagnostics

### X1 — Unknown outcomes are never silently retried
A mutation whose outcome is unknown is not retried automatically. The operation returns `release_outcome_unknown` or `commit_failed` with the recovery action, and any retry is explicit.
Source: architecture §7.
Enforced in: `worker/src/door43` (no automatic retry on writes); `worker/src/operations/*-apply`.
Verified by: adapter test that a write timeout raises rather than retries.
Issues: #40.

### X2 — Every failure is typed and recoverable
Every failure returns an error code from the catalog in [operations.md](operations.md), the user-facing message the specification fixes for it, whether it is retryable, the next action, and a request id.
Source: product spec §11; architecture §7.
Enforced in: `worker/src/http/errors` maps every thrown error to the catalog; unknown errors become `unexpected` with a request id.
Verified by: every catalog code has a test producing it; no route returns an uncataloged shape.
Issues: #15, #31, #40.

### X3 — Diagnostics never carry secrets or content
Diagnostics and logs may include request id, project, commit SHA, version, target ref, health state, and Door43 response status. They never include tokens, secrets, or file contents.
Source: architecture §7; Milestone 3 security review.
Enforced in: `worker/src/http/errors` and the logger's redaction list.
Verified by: redaction tests; security review checklist.
Issues: #51.
