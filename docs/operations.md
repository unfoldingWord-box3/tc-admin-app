# tC Admin Operation Catalog

Status: proposed 18 September 2026 (ADR 0011); amended 1 October 2026 (proposed) with import, upload, and the three-state selection (ADR 0013); accepted when that pull request merges
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
8. **Reads are cheap.** `portfolio.list` and `project.read` use the catalog metadata Door43 returns in the repository search (E12, E14), which is the same for every project type; they never download an archive. `release.plan` compares git trees (E18, E19), not archives. Only `release.prepare` downloads `/sb/` archives, because it needs the bytes.

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
  project_type:      bible | obs | other   (see CONTEXT.md "Identifiers")
  metadata_format:   sb | rc | ts | tc | none
  editability:       { state: editable | unsupported, reason }
  coverage:          { present | null, target | null, scope: nt | ot | full | obs | unknown, basis: catalog | archive, units: [{ id, present }] }
  health:            { state, severity_raw, ref, checked_at, issue_count | null, source: door43 }
  latest_full_release: { tag, version, sha, published_at, author } | null
  default_branch_head: { sha, committed_at }
  active_preparation: { id, state, version } | null
  setup:             { state: complete | incomplete, failed_step | null }
  permissions:       { push, admin, checked_at }
  freshness
