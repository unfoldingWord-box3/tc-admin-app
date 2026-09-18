# tC Admin Operation Catalog

Status: proposed 18 September 2026; accepted when the pull request that adds this file merges (ADR 0011)
Audience: the engineers and agents building the Worker, the web client, the tests, and any later agent client

This catalog is the contract between tC Admin's layers. Everything tC Admin can do is one named operation here. The Worker implements the operations; the browser UI calls them; the tests exercise them against recorded fixtures; a later MCP server exposes them one tool per operation. No layer adds behavior that is not an operation in this file.

## 1. The protocol

Three kinds of operation:

| Kind | Writes to Door43 | Returns | Rule |
| --- | --- | --- | --- |
| **Read** | never | a complete situation | one call answers "what is the state of X" with provenance and age for every derived fact |
| **Plan** | never | a `plan` | computes exactly what an apply would write, bound to the source commit it was computed from |
| **Apply** | yes | a `receipt` | takes a plan id, re-checks the binding and the permission, writes, and lists what it wrote |

Rules that hold for every operation:

1. **Identifiers are the glossary's.** Operation names, state values, error codes, project type and format values are the identifiers in [CONTEXT.md](../CONTEXT.md) "Identifiers", spelled identically in code, API, tests, logs, and these docs.
2. **Provenance on every derived fact.** Health carries the ref, time, and raw severity it came from. Coverage carries its basis and target. Every output carries `freshness` (read time, live or cache, age).
3. **Plan before apply.** Every mutation is preceded by a plan the manager reviews. The plan's `would_write` list is the complete set of Door43 writes the apply will perform; the apply performs nothing outside that list (R3, W5).
4. **Bound, not assumed.** Plans and preparations record the default-branch SHA and, where relevant, the release tag SHA. Applies re-read them and return `source_changed` if they moved (R5).
5. **Permission at the boundary.** Every apply re-reads the repository permission first and fails closed (A2).
6. **Idempotency by key.** Every apply accepts an idempotency key (the plan id serves) and returns the same receipt for a repeated call with the same key. An ambiguous outcome is reported, never retried silently (X1).
7. **Errors from one catalog.** Every failure is a code from section 6 with the fixed user message, `retryable`, `next_action`, and `request_id` (X2).
8. **Reads are cheap.** A read never downloads an archive unless the operation says so. Q17 decides the portfolio's analysis source.

## 2. Common shapes

Shapes are described as fields; the shared schema package (`shared/schema`, proposed in [architecture.md](architecture.md) §10) is the executable form and the source the Worker, web client, and tests import.

### Freshness

```
freshness: { read_at, source: live | cache, age_seconds }
```

### Project report

The complete situation of one project. `project.read` returns it; `portfolio.list` returns a summary of it per project.

```
project
  ref:               { owner, repo, id, url }
  title, description, default_branch
  language:          { code, title }
  project_type:      bible | obs | other                 (Q11 decides how `other` is shown)
  metadata_format:   sb | rc | ts | tc | none
  editability:       { state: editable | release_only | unsupported, reason }
  coverage:          { present | null, target | null, scope: nt | ot | full | obs | unknown, basis, units: [{ id, present }] }
  health:            { state, severity_raw, ref, checked_at, issue_count | null, source: door43 }
  latest_full_release: { tag, version, sha, published_at, author } | null
  default_branch_head: { sha, committed_at }
  active_preparation: { id, state, version } | null
  setup:             { state: complete | incomplete, failed_step | null }
  permissions:       { push, admin, checked_at }
  freshness
```

`health.state` is one of the health states in [domain-model.md](domain-model.md) section 5. `editability.reason` is one sentence in glossary language, for example "Resource Container project. Release is available; editing needs conversion."

### Plan

```
plan
  id, operation, created_at, expires_at
  bound_to:    { default_branch_sha, release_tag | null, release_tag_sha | null }
  preview:     operation-specific (section 4)
  would_write: [ { kind: repo | branch | commit | tag | release, target } ]
  warnings:    [ { code, message } ]
```

A plan expires (proposed: 30 minutes) and is invalid once `bound_to` no longer matches Door43.

### Receipt

```
receipt
  operation, request_id, plan_id | null, started_at, finished_at
  wrote:   [ { kind, target, sha | url } ]
  result:  operation-specific
  warnings: [ { code, message } ]
```