```

`health.state` is one of the health states in [domain-model.md](domain-model.md) section 5. `editability.reason` is one sentence in glossary language, for example "Resource Container project. Import it into a new project to manage it here."

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
| `release.prepare` | apply | 1 | branch, commit | R1, R2, R3, R5, R7, R10, W2, A2 | #34, #35 |
| `preparation.read` | read | 1 | — | H1, H2, H3 | #36 |
| `release.create` | apply | 1 | tag, release, branch delete | R3, R5, R6, R7, R9, H2, A2 | #39, #40 |
| `release.lookup` | read | 1 | — | R6 | #40 |
| `release.promote` | apply | 1 | release | R8, A2 | #39 |
| `preparation.discard` | apply | 1 | branch delete | R7, A2 | #58 |
| `upload.plan` | plan | 1 | — | W2, W6 | #45 |
| `upload.apply` | apply | 1 | commit | W2, W5, A2 | #45 |
| `owner.search` | read | 1 | — | — | #47 |
| `source.search` | read | 1 | — | — | #47 |
| `import.plan` | plan | 1 | — | W2, W6 | #47 |
| `import.apply` | apply | 1 | commit | W1, W2, W5, A2 | #47 |
| `metadata.plan` | plan | 2 | — | W1, W2, W3, W7 | #46 |
| `metadata.apply` | apply | 2 | commit | W1, W2, W5, A2 | #46 |
| `project.create.resume` | apply | 2 | commit | W4 | #49 |

Issue #47 was "Convert a release-only project to Scripture Burrito" and is re-scoped to import (ADR 0013); its title changes when Rich renames it.

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
- Door43 reads: repository search for the signed-in user, every page, de-duplicated by repository id (carried over from the prototype). Per-project type, coverage, and health come from the catalog metadata in that response (E12); no archive is downloaded.
- Returns: `{ organizations: [{ name, projects: [project summary] }], freshness, analysis: { complete, pending } }`. Projects appear immediately with `health.state = never_checked` and `coverage.present = null` until analysis completes (H3).
- Filters: non-archived repositories with explicit push or admin permission (P1, P2). Nothing else is filtered out.
- Errors: `session_expired`, `door43_unavailable`, `portfolio_too_large` (the prototype's read limit, retained until Milestone 3 performance work).

### `project.read`

- Inputs: `{ owner, repo }`.
- Door43 reads: the repository (E14 supplies `metadata_type`, `subject`, `flavor_type`, `ingredients`, `healthcheck_severity`, and `catalog.prod` as the latest full release with its tag and commit SHA, `catalog.preprod` as the latest pre-release, `catalog.latest` as the default-branch head); the health result for the default branch (E15) for the issue counts. No archive download (Q17); `coverage.basis = catalog`.
- Classification (`worker/src/model/project`, #19): `project_type` from `subject` (E33, Q11, Q23), `bible` for Bible and Aligned Bible, `obs` for Open Bible Stories, `other` for anything else; `coverage.scope` from the books the catalog lists, `nt` when only New Testament books are listed, `ot` when only Old Testament books are, `full` when both, `obs` for Open Bible Stories, `unknown` otherwise, with `target` 27, 39, 66, 50, or `null` (H5); `coverage.present` is `null` when Door43 lists no ingredients or lists no recognized unit but a directory it does not itemize (H3). The search item carries no `currentScope` (E32); a caller that has read the catalog metadata (E20) may supply it and the scope widens to cover it.
- Returns: the project report.
- Errors: `not_found`, `permission_denied` (the repository is not writable), `session_expired`, `door43_unavailable`.

### `project.refresh`

- Inputs: `{ owner, repo } | null` (null refreshes the portfolio).
- Effect: invalidates tC Admin's cache for the target and performs the corresponding read live. No Door43 write.
- Returns: the refreshed project report or portfolio with `freshness.source = live`.

### `project.create.plan`

- Inputs: `{ owner, project_type: bible | obs, title, abbreviation, language: { code, title }, testament_scope: nt | ot | full | null, license }`. `owner` is one of the account's organizations or the account itself. `testament_scope` is required for `bible` and sets `currentScope`; it is null for `obs`. `license` is `cc-by-sa-4.0` in Milestone 1 (Q20).
- Computes: `repo_name = lowercase(language.code) + "_" + lowercase(abbreviation)`, as in `en_ult`; the `metadata.json` the schema requires (E37, Q4) with the flavor `scripture/textTranslation` or `gloss/textStories` (W1), `identification.name` and `abbreviation` from the inputs, tC Admin as generator, and no `relationships` until an import adds one (E24).
- Checks: the owner allows repository creation for this account; `repo_name` is free in that owner (`name_taken`) and valid; `abbreviation` and `title` present.
- Returns: `plan.preview = { repo_name, metadata_json, files: [{ path, size, md5 }] }`, `would_write = [repo, commit]`.
- Errors: `validation_failed`, `permission_denied`, `name_taken`, `session_expired`, `door43_unavailable`.

### `project.create.apply`

- Inputs: `{ plan_id }`.
- Checks: plan valid and not expired; permission re-read (A2).
- Door43 writes: create repository, then one commit with `metadata.json`, `ingredients/license.md`, `README.md` (W5, A3).
- Returns: `receipt.result = project report`. If the repository was created but the commit failed, `receipt.result.setup = { state: incomplete, failed_step: first_commit }` and `warnings` carries `setup_incomplete`; the repository is never deleted (W4). The wizard's last step may follow with `upload.plan` or `import.plan` to add books at once.
- Errors: `permission_denied`, `plan_expired`, `name_taken`, `commit_failed`, `door43_unavailable`.

### `project.create.retry`

- Inputs: `{ owner, repo }` of a setup-incomplete project.
- Effect: re-attempts the first commit from the recorded plan. Milestone 2 generalizes this into `project.create.resume` from any step.
- Errors: `commit_failed`, `permission_denied`, `not_found`.

### `release.plan`

Candidate detection and everything the manager needs to decide, with no writes.

- Inputs: `{ owner, repo }`.
- Door43 reads: the repository (`catalog.prod` for the baseline tag and commit SHA, `catalog.latest` for the default-branch head); the catalog entry for each of the two refs (E20) to map book code to path; the recursive git tree for each ref (E19). No archive download.
- Computes: for a Bible project, every book on the default branch or in the baseline release with its group (`new`, `changed_released`, `unchanged`, `unknown`) by comparing blob SHAs book by book across the two trees (E18), and its default selection state (R4): `include` for every book when there is no baseline; otherwise `carry_forward` for every released book and `leave_out` for every new one. Administrative ingredients and root files always come from the default branch (R1). For an Open Bible Stories project there is no selection: the plan is the whole default branch. The proposed version from the baseline (R9, Q19): `first` when there is no release or the tag is a bare year (`v1.0.0`), else the highest of `removal` (major, when the selection leaves a released book out), `new_books` (minor), or `revisions` (patch); a draft of the release notes (product spec §10). The merged metadata's `currentScope` will list exactly the released books (Q7).
- Returns: `plan.preview = { books: [{ id, group, selection: include | carry_forward | leave_out }], removals: [id], administrative: [path], version: { baseline_tag, proposed, rule_applied: first | removal | new_books | revisions }, notes_draft }`. The client sends the manager's selection to `release.prepare`, which recomputes `removals` and the version from it. `would_write = [branch, commit]`.
- Errors: `not_releasable` (unsupported project), `permission_denied`, `session_expired`, `door43_unavailable`.

### `release.prepare`

- Inputs: `{ plan_id, selection: { <book id>: include | carry_forward | leave_out }, unknown_included: [path], version | null }`. For an Open Bible Stories project `selection` is empty.
- Checks: plan not expired; `bound_to` matches Door43 (R5); at least one book included or carried forward (R4); every book in the plan has a state; version valid and greater than the baseline when supplied, and at least a major increment when a released book is left out (R9); permission re-read (A2); the project is `editable` (W2).
- Door43 reads: the `/sb/` archive for the default branch (E17), inflating one entry at a time, the source of included books' bytes (ADR 0008). The release-tag archive is read only to recompute size and md5 for the merged metadata; carried-forward books are never uploaded (Q22).
- Door43 writes: `POST /branches` creating `temp-tca-release/<version>` with `old_ref_name` set to the release tag, or to the default branch for a first release or for an Open Bible Stories project (ADR 0010); then one or more `POST /contents` on that branch (Q22): `upload` for each included book from the default-branch archive, `delete` for each book whose state is `leave_out` and whose file is on the branch (R2), `upload` for refreshed root files and administrative ingredients, and the merged `metadata.json`. The merged `metadata.json` carries exactly the included and carried-forward books plus the refreshed administrative entries, every top-level field from the default branch's current metadata, `currentScope` equal to the released books, size and md5 recomputed for every file (Q7, Q8; R1, R2, R3, R10, W5; request shapes in E21). For an Open Bible Stories project the only content write is the refreshed `metadata.json`. The plan's `would_write` lists every commit the apply will make.
- Returns: `receipt.result = preparation` in state `snapshot_prepared`, moving to `health_checking` once the push is confirmed.
- Errors: `plan_expired`, `source_changed`, `invalid_selection`, `invalid_version`, `permission_denied`, `commit_failed`, `door43_unavailable`. On `commit_failed` the branch is retained (R7) and the preparation is `retryable_failure`.

### `preparation.read`

- Inputs: `{ owner, repo, preparation_id }`.
- Door43 reads: health for the temporary branch (E15); default-branch head SHA. The Worker polls health every 5 seconds for 3 minutes after the push, then returns `health_checking` and lets the client refresh (Q2 tunes the constants). Inside that window a 422 "no metadata found" for the branch means the check has not run yet and maps to `checking`, not `health_error`.
- Returns: the preparation. If the default-branch head moved, `state = restart_required` (R5). Health states map per H1. `healthy`, `info`, and `warning` move the preparation to `ready_for_release`; when the state is `warning`, `preparation.requires_acknowledgement` is true and the health issues are included for the manager to read. Every other state leaves the preparation short of `ready_for_release` (H2).
- Errors: `not_found`, `session_expired`, `door43_unavailable`.

### `release.create`

- Inputs: `{ owner, repo, preparation_id, version, notes, prerelease: boolean, acknowledge_warnings: boolean }`.
- Checks: preparation in `ready_for_release`: snapshot health `healthy`, or `warning` with `acknowledge_warnings: true` (H2); `notes` non-empty; `version` valid and greater than the baseline (R9); `bound_to` re-read and unchanged (R5); permission re-read (A2).
- Door43 writes: tag and Door43 release targeting the snapshot commit with the notes and pre-release flag; then delete the temporary branch (R3, R7).
- Returns: `receipt.result = preparation` in `pre_release` or `full_release` with `release = { tag, url, prerelease }`. When warnings were acknowledged the receipt records it (`acknowledged_warnings: true`). A failed branch deletion after a successful release is a `warnings` entry, not an error.
- Errors: `health_blocked`, `warning_not_acknowledged`, `invalid_version`, `validation_failed` (empty notes), `source_changed`, `permission_denied`, `release_failed` (branch retained, state `retryable_failure`), `release_outcome_unknown` (next action `release.lookup`), `release_exists`.

### `release.lookup`

- Inputs: `{ owner, repo, tag }`.
- Door43 reads: `GET /repos/{owner}/{repo}/releases/tags/{tag}` (E21).
- Returns: `{ found: boolean, release: { tag, url, prerelease, target_sha } | null }`. Used before any retry after an ambiguous outcome (R6).

### `release.promote`

- Inputs: `{ owner, repo, tag }`.
- Checks: release exists and is a pre-release; permission re-read (A2).
- Door43 writes: one edit of the release setting the pre-release flag false and nothing else (R8).
- Returns: `receipt.result = { tag, url, prerelease: false }`.
- Errors: `not_found`, `not_prerelease`, `permission_denied`, `promotion_failed`.

### `preparation.discard`

- Inputs: `{ owner, repo, preparation_id }`.
- Checks: the preparation exists and has no release (`state` is not `pre_release` or `full_release`); permission re-read (A2). The UI asks the manager to confirm first.
- Door43 writes: delete the temporary branch (E21).
- Returns: `receipt.result = preparation` in state `discarded`.
- Errors: `not_found`, `already_released`, `permission_denied`, `door43_unavailable`. A failed deletion leaves the branch and the preparation in `retryable_failure` (R7).

### `upload.plan`

Files the manager has, identified as books or stories before anything is written.

- Inputs: `{ owner, repo, files: [{ name, size, content_ref }] }` where `content_ref` names the uploaded bytes held by the Worker for the plan's lifetime (Q15 bounds the sizes).
- Checks: the project is `editable` (W2); every path is safe (W6); every file identifies one book or story: for USFM the `\id` line in the header, checked against the file name; for a story the number in the file name (`01.md` or `1.md`). A file whose header and name disagree, or that identifies nothing, is listed with `identified: null` and needs the manager's choice before apply (`unidentified_file`).
- Computes: for each file its Scripture Burrito path (`ingredients/<BOOK>.usfm`, `ingredients/content/<NN>.md`, E36), whether it overwrites an existing file (with a text diff where practical), and the ingredient entry with size and md5 (R10); the `metadata.json` diff.
- Returns: `plan.preview = { files: [{ name, identified: { book | story } | null, path, overwrite: boolean, diff | null }], metadata_diff, unknown: [name] }`, `would_write = [commit]`.
- Errors: `not_editable`, `validation_failed` (unsafe path or size), `unidentified_file`, `permission_denied`, `session_expired`, `door43_unavailable`.

### `upload.apply`

- Inputs: `{ plan_id, confirmations: { <name>: { book | story } } }` for files the plan left unidentified or the manager re-identified.
- Checks: plan not expired; every file identified; overwrites confirmed; permission re-read (A2); `bound_to` default-branch SHA unchanged (R5).
- Door43 writes: one `POST /contents` on the default branch with every file and the updated `metadata.json` (W5, A3).
- Returns: `receipt.result = project report`.
- Errors: `plan_expired`, `source_changed`, `unidentified_file`, `permission_denied`, `commit_failed`, `door43_unavailable`.

### `owner.search`

- Inputs: `{ q | null }`.
- Door43 reads: `GET /user/orgs` for the account's organizations, listed first; `GET /catalog/list/owners?owner=<q>&partialMatch=1&stage=latest` for every owner with a catalog entry whose name contains `q` (E35).
- Returns: `{ own: [{ login, name }], matches: [{ login, name }], freshness }`.
- Errors: `session_expired`, `door43_unavailable`.

### `source.search`

- Inputs: `{ owner, stage: prod | latest }`.
- Door43 reads: `GET /catalog/search?owner=<owner>&flavor=textTranslation&flavor=textStories&stage=<stage>` (E35): the owner's Bible and Open Bible Stories repositories in any metadata format, their latest release (`prod`) or their default branch (`latest`), each with its `ingredients[]`.
- Returns: `{ sources: [{ ref: { owner, repo }, title, language, project_type, metadata_format, stage, revision: { tag | branch, sha }, released, books: [{ id, title }] | null }], freshness }`. `books` is `null` when the catalog lists no itemized books, as for a Resource Container Open Bible Stories repository (E35); `import.plan` then reads the archive.
- Errors: `session_expired`, `door43_unavailable`.

### `import.plan`

Books or stories from an existing Door43 repository, in any metadata format, through its Scripture Burrito archive.

- Inputs: `{ owner, repo, source: { owner, repo, revision }, units: [id] | all }`.
- Checks: the project is `editable` (W2); the source exists on the same host and the revision is one of its releases or its default branch.
- Door43 reads: the source's Scripture Burrito archive, `GET /api/v1/repos/{owner}/{repo}/sb/{revision}.zip` (E1, E34), inflating one entry at a time; the files for the chosen units come from `ingredients/` (`ingredients/<BOOK>.usfm`; `ingredients/content/<NN>.md` for stories, E36).
- Computes: as `upload.plan` for each chosen file: path, overwrite, diff, ingredient entry with size and md5; plus one `relationships[]` entry `{ id: "dcs::<owner>/<repo>", relationType: "source", flavor: <the project's flavor>, revision }` and `idAuthorities.dcs` (E24).
- Returns: `plan.preview = { source, files: [...as upload.plan], metadata_diff }`, `would_write = [commit]`.
- Errors: `not_editable`, `not_found` (source), `source_unavailable`, `validation_failed` (a unit the source does not have), `permission_denied`, `session_expired`, `door43_unavailable`.

### `import.apply`

- Inputs: `{ plan_id }`.
- Checks: plan not expired; overwrites confirmed; permission re-read (A2); `bound_to` default-branch SHA unchanged (R5).
- Door43 writes: one `POST /contents` on the project's default branch with the chosen files and the updated `metadata.json` (W5, A3). Nothing is written to the source repository (W2).
- Returns: `receipt.result = project report`.
- Errors: `plan_expired`, `source_changed`, `source_unavailable`, `permission_denied`, `commit_failed`, `door43_unavailable`.

## 5. State identifiers

Defined in [domain-model.md](domain-model.md) and repeated here so a client can validate against one file.

| Field | Values |
| --- | --- |
| `project_type` | `bible`, `obs`, `other` |
| `metadata_format` | `sb`, `rc`, `ts`, `tc`, `none` |
| `coverage.basis` | `catalog`, `archive` |
| `editability.state` | `editable`, `unsupported` |
| `coverage.scope` | `nt`, `ot`, `full`, `obs`, `unknown` |
| `health.state` | `healthy`, `info`, `warning`, `failing`, `never_checked`, `checking`, `door43_unavailable`, `health_error`, `unsupported` |
| candidate group | `new`, `changed_released`, `unchanged`, `unknown` |
| content inclusion | `unreleased`, `released`, `changed_released`, `selected`, `carried_forward`, `excluded`, `removed`, `administrative`, `unknown` |
| `selection` | `include`, `carry_forward`, `leave_out` |
| `preparation.state` | `selecting`, `snapshot_prepared`, `health_checking`, `health_blocked`, `ready_for_release`, `pre_release`, `full_release`, `restart_required`, `retryable_failure`, `discarded` |
| `version.rule_applied` | `first`, `removal`, `new_books`, `revisions` |
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
| `name_taken` | 409 | no | "A repository named <repo_name> already exists in <owner>. Change the abbreviation." | change the abbreviation or the owner | — | — |
| `not_editable` | 409 | no | editability reason from the project report | import into a new project when the reason offers it | — | W2, P1 |
| `not_releasable` | 409 | no | editability reason from the project report | import into a new project when the reason offers it | — | P1 |
| `invalid_selection` | 400 | no | "Include or carry forward at least one book." | fix the selection | — | R4 |
| `unidentified_file` | 400 | no | "<file name> does not identify a book or story. Choose one or leave the file out." | choose the book or story, or drop the file | — | W6 |
| `source_unavailable` | 502 | yes | "Door43 could not provide the source repository's archive. Try again later." | retry `import.plan` | — | — |
| `invalid_version` | 400 | no | "Version must be valid and greater than <latest>." | edit the version | — | R9 |
| `plan_expired` | 409 | replan | "This plan has expired. Review the project again." | rerun the plan | — | R5 |
| `source_changed` | 409 | replan | "Project has been edited. The release process will need to restart." | discard the preparation and plan again | Concurrent project edit | R5 |
| `commit_failed` | 502 | yes | "Commit failed: <error message>." | retry | Commit failure | X1, R7 |
| `archive_failed` | 502 | yes | "Door43 could not provide the project archive. Try again later." | retry `release.prepare` | — | — |
| `invalid_version` (removal) | 400 | no | "Removing a book needs a new major version, at least <major>." | edit the version | — | R9 |
| `health_blocked` | 409 | yes | the health-check error or state | refresh health; retry when Door43 recovers | Health-check error | H2 |
| `warning_not_acknowledged` | 409 | after confirmation | "The health check reported warnings. Review them and confirm to release anyway." | show the warnings; resend with `acknowledge_warnings: true` | Health warning | H2 |
| `release_failed` | 502 | yes | "Release creation failed: <error message>." | retry; the temporary branch is kept | Release creation failure | R7 |
| `release_outcome_unknown` | 502 | via lookup | "Door43 did not confirm the release." | run `release.lookup` for the tag before retrying | Lost release response | R6, X1 |
| `release_exists` | 409 | no | "This release already exists on Door43." | open the existing release | Existing expected release found | R6 |
| `not_prerelease` | 409 | no | "This release is already a full release." | none | — | R8 |
| `already_released` | 409 | no | "This preparation has been released and cannot be discarded." | open the release | — | R7 |
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
GET  /api/owners?q=                                   owner.search
GET  /api/sources?owner=&stage=                       source.search
POST /api/projects/{owner}/{repo}/imports/plan        import.plan
POST /api/projects/{owner}/{repo}/imports             import.apply
POST /api/projects/{owner}/{repo}/uploads/plan        upload.plan
POST /api/projects/{owner}/{repo}/uploads             upload.apply
```

**Web client.** Generated or hand-written against `shared/schema`; each wizard and stepper step calls exactly one operation. The wizard's last step maps to `upload.plan` and `upload.apply`, or `owner.search`, `source.search`, `import.plan`, and `import.apply`. The stepper in product spec §10 maps as: set selection states → `release.plan` and the selection; review snapshot → `release.prepare`; health → `preparation.read`; notes and version → client state; create → `release.create`; promote → `release.promote`.

```
POST /api/projects/{owner}/{repo}/preparations/{id}/discard  preparation.discard
```

**MCP (deferred).** One tool per operation with the same input and output schemas, the same error codes, and the same plan-before-apply requirement, so an agent operating tC Admin follows the same safety path as a manager. No new logic in the MCP layer.