`wrote` is a subset of the plan's `would_write`, never a superset.

### Preparation

A release preparation is an addressable resource. Its id is the version it was created with; its temporary branch is `temp-tca-release/<version>`.

```
preparation
  id, project_ref
  state:      one of the release states in domain-model.md section 6
  bound_to:   { default_branch_sha, release_tag | null, release_tag_sha | null }
  selection:  { new: [unit], revised: [unit], unknown_included: [path] }
  snapshot:   { branch, commit_sha, files: [{ path, source: tag | default_branch, unit | null }] } | null
  health:     as in project report, for the temporary branch
  version:    { baseline_tag | null, proposed, confirmed | null }
  notes:      { draft, confirmed | null }
  release:    { tag, url, prerelease } | null
  last_error: error | null
  history:    [ { at, from, to, event } ]
  freshness
```

### Error

```
error
  code, message, retryable, next_action, request_id
  details: redacted, operation-specific
  invariant: identifier | null
```

## 3. Catalog

| Operation | Kind | Milestone | Door43 writes | Invariants | Issues |
| --- | --- | --- | --- | --- | --- |
| `situation.read` | read | 1 | — | A1 | #12 |
| `portfolio.list` | read | 1 | — | P1, P2, P3, H3 | #23, #24 |
| `project.read` | read | 1 | — | H1, H3, H5, P3 | #19, #21, #25 |
| `project.refresh` | read | 1 | — | P3 | #26 |
| `project.create.plan` | plan | 1 | — | W1, W3 | #28, #29 |
| `project.create.apply` | apply | 1 | repo, commit | A2, A3, W1, W4, W5 | #30 |
| `project.create.retry` | apply | 1 | commit | W4 | #31 |
| `release.plan` | plan | 1 | — | R1, R2, R4, R9 | #33, #37, #38 |
| `release.prepare` | apply | 1 | branch, commit | R1, R2, R3, R5, R7, R10, A2 | #34, #35 |
| `preparation.read` | read | 1 | — | H1, H2, H3 | #36 |
| `release.create` | apply | 1 | tag, release, branch delete | R3, R5, R6, R7, R9, H2, A2 | #39, #40 |
| `release.lookup` | read | 1 | — | R6 | #40 |
| `release.promote` | apply | 1 | release | R8, A2 | #39 |
| `preparation.discard` | apply | 1, pending Q14 | branch delete | R7 | — |
| `upload.plan` | plan | 2 | — | W2, W6 | #45 |
| `upload.apply` | apply | 2 | commit | W2, W5, A2 | #45 |
| `metadata.plan` | plan | 2 | — | W1, W2, W3, W7 | #46 |
| `metadata.apply` | apply | 2 | commit | W1, W2, W5, A2 | #46 |
| `convert.plan` | plan | 2 | — | W2 | #47 |
| `convert.apply` | apply | 2 | commit | W1, W5, A2 | #47 |
| `project.create.resume` | apply | 2 | commit | W4 | #49 |

## 4. Milestone 1 operations

Each entry: what it needs, what it checks, what it reads and writes on Door43, what it returns, which errors it can raise.

### `situation.read`

The orientation call. One request tells a client who is signed in, which host, and how the portfolio stands.

- Inputs: none.
- Returns: `{ account: { login, name }, host: { origin, name: QA | Production, development }, portfolio: { projects, writable_organizations, needs_attention, awaiting_check, last_loaded_at } | null, configured }`.
- Door43 reads: `/user` when a session exists.
- Errors: `session_expired`, `door43_unavailable`.

### `portfolio.list`

- Inputs: optional filters (organization, language, project type, health state) and sort; filters are applied by the client where the whole portfolio is already loaded.
- Door43 reads: repository search for the signed-in user, every page, de-duplicated by repository id (carried over from the prototype). Q17 decides whether per-project analysis reads the catalog metadata only or the `/sb/` archive.
- Returns: `{ organizations: [{ name, projects: [project summary] }], freshness, analysis: { complete, pending } }`. Projects appear immediately with `health.state = never_checked` and `coverage.present = null` until analysis completes (H3).
- Filters: non-archived repositories with explicit push or admin permission (P1, P2). Nothing else is filtered out.
- Errors: `session_expired`, `door43_unavailable`, `portfolio_too_large` (the prototype's read limit, retained until Milestone 3 performance work).

### `project.read`

- Inputs: `{ owner, repo }`.
- Door43 reads: repository, default branch head, latest full release and its tag, health for the default branch. Archive download only when Q17 says so.
- Returns: the project report.
- Errors: `not_found`, `permission_denied` (the repository is not writable), `session_expired`, `door43_unavailable`.

### `project.refresh`

- Inputs: `{ owner, repo } | null` (null refreshes the portfolio).
- Effect: invalidates tC Admin's cache for the target and performs the corresponding read live. No Door43 write.
- Returns: the refreshed project report or portfolio with `freshness.source = live`.

### `project.create.plan`

- Inputs: `{ organization, project_type: bible, testament_scope: nt | ot | full, repo_name, language: { code, title }, source_resource | null, title }`. Open Bible Stories in Milestone 2.
- Checks: organization allows repository creation for this account; repository name free and valid; flavor `scripture/textTranslation` (W1); Q4 decides the required metadata fields.
- Returns: `plan.preview = { metadata_json, files: [{ path, size, md5 }] }`, `would_write = [repo, commit]`.
- Errors: `validation_failed`, `permission_denied`, `name_taken`, `session_expired`, `door43_unavailable`.

### `project.create.apply`

- Inputs: `{ plan_id }`.
- Checks: plan valid and not expired; permission re-read (A2).
- Door43 writes: create repository, then one commit with `metadata.json`, `ingredients/license.md`, `README.md` (W5, A3).
- Returns: `receipt.result = project report`. If the repository was created but the commit failed, `receipt.result.setup = { state: incomplete, failed_step: first_commit }` and `warnings` carries `setup_incomplete`; the repository is never deleted (W4).
- Errors: `permission_denied`, `plan_expired`, `name_taken`, `commit_failed`, `door43_unavailable`.

### `project.create.retry`

- Inputs: `{ owner, repo }` of a setup-incomplete project.
- Effect: re-attempts the first commit from the recorded plan. Milestone 2 generalizes this into `project.create.resume` from any step.
- Errors: `commit_failed`, `permission_denied`, `not_found`.

### `release.plan`

Candidate detection and everything the manager needs to decide, with no writes.

- Inputs: `{ owner, repo }`.
- Door43 reads: default-branch head SHA; latest full release and its tag SHA; the `/sb/` archive for the default branch and, when a release exists, for the release tag. The archives are cached for the plan's lifetime so `release.prepare` does not download them again.
- Computes: candidate groups (`new`, `changed_released`, `unchanged`, `unknown`) by comparing the two trees, with administrative ingredients and root files always taken from the default branch (R1); the proposed version from the baseline (R9); a draft of the release notes (product spec §10).
- Returns: `plan.preview = { candidates: { new, changed_released, unchanged, unknown }, administrative: [path], version: { baseline_tag, proposed, rule_applied }, notes_draft, selection: {} }` with nothing selected (R4). `would_write = [branch, commit]`.
- Errors: `not_releasable` (unsupported project), `permission_denied`, `archive_failed`, `session_expired`, `door43_unavailable`.

### `release.prepare`

- Inputs: `{ plan_id, selection: { new: [unit], revised: [unit], unknown_included: [path] }, version | null }`.
- Checks: plan not expired; `bound_to` matches Door43 (R5); selection valid: at least one unit on a first release, no released unit omitted (R2, R4); version valid and greater than the baseline when supplied (R9); permission re-read (A2).
- Door43 writes: create `temp-tca-release/<version>` from the release tag SHA, or from the default-branch head for a first release (ADR 0010); one multi-file commit containing root files and administrative ingredients from the default-branch archive, released units from the tag archive, selected units from the default-branch archive, explicitly included unknown files, and the merged `metadata.json` with size and md5 recomputed for every file (R1, R3, R10, W5).
- Returns: `receipt.result = preparation` in state `snapshot_prepared`, moving to `health_checking` once the push is confirmed.
- Errors: `plan_expired`, `source_changed`, `invalid_selection`, `invalid_version`, `permission_denied`, `commit_failed`, `door43_unavailable`. On `commit_failed` the branch is retained (R7) and the preparation is `retryable_failure`.

### `preparation.read`

- Inputs: `{ owner, repo, preparation_id }`.
- Door43 reads: health for the temporary branch; default-branch head SHA. The Worker polls health every 5 seconds for 3 minutes after the push, then returns `health_checking` and lets the client refresh (Q2 tunes the constants).
- Returns: the preparation. If the default-branch head moved, `state = restart_required` (R5). Health states map per H1; anything other than success leaves the preparation short of `ready_for_release` (H2; Q6 decides `warning`).
- Errors: `not_found`, `session_expired`, `door43_unavailable`.

### `release.create`

- Inputs: `{ owner, repo, preparation_id, version, notes, prerelease: boolean }`.
- Checks: preparation in `ready_for_release`: health success on the snapshot (H2), `notes` non-empty, `version` valid and greater than the baseline (R9); `bound_to` re-read and unchanged (R5); permission re-read (A2).
- Door43 writes: tag and Door43 release targeting the snapshot commit with the notes and pre-release flag; then delete the temporary branch (R3, R7).
- Returns: `receipt.result = preparation` in `pre_release` or `full_release` with `release = { tag, url, prerelease }`. A failed branch deletion after a successful release is a `warnings` entry, not an error.
- Errors: `health_blocked`, `invalid_version`, `validation_failed` (empty notes), `source_changed`, `permission_denied`, `release_failed` (branch retained, state `retryable_failure`), `release_outcome_unknown` (next action `release.lookup`), `release_exists`.

### `release.lookup`

- Inputs: `{ owner, repo, tag }`.
- Door43 reads: release by tag.
- Returns: `{ found: boolean, release: { tag, url, prerelease, target_sha } | null }`. Used before any retry after an ambiguous outcome (R6).

### `release.promote`

- Inputs: `{ owner, repo, tag }`.
- Checks: release exists and is a pre-release; permission re-read (A2).
- Door43 writes: one edit of the release setting the pre-release flag false and nothing else (R8).
- Returns: `receipt.result = { tag, url, prerelease: false }`.
- Errors: `not_found`, `not_prerelease`, `permission_denied`, `promotion_failed`.

### `preparation.discard` (pending Q14)

- Inputs: `{ owner, repo, preparation_id }`.
- Effect: a manager-initiated cancel that deletes the temporary branch of a preparation that has not been released. Not yet in the product specification; Q14 records the decision.

## 5. State identifiers

Defined in [domain-model.md](domain-model.md) and repeated here so a client can validate against one file.

| Field | Values |
| --- | --- |
| `project_type` | `bible`, `obs`, `other` |
| `metadata_format` | `sb`, `rc`, `ts`, `tc`, `none` |
| `editability.state` | `editable`, `release_only`, `unsupported` |
| `coverage.scope` | `nt`, `ot`, `full`, `obs`, `unknown` |
| `health.state` | `healthy`, `warning`, `failing`, `never_checked`, `checking`, `door43_unavailable`, `health_error`, `unsupported` |
| candidate group | `new`, `changed_released`, `unchanged`, `unknown` |
| content inclusion | `unreleased`, `released`, `changed_released`, `selected`, `carried_forward`, `excluded`, `administrative`, `unknown` |
| `preparation.state` | `selecting`, `snapshot_prepared`, `health_checking`, `health_blocked`, `ready_for_release`, `pre_release`, `full_release`, `restart_required`, `retryable_failure` |
| `setup.state` | `complete`, `incomplete` |
| `freshness.source` | `live`, `cache` |

## 6. Error catalog

`message` is the user-facing text. Where the product specification fixes the wording (§11), it is quoted here and is not to be paraphrased. `next_action` is what the client offers; an agent client branches on `code`, never on `message`.

| Code | HTTP | Retryable | Message | Next action | Spec §11 row | Invariant |
| --- | --- | --- | --- | --- | --- | --- |
| `door43_unavailable` | 503 | yes | "Door43 is unavailable currently. Please refresh later." | refresh later; nothing was written | Door43 unavailable | X1 |
| `session_expired` | 401 | after sign-in | "Your Door43 session expired. Please sign in again." | sign in; unsaved form state preserved where safe | Door43 session expired | A1 |
| `permission_denied` | 403 | no | "You no longer have write access to this project." | refresh the portfolio | User loses write access | A2, P2 |
| `csrf_rejected` | 403 | no | "This request could not be verified. Reload and try again." | reload | — | A4 |
| `not_found` | 404 | no | "This project or release was not found on Door43." | refresh the portfolio | — | — |
| `validation_failed` | 400 | no | field-specific | fix the input | — | — |
| `name_taken` | 409 | no | "A repository with this name already exists in the organization." | choose another name | — | — |
| `not_editable` | 409 | no | editability reason from the project report | release, or convert (Milestone 2) | — | W2, P1 |
| `not_releasable` | 409 | no | editability reason from the project report | none in version one | — | P1 |
| `invalid_selection` | 400 | no | "Select at least one book." or "Released books cannot be removed." | fix the selection | — | R2, R4 |
| `invalid_version` | 400 | no | "Version must be valid and greater than <latest>." | edit the version | — | R9 |
| `plan_expired` | 409 | replan | "This plan has expired. Review the project again." | rerun the plan | — | R5 |
| `source_changed` | 409 | replan | "Project has been edited. The release process will need to restart." | discard the preparation and plan again | Concurrent project edit | R5 |
| `commit_failed` | 502 | yes | "Commit failed: <error message>." | retry | Commit failure | X1, R7 |
| `archive_failed` | 502 | yes | "Door43 could not provide the project archive. Try again later." | retry | — | — |
| `health_blocked` | 409 | yes | the health-check error or state | refresh health; retry when Door43 recovers | Health-check error | H2 |
| `release_failed` | 502 | yes | "Release creation failed: <error message>." | retry; the temporary branch is kept | Release creation failure | R7 |
| `release_outcome_unknown` | 502 | via lookup | "Door43 did not confirm the release." | run `release.lookup` for the tag before retrying | Lost release response | R6, X1 |
| `release_exists` | 409 | no | "This release already exists on Door43." | open the existing release | Existing expected release found | R6 |
| `not_prerelease` | 409 | no | "This release is already a full release." | none | — | R8 |
| `promotion_failed` | 502 | yes | "Pre-release promotion failed. <error message>." | retry | Pre-release promotion failure | R8 |
| `setup_incomplete` | warning | yes | "Setup incomplete. The repository exists but its first commit failed." | retry the first commit | Partial creation | W4 |
| `preparation_active` | 409 | no | "A release is being prepared for this project. Finish or discard it first." | open the preparation | — | W7 |
| `portfolio_too_large` | 507 | no | "This portfolio exceeds the current read limit. No partial portfolio was substituted." | Milestone 3 | — | P1 |
| `unexpected` | 500 | no | "Something went wrong. Reference <request_id>." | report with the request id | — | X2 |

## 7. Projections

**HTTP (Milestone 1).** One route per operation under the same-origin `/api/` prefix. Reads are `GET`, plans and applies are `POST`. Applies carry the CSRF token (A4) and an `Idempotency-Key` header equal to the plan id. Illustrative, decided in #7:

```
GET  /api/situation                                   situation.read
GET  /api/portfolio                                   portfolio.list
GET  /api/projects/{owner}/{repo}                     project.read
POST /api/projects/{owner}/{repo}/refresh             project.refresh
POST /api/projects/plan                               project.create.plan
POST /api/projects                                    project.create.apply
POST /api/projects/{owner}/{repo}/releases/plan       release.plan
POST /api/projects/{owner}/{repo}/preparations        release.prepare
GET  /api/projects/{owner}/{repo}/preparations/{id}   preparation.read
POST /api/projects/{owner}/{repo}/preparations/{id}/release   release.create
GET  /api/projects/{owner}/{repo}/releases/{tag}      release.lookup
POST /api/projects/{owner}/{repo}/releases/{tag}/promote      release.promote
```

**Web client.** Generated or hand-written against `shared/schema`; each wizard and stepper step calls exactly one operation. The stepper in product spec §10 maps as: select → `release.plan` and selection; review snapshot → `release.prepare`; health → `preparation.read`; notes and version → client state; create → `release.create`; promote → `release.promote`.

**MCP (deferred).** One tool per operation with the same input and output schemas, the same error codes, and the same plan-before-apply requirement, so an agent operating tC Admin follows the same safety path as a manager. No new logic in the MCP layer.
