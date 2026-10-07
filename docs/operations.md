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

Shapes are described as fields; the shared schema package (`shared/schema`, [architecture.md](architecture.md) §10) is the executable form and the source the Worker, web client, and tests import. `shared/test/catalog.test.ts` checks the schema against sections 3, 5, 6, and 7 of this file and the identifiers in CONTEXT.md, so a change to either fails until the other follows.

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
  health:            { state, severity_raw, ref, checked_at, issue_count | null, issues: [{ code, rule | null, severity, title, details, suggestion }] | null, source: door43 }
  latest_full_release: { tag, version, sha, published_at, author } | null
  default_branch_head: { sha, committed_at } | null   (null for a repository without a commit: setup incomplete, or empty, E10)
  active_preparation: { id, state, version } | null
  setup:             { state: complete | incomplete, failed_step | null }
  permissions:       { push, admin, checked_at }
  freshness
```

The project summary `portfolio.list` returns is the part of the report the repository search carries (E7, E32): `ref`, `title` (the repository name when Door43 has no title), `description`, `default_branch`, `language`, `project_type`, `metadata_format`, `editability`, `coverage`, `health`, and `permissions`. The search does not say which ref or when its health severity was checked, so a summary's `health.ref` and `health.checked_at` are `null`, and `health.issue_count` and `health.issues` are `null` until the health-check read (#25, #36).

`health.state` is one of the health states in [domain-model.md](domain-model.md) section 5. `editability.reason` is one sentence in glossary language, for example "Resource Container project. Import it into a new project to manage it here."

### Plan

```
plan
  id, operation, created_at, expires_at
  bound_to:    { default_branch_sha | null, release_tag | null, release_tag_sha | null }
  preview:     operation-specific (section 4)
  would_write: [ { kind: repo | branch | commit | tag | release, target } ]
  warnings:    [ { code, message } ]
```

A plan expires after thirty minutes (`worker/src/operations/plans.ts`) and is invalid once `bound_to` no longer matches Door43. `default_branch_sha` is `null` only for `project.create.plan`, which has no source commit. A plan lives in Workers KV under its id, together with what its apply needs, and its id is the apply's idempotency key.

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
| `language.list` | read | 1 | — | — | #28 |
| `owner.list` | read | 1 | — | A2 | #28 |
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

- Inputs: `show`, `supported` (the default) or `all` (ADR 0014); optional filters (organization, language, project type, health state) and sort; filters are applied by the client where the whole portfolio is already loaded.
- Door43 reads: repository search for the signed-in user, every page, de-duplicated by repository id (carried over from the prototype); with `show: supported`, filtered by Door43 to `metadataType=sb` and `flavor` `textTranslation` or `textStories` (E41). Per-project type, coverage, and health come from the catalog metadata in that response (E12); no archive is downloaded.
- Returns: `{ organizations: [{ name, projects: [project summary] }], freshness, analysis: { complete, pending } }`. Projects appear immediately with `health.state = never_checked` and `coverage.present = null` until analysis completes (H3).
- Filters: non-archived repositories with explicit push or admin permission (P1, P2). Nothing else is filtered out beyond the `show: supported` search filter.
- Order: owner groups by name, the account's own repositories last (product spec §2); projects in a group by repository name. The configurable sort is #24. Because the catalog metadata arrives with the search, analysis is complete when the list is (`analysis.pending = 0`).
- Errors: `session_expired`, `door43_unavailable`, `portfolio_too_large` (the prototype's read limit, retained until Milestone 3 performance work).

### `project.read`

- Inputs: `{ owner, repo }`.
- Door43 reads: the repository (E14 supplies `metadata_type`, `flavor`, `ingredients`, `healthcheck_severity`, and `catalog.prod` as the latest full release with its tag and commit SHA, `catalog.preprod` as the latest pre-release, `catalog.latest` as the default-branch head); the health result for the default branch (E15) for the issue counts. No archive download (Q17); `coverage.basis = catalog`.
- Classification (`worker/src/model/project`, #19): `project_type` from the Scripture Burrito `flavor` (E14, E42, Q11, Q23), `bible` for `textTranslation`, `obs` for `textStories`, `other` for any other flavor or none; Door43's catalog `subject` is not read; `coverage.scope` from the books the catalog lists, `nt` when only New Testament books are listed, `ot` when only Old Testament books are, `full` when both, `obs` for Open Bible Stories, `unknown` otherwise, with `target` 27, 39, 66, 50, or `null` (H5); `coverage.present` is `null` when Door43 lists no ingredients or lists no recognized unit but a directory it does not itemize (H3). The search item carries no `currentScope` (E32); a caller that has read the catalog metadata (E20) may supply it and the scope widens to cover it.
- Returns: the project report.
- Errors: `not_found`, `permission_denied` (the repository is not writable), `session_expired`, `door43_unavailable`.

### `project.refresh`

- Inputs: `{ owner, repo } | null` (null refreshes the portfolio).
- Effect: invalidates tC Admin's cache for the target and performs the corresponding read live. No Door43 write.
- Returns: the refreshed project report or portfolio with `freshness.source = live`.

### `project.create.plan`

- Inputs: `{ owner, project_type: bible | obs, title, abbreviation, language: { code, title, direction: ltr | rtl | null }, testament_scope: nt | ot | full | null, flavor: { projectType, translationType, audience } | null, license }`. `owner` is one of the account's organizations or the account itself. `testament_scope` is required for `bible` and sets `currentScope`; it is null for `obs`. `language.direction` is the script direction when Door43's language list gives it (E25) and becomes the language's `scriptDirection`. `flavor` is a Bible's translation details (CONTEXT.md), each field optional and spelled as the Scripture Burrito `textTranslation` flavor spells it with the values the schema enumerates (E44), because they are written to `type.flavorType.flavor` as given; what a client does not send is written as the defaults `standard`, `firstTranslation`, and `common` (decided 5 October 2026, Q4). For `obs` it is absent, null, or empty. `license` is `cc-by-sa-4.0` in Milestone 1 (Q20).
- Computes: `repo_name = lowercase(language.code) + "_" + lowercase(abbreviation)`, as in `en_ult`; the `metadata.json` the schema requires (E37, E44, Q4), written by `worker/src/model/burrito` and by nothing else (W1): the flavor `scripture/textTranslation`, with the translation details given and the defaults for the rest and `usfmVersion` `3.0` (Q4), or `gloss/textStories`; `identification.name` and `abbreviation` from the inputs and `identification.primary.dcs` naming `<owner>/<repo_name>` at revision `master`; the `dcs` id authority as `https://git.door43.org` (E24); tC Admin as generator with its version and the signed-in manager as user; `currentScope` with every book of the testament scope; `copyright.licenses` naming the license ingredient; the license text as `ingredients/license.md`, the one ingredient, with the size and md5 of the file (R10); and no `relationships` until an import adds one (E24). The files are `metadata.json`, `ingredients/license.md`, and `README.md`. An Open Bible Stories project (`obs`, #82) has no testament scope, and a non-null one is `validation_failed`; its `type` is `gloss/textStories` with the fixed `currentScope` Door43 writes for every Open Bible Stories repository, the passages the fifty stories draw on (E46, Q4; `worker/src/model/obs-scope.ts`), since the schema allows no empty scope (E44).
- Checks: the account is signed in (read live from `/user`); the owner allows repository creation for this account: for an organization, a team of the account there is the owner team or may create repositories (`GET /user/teams`, E43), and anything less fails closed (A2); the account itself is accepted, since sign-in requests `write:user` for `POST /user/repos` (Q28), and Door43 decides at apply; `repo_name` is valid for Door43 and free in that owner (`GET /repos/{owner}/{repo}` answers 404; a repository there is `name_taken`); `abbreviation`, `title`, and a language present, the language's tag one the schema accepts (`model/language.ts`; Door43 lists tags it refuses, Q30); a Bible's translation details, when given, values the schema enumerates, and none for an Open Bible Stories project.
- Returns: `plan.preview = { repo_name, metadata_json, files: [{ path, size, md5 }] }`, `would_write = [repo, commit]`, `bound_to.default_branch_sha = null`. The plan is stored with the exact file contents, so the apply writes what the manager reviewed.
- Errors: `validation_failed`, `permission_denied`, `name_taken`, `session_expired`, `door43_unavailable`.

### `project.create.apply`

- Inputs: `{ plan_id }`, also sent as the `Idempotency-Key` header (§7); a header that names another plan is `validation_failed` before anything runs.
- Checks: the account is signed in (read live from `/user`); a receipt already stored under the plan id for this account is answered as it is and nothing is written again (§1 rule 6); the plan exists, was made by this account, and has not expired, else `plan_expired`; a plan that already created its repository (recorded on the plan before the commit, below) answers a setup-incomplete receipt for that repository and writes nothing, so its own repository is not taken for a name collision, except in the accepted window of Q29 (a creation answer that never arrived, a record the store refused or does not show yet), where the name reads as taken until `project.create.retry` reconciles it; otherwise the owner's creation right is read again (`GET /user/teams`, every page, for an organization, E43; A2) and the name is still free (`name_taken`).
- Door43 writes: `POST /orgs/{org}/repos`, or `POST /user/repos` for the account itself (E26, Q28), public, not initialized, default branch `master`; the created repository is recorded on the plan at once; then one `POST /repos/{owner}/{repo}/contents` with `metadata.json`, `ingredients/license.md`, and `README.md` from the plan as `create` operations (W5; shapes E21, E27, E45). Both carry the session's token and no author or committer, so Door43 attributes them to the signed-in manager (A3). Neither is retried (X1): a created repository whose answer could not be read is read back; a commit whose answer could not be read is an unknown outcome.
- Returns: `receipt.result = project report`, built from what was written because Door43's catalog reads the new repository a few seconds later (E28, E45): the project type, format `sb`, editable, coverage 0 of the testament scope's target or 0 of 50 stories (H5) with basis `archive` (the metadata just written, not Door43's catalog), health `never_checked` (H3), permissions from Door43's answer, the first commit as `default_branch_head`. If the repository was created but the commit failed, or its outcome is unknown, `receipt.result.setup = { state: incomplete, failed_step: first_commit }`, `default_branch_head` is `null`, `wrote` lists the repository only, and `warnings` carries `setup_incomplete`; the repository is never deleted (W4), and the plan is kept with the receipt and with what became of the commit (`first_commit.outcome`: `failed`, or `unknown` when Door43 may have made it) for `project.create.retry` (#31). The receipt is stored under the plan id for a day. The wizard's last step may follow with `upload.plan` or `import.plan` to add books or stories at once.
- Errors: `plan_expired`, `permission_denied`, `name_taken`, `validation_failed` (Door43 refused the name), `session_expired`, `door43_unavailable`. A failed first commit is the `setup_incomplete` warning above, not `commit_failed`.

### `project.create.retry`

- Inputs: `{ owner, repo }` of a setup-incomplete project.
- Effect: re-attempts the first commit from the recorded plan. Milestone 2 generalizes this into `project.create.resume` from any step.
- Errors: `commit_failed`, `permission_denied`, `not_found`.

### `language.list`

The wizard's language field (Q20): every language Door43 lists, for the browser to search by tag, native name, English name, and alternate names, since the list is one read and a plain dropdown of nine thousand entries is no field.

- Inputs: `{ owner | null }`.
- Door43 reads: `GET /languages/langnames.json` (E25), every entry in Door43's order; with `owner`, also `GET /catalog/list/languages?owner=<owner>&stage=latest` (E25), the languages that owner has repositories in, so the wizard can show those first.
- Returns: `{ languages: [{ code, title, english, direction: ltr | rtl | null, alternates: [name], tag_accepted }], owner_languages: [code] | null, freshness }`. `title` is the native name and `english` the English name, empty when Door43 has none. `tag_accepted` says whether the Scripture Burrito schema accepts the tag as a language tag (E44, `worker/src/model/language.ts`): Door43's list carries tags it refuses (472 of 9,166 on 6 October 2026, Q30), and the wizard offers such a language as not choosable, saying why, since `project.create.plan` refuses the tag (W1). `owner_languages` is `null` when no owner was named and empty for an owner with no catalog entry.
- Errors: `session_expired`, `door43_unavailable`.

### `owner.list`

The owners the wizard offers: only those Door43 lets the signed-in account create a repository in, so a manager works only with owners they have write access to (decided 6 October 2026 by Rich; product spec §6).

- Inputs: none.
- Door43 reads: `/user`; `/user/teams`, every page (E43), the same read `project.create.plan` and `project.create.apply` make for the owner chosen (A2).
- Returns: `{ owners: [{ login, name, kind: organization | account }], freshness }`: every organization in which a team of the account is the owner team or may create repositories, each once, by name, then the account itself, which creates under its own namespace with the `write:user` scope sign-in requests (Q28). An organization the account belongs to without that right is not returned; a missing or non-boolean grant counts as none (A2 fails closed).
- Errors: `session_expired`, `door43_unavailable`.

### `release.plan`

Candidate detection and everything the manager needs to decide, with no writes.

- Inputs: `{ owner, repo }`.
- Door43 reads: `/user` (the account the plan is stored for); the repository (`catalog.prod` for the baseline tag and commit SHA, `catalog.latest` for the default-branch head, E14; its permissions, read strictly, P2); the catalog entry for each of the two refs by name (E20) to map book code to path; the recursive git tree for each ref at the commit the repository named, every page (E19, E52), so the plan binds to what it compared. No archive download.
- Checks: the account may push to the repository (A2, else `permission_denied`); the project is editable, a Scripture Burrito Bible or Open Bible Stories project (W2, else `not_releasable` with the editability reason); the default branch has a commit (else `not_releasable`); each catalog entry names the commit the tree was read at, else the plan is `door43_unavailable`, retryable, and nothing is stored.
- Computes: for a Bible project, every book the catalog lists on the default branch or in the baseline release, with its group by comparing the blob SHA the tree gives its path across the two refs (E18): in this order, one group each: `unknown` when either ref's catalog lists the book but that ref's tree has no file at its path; else `new` when only the branch has it; else `unchanged` when the release has it and the branch's catalog no longer lists it, or both have it with the same SHA; else `changed_released`. A book the branch no longer lists is carried forward by default, named in the draft's carried-forward list, and may be left out; and its default selection state (R4): `include` for every book when there is no baseline; otherwise `carry_forward` for every released book and `leave_out` for every new one, so the plan's `removals` is empty. The root files of the default branch, except `metadata.json`, and its `.gitea/` files are `administrative`, always carried (R1, Q22); administrative ingredients and unknown files under `ingredients/` are #20's classification and join then. For an Open Bible Stories project the stories come from the tree, `ingredients/content/<NN>.md` (E36), since the catalog lists only the container (E47): every story on the default branch is `include`, the whole branch, and a story the release had that the branch no longer has is `leave_out` and listed in `removals` (R2). The proposed version from the baseline (R9, Q19): `first` when there is no release, the tag is a bare year, or it is no version at all (`v1.0.0`), else the highest of `removal` (major, when the selection leaves a released book out), `new_books` (minor, a new book included), or `revisions` (patch, a changed book included or metadata only); a draft of the release notes in markdown (product spec §10: added, revised, removed, carried forward, unknown files included, the version, the source commit). The merged metadata's `currentScope` will list exactly the released books (Q7).
- Returns: `plan.preview = { books: [{ id, group, selection: include | carry_forward | leave_out }], removals: [id], administrative: [path], version: { baseline_tag, proposed, rule_applied: first | removal | new_books | revisions }, notes_draft }`, `bound_to` with the default-branch SHA and the baseline tag and SHA (R5). The client sends the manager's selection to `release.prepare`, which recomputes `removals` and the version from it. `would_write` is the branch and as many commits as uploading every file of the default branch would need at 32 MB of raw content a commit: the books in order, then every other file in path order, as the prepare uploads them, a size the tree does not give counted as a full commit, and the merged `metadata.json` as one commit more, its size unknown until the prepare merges it (Q22), all on `temp-tca-release/<proposed version>`; the prepare writes on the branch of the confirmed version and makes no more commits than announced (R3, W5). The plan is stored with every candidate's path and SHA on both refs, for the prepare.
- Errors: `not_releasable` (unsupported project, or no commit yet), `permission_denied`, `not_found`, `session_expired`, `door43_unavailable`.

### `release.prepare`

- Inputs: `{ owner, repo, plan_id, selection: { <book id>: include | carry_forward | leave_out }, unknown_included: [path], version | null }`. For an Open Bible Stories project `selection` is empty, and every story on the default branch is included (ADR 0013).
- Checks: a receipt already stored under the plan id is answered as it is (§1 rule 6); the plan exists, was made by this account for this project, and has not expired (`plan_expired`); permission re-read, strictly (A2); the project is `editable` (W2, else `not_editable` with the reason); `bound_to` matches Door43's default-branch head and latest full release, tag and commit (R5, else `source_changed`); every book in the plan has a state, none outside the plan is named, a book is included only when the default branch has it and carried forward only when the release has it (`validation_failed` naming `selection`), and at least one book is included or carried forward (R4, `invalid_selection`); every `unknown_included` path is an unknown file of the default branch; the version, when given, is valid and after the baseline, and a major increment when a released book is left out (R9, `invalid_version`); otherwise the version is recomputed from the selection as `release.plan` computes it.
- Door43 reads: the `/sb/` archive for the default branch (E17), inflating one entry at a time, the source of included books' bytes (ADR 0008). The release-tag archive is read only to recompute size and md5 for the merged metadata; carried-forward books are never uploaded (Q22).
- Door43 writes: `POST /branches` creating `temp-tca-release/<version>` with `old_ref_name` set to the release's commit, or to the default-branch head for a first release or for an Open Bible Stories project (ADR 0010; a branch already there is `preparation_active`, and when no preparation names it, one is stored as `retryable_failure` naming the branch so the manager can discard it; decided 7 October 2026); then one or more `POST /contents` on that branch (Q22): for each included book from the default-branch archive, `create` when the branch's start ref lacks its path and `upload` when it has one (E27); `delete` with its blob SHA (E21) for every path under `ingredients/` on the start ref that the snapshot does not name, so the branch's `ingredients/` is exactly `snapshot.files`: a released book whose state is `leave_out` (R2), a renamed book's old path, an unknown file the manager did not include (S5), and, on a first release, each left-out book; `upload` for each root file, `.gitea/` file, and administrative ingredient whose blob on the default branch differs from the one the branch started with, so a carried-forward book and an unchanged root file are never uploaded (R1), and `delete` for an administrative ingredient the release had that the default branch no longer lists, and for a root or `.gitea/` file the start ref has that the default branch's tree no longer has (by the trees, E19, since the archive does not carry every root file, E17; one on both refs stays; decided 7 October 2026); `upload` for each unknown file the manager included; and the merged `metadata.json`, last. The uploads, the metadata counted, fall into commits of at most 32 MB of raw content (`worker/src/model/snapshot.ts`), the deletions and the metadata in the last, each commit's bytes read from the archive only when it is sent; the plan announced as many commits as uploading every file of the default branch would need, and the apply makes no more (R3, W5); a snapshot that needs more, or a file larger than one commit, is refused as `unexpected` before the branch is created. Once the branch exists, any failure stores the preparation as `retryable_failure` before it is reported (R7). The merged `metadata.json` carries exactly the included and carried-forward books plus the default branch's administrative entries, every top-level field from the default branch's current metadata, `localizedNames` kept for the released books only (a removed or left-out book leaves the names as it leaves the entries; a key that is no book code stays), `currentScope` equal to the released books, size and md5 recomputed from the bytes read for every file, the carried books' from the release's archive (Q7, Q8; R1, R2, R3, R10, W5; #35). For an Open Bible Stories project the only content write is the refreshed `metadata.json`.
- Door43 reads, besides the checks: the default branch's archive (E34), for the included books, the administrative and unknown files, and the metadata; the release's archive, when books are carried, for their sizes and checksums; the git trees of both refs (E19), for the blobs that need no upload and the SHAs a deletion needs.
- Returns: `receipt.result = preparation` in state `health_checking`, since Door43 checks every push (E28), with `snapshot.files` naming every file's source (`tag` or `default_branch`), the selection as `new`, `revised`, and `unknown_included`, the version proposed and confirmed, the notes draft for the confirmed selection, and the history from `selecting`. The preparation is stored under the project and its id, the version, for thirty days; the receipt under the plan id for a day.
- Errors: `plan_expired`, `validation_failed`, `source_changed`, `invalid_selection`, `invalid_version`, `permission_denied`, `not_editable`, `preparation_active`, `archive_failed` (an archive without metadata tC Admin can read), `commit_failed`, `door43_unavailable`. On `commit_failed`, or a commit whose outcome is unknown (X1), the branch is retained (R7), nothing is retried, and the preparation is stored as `retryable_failure` with the error; a second prepare of the same plan then finds the branch and is `preparation_active`, and the retry is the manager's through the preparation (#40).

### `preparation.read`

- Inputs: `{ owner, repo, preparation_id }`.
- Door43 reads: the repository, in every state and before the store is consulted, as the caller's access check (a repository the token cannot see is `not_found`), and for the default-branch head when the preparation is bound and not yet released (`snapshot_prepared`, `health_checking`, `health_blocked`, `ready_for_release`, `retryable_failure`); then, while the preparation waits on the check (`health_checking`, or `health_blocked` when the manager refreshes), the health check for the temporary branch (E15), once per call. Door43 checks every push, so no trigger is sent (E28). The client polls: every 5 seconds for 3 minutes after the push (`HEALTH_POLL` in the shared schema; #5 closed Q2 with those numbers), then offers a refresh. A 422 "no metadata found" for the branch means the check has not run yet and is `checking`, not `health_error`, inside or after that window; the preparation stays `health_checking`.
- Returns: the preparation, stored when its state or health changed. If the default-branch head moved since the plan, `state = restart_required`, before any health read (R5). Health maps per H1, with `health.issues` as Door43 listed them, `health.ref` the branch, and `health.checked_at` the time of the read. `healthy`, `info`, and `warning` move the preparation to `ready_for_release`; when the state is `warning`, `preparation.requires_acknowledgement` is true and the issues are there for the manager to read before `release.create` asks for `acknowledge_warnings` (H2, Q6). `failing`, `door43_unavailable`, and `health_error` move it to `health_blocked`, from which a further read is the manager's retry; `checking` leaves it `health_checking`. A released, discarded, restart-required, or not-yet-pushed preparation is answered as stored, with no health read.
- Errors: `not_found` (no preparation of that id for the project, or a repository the caller cannot see), `session_expired`, `door43_unavailable` (the repository read; a health check Door43 cannot answer is a `door43_unavailable` health state, not an error).

### `release.create`

- Inputs: `{ owner, repo, preparation_id, version, notes, prerelease: boolean, acknowledge_warnings: boolean }`.
- Checks, in this order and before any write: permission re-read, strictly, before anything about the preparation or its receipt is answered (A2); a receipt already stored for this preparation by this account is answered as it is while the preparation still records that receipt's release and snapshot commit, so one prepared again under the same id is not answered its predecessor's receipt (§1 rule 6); the preparation exists (`not_found`) and is `ready_for_release`, or `retryable_failure` after a release Door43 refused, which the manager retries; one that is released is `release_exists`, `restart_required` is `source_changed` (after the tag lookup below when its last attempt was not confirmed, R6), one whose last attempt was not confirmed is `release_outcome_unknown` until `release.lookup` settles it (R6), and every other state is `health_blocked` (H2); the snapshot health is `healthy`, `info`, or `warning`, the last with `acknowledge_warnings: true` (H2, Q6); `notes` non-empty after trimming (`validation_failed` naming `notes`); `version` valid, after the baseline, and not below the version confirmed at prepare, which already carried the major increment a removal needs (R9, `invalid_version`); `bound_to` re-read and unchanged, default-branch head and latest full release both, else `source_changed` and the preparation stored as `restart_required` (R5).
- Door43 writes: one `POST /releases` on the snapshot commit with the tag, the notes as the body, and the pre-release flag, which creates the tag with the release (E21, E27); only after Door43 has confirmed it, `DELETE` of the temporary branch (R3, R7). The preparation records the release before the deletion is attempted.
- Returns: `receipt.result = preparation` in `pre_release` or `full_release` with `release = { tag, url, prerelease }`, `version.confirmed` and `notes.confirmed` as sent; `wrote` lists the tag and the release, both on the snapshot commit. When warnings were acknowledged the receipt records it (`acknowledged_warnings: true`) and the history says so. A branch that could not be deleted after the release is a `warnings` entry (`branch_not_deleted`, with Door43's reason), not an error. The receipt is stored for the preparation for a day.
- Errors: `not_found`, `health_blocked`, `warning_not_acknowledged`, `invalid_version`, `validation_failed` (empty notes), `source_changed`, `permission_denied`, `release_failed` (Door43 refused with a 4xx: branch retained, state `retryable_failure` with the error, the retry is `release.create` again), `release_outcome_unknown` (Door43 did not confirm: no answer, a 5xx, 408, or other status that is not a refusal, or a 201 for another tag, commit, or flag; branch retained, state `retryable_failure`, nothing retried, X1; the next `release.create` of that preparation re-reads the permission (A2) and then looks the tag up (R6): a release found on the snapshot commit is recorded on the preparation and answered as `release_exists`, one on another commit is `release_exists` with the preparation unchanged, and none found lets the create proceed), `release_exists` (no release is created; a release found on the snapshot commit, at creation or by the lookup after an unconfirmed attempt, is recorded on the preparation and its branch deleted, a deletion that fails on its history; one on another commit is recorded as the preparation's last error when Door43 refused the creation, and leaves the preparation unchanged after an unconfirmed attempt, so a later call looks the tag up again).

### `release.lookup`

- Inputs: `{ owner, repo, tag }`.
- Door43 reads: `GET /repos/{owner}/{repo}/releases/tags/{tag}` (E21). Door43's 404, which a missing repository also answers, is `found: false`, not a failure.
- Returns: `{ found: boolean, release: { tag, url, prerelease, target_sha } | null }`. `target_sha` is the commit the release targets: from the catalog entry Door43 carries on every release (`door43_metadata.commit_sha`, E20), since a release made on Door43's site names a branch as its target (Pendau's `v1.2` names `master`); from the target itself when it is a commit (one tC Admin makes, E27); empty when neither names one. Used before any retry after an ambiguous outcome (R6); a release is found after its temporary branch is deleted (E29).
- Errors: `session_expired`, `door43_unavailable`.

### `release.promote`

- Inputs: `{ owner, repo, tag }`.
- Checks: permission re-read, strictly (A2); the project is a Scripture Burrito Bible or Open Bible Stories project, as at `release.plan` (W2, `not_releasable`); the release exists under the tag (E21) and is a pre-release.
- Door43 writes: one edit of the release setting the pre-release flag false and nothing else (R8).
- Returns: `receipt.result = { tag, url, prerelease: false }`. The preparation the tag was created from (recorded by `release.create`, whose tag may be above the preparation id, R9), when it is `pre_release` and recorded this tag on the release's commit, follows the release to `full_release`. When Door43 already shows that release full (a promotion whose answer was lost), that preparation follows it with no write and an empty `wrote`; without such a preparation the answer is `not_prerelease`.
- Errors: `not_found`, `not_prerelease`, `not_releasable`, `permission_denied`, `promotion_failed` (Door43 refused, with its message, or did not answer, or answered for another release, tag, or commit, when no preparation follows; nothing retried, X1).

### `preparation.discard`

- Inputs: `{ owner, repo, preparation_id }`.
- Checks: permission re-read, strictly, before anything stored is answered (A2); a receipt already stored for this preparation by this account is answered as it is while the preparation is still `discarded` (§1 rule 6; a replacement prepared under the same version is discarded on its own); the preparation exists and has no release (`state` is not `pre_release` or `full_release`, else `already_released`); one whose last release attempt was not confirmed is looked up by tag first (R6): a release on the snapshot commit is recorded on the preparation, its branch deleted as after any release (R7), and the discard answered as `already_released`; one on another commit is `release_exists`, nothing deleted or stored. The UI asks the manager to confirm first.
- Door43 writes: delete the temporary branch (E21), the one write; none for a preparation never pushed (no snapshot) or already discarded.
- Returns: `receipt.result = preparation` in state `discarded`, terminal; `wrote` lists the branch when one was deleted.
- Errors: `not_found`, `already_released` (also when the lookup after an unconfirmed attempt finds this snapshot's release: it is recorded and its branch deleted, R7), `release_exists` (the lookup finds a release on another commit under the tag: nothing deleted or stored; the manager resolves it on Door43), `permission_denied`, `door43_unavailable` (the deletion Door43 did not do, with its reason: the branch stays and the preparation is `retryable_failure` with the error, and the retry is `preparation.discard` again, R7).

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

The owners an import can come from (product spec §8): the account's organizations first and always, then any owner found by partial name.

- Inputs: `{ q | null }`.
- Door43 reads: `GET /user/orgs` for the account's organizations, listed first; `GET /catalog/list/owners?owner=<q>&partialMatch=1&stage=latest` for every owner with a catalog entry whose name contains `q` (E35).
- Returns: `{ own: [{ login, name }], matches: [{ login, name }], freshness }`. `name` is the owner's display name, its login when Door43 has none.
- Errors: `session_expired`, `door43_unavailable`.

Built behind (#77, `worker/src/operations/owner-search.ts`, `worker/src/door43/owners.ts`), each the narrowest reading of the text above, for Rich to confirm:

- **`q` absent, empty, or blank** (after trimming): `own` only, `matches` empty, and the catalog is not asked.
- **`GET /user/orgs`** is read every page, as `GET /user/teams` is (E43, `readPages`), so an organization past the first page is listed. Its shape is recorded (`fixtures/door43/qa.door43.org/2026-10-05/user/user__orgs.json`, one organization, with E43) but not its paging; that it pages as Gitea documents (`page`, `limit`) is inferred. The login is `username`, the display name `full_name`.
- **The catalog is asked once**, with the query E35 recorded (`limit=50`); whether `/catalog/list/owners` pages, and what it answers for no match, are not recorded. More than fifty matches would show the first fifty. `data: null` is read as no match, as the catalog's language list answers for an owner it does not know (E25); any other shape that is not a list is `door43_unavailable`, never an empty `matches`.
- **`matches` is every owner the catalog lists**, organization or user account alike, since the catalog answers with Gitea's user shape for both (E35) and the output does not distinguish them.
- **Each list answers its own question**: an organization of the account that the search also matches is in both `own` and `matches`; the client presents `own` first.
- **Order and repeats**: each list by login, case-insensitive, as `owner.list` orders organizations; an owner Door43 lists twice in one list, by any spelling of its login, is listed once.
- **Errors**: a 401 from either read is `session_expired`; any other refusal or failure, including a 403 or 404, is `door43_unavailable`, since neither read names a project.

A live probe should record `GET /user/orgs?page=2&limit=50` and `GET /catalog/list/owners?owner=<a string no owner contains>&partialMatch=1&stage=latest&limit=50`, and whether the latter honors `page`, as a new E.

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
| `unknown_operation` | 404 | no | "This request is not an operation tC Admin offers." | check the route in the operation catalog | — | X2 |
| `unexpected` | 500 | no | "Something went wrong. Reference <request_id>." | report with the request id | — | X2 |

## 7. Projections

**HTTP (Milestone 1).** One route per operation under the same-origin `/api/` prefix, fixed by #7 in `shared/schema/operations.ts`, which the Worker's router and the web client both read. Reads are `GET`, plans and applies are `POST` (`project.refresh` is a `POST` because it invalidates the cache). A `{name}` segment fills the input field of that name; a `GET` takes the rest of its input from the query string and a `POST` from a JSON body. Every `POST`, and `POST /auth/logout`, is a browser mutation and passes two checks before anything runs (A4, #13): its `Origin` header must be the Worker's own origin, and, when the request carries a session, its `x-csrf-token` header must be that session's CSRF token; otherwise the answer is `csrf_rejected` and the operation does not run. The token is a random value made at sign-in and held in the session record; the Worker issues it to the signed-in browser in the `x-csrf-token` header of every `/api/` response, so the browser keeps it in memory only, never in a cookie or in storage (A1). Reads need neither check. Applies also carry an `Idempotency-Key` header equal to the plan id. Both header names are constants in `shared/schema/operations.ts`. A response is the operation's output with status 200, or the error shape of section 2 with the status section 6 gives its code.

```
GET  /api/situation                                                   situation.read
GET  /api/portfolio                                                   portfolio.list
GET  /api/projects/{owner}/{repo}                                     project.read
POST /api/projects/{owner}/{repo}/refresh                             project.refresh
POST /api/projects/plan                                               project.create.plan
POST /api/projects                                                    project.create.apply
POST /api/projects/{owner}/{repo}/setup/retry                         project.create.retry
GET  /api/languages?owner=                                            language.list
GET  /api/owners/writable                                             owner.list
POST /api/projects/{owner}/{repo}/releases/plan                       release.plan
POST /api/projects/{owner}/{repo}/preparations                        release.prepare
GET  /api/projects/{owner}/{repo}/preparations/{preparation_id}       preparation.read
POST /api/projects/{owner}/{repo}/preparations/{preparation_id}/release   release.create
GET  /api/projects/{owner}/{repo}/releases/{tag}                      release.lookup
POST /api/projects/{owner}/{repo}/releases/{tag}/promote              release.promote
POST /api/projects/{owner}/{repo}/preparations/{preparation_id}/discard   preparation.discard
GET  /api/owners?q=                                                   owner.search
GET  /api/sources?owner=&stage=                                       source.search
POST /api/projects/{owner}/{repo}/imports/plan                        import.plan
POST /api/projects/{owner}/{repo}/imports                             import.apply
POST /api/projects/{owner}/{repo}/uploads/plan                        upload.plan
POST /api/projects/{owner}/{repo}/uploads                             upload.apply
```

`project.refresh` with a null input (the whole portfolio) has no route yet; #26 adds one or folds it into `portfolio.list`. Sign-in is outside `/api/` because the browser follows it, and is not a catalog operation (#12): `GET /auth/login` sends the browser to Door43 with the four scopes (Q10, Q28) and PKCE; `GET /auth/callback` (deployment.md §1) exchanges the code in the Worker, reads `/user`, and starts the session; `POST /auth/logout` ends it. A failed sign-in returns to `/?sign_in=<code>`: `session_expired` only when the sign-in did not start in this browser in the last ten minutes, was replayed, or Door43 refused the code or the new token; `door43_unavailable` when Door43 could not be reached or answered unreadably; `unexpected` with `&reference=<request id>` for any other failure, such as the session store, so the message quotes the id the log carries. Declining on Door43 returns to `/` with nothing to report. `POST /auth/logout` answers 204, or the error shape. Milestone 2 operations get routes with their shapes.

**Web client.** Typed against `shared/schema` (`web/src/api/client.ts`); each wizard and stepper step calls exactly one operation. The creation wizard (#28, `web/src/CreateProject.tsx`) calls `owner.list` for the owners it offers, `language.list` for its language field, `project.create.plan` to show what will be written, and `project.create.apply` to create. The wizard's last step maps to `upload.plan` and `upload.apply`, or `owner.search`, `source.search`, `import.plan`, and `import.apply`. The stepper in product spec §10 maps as: set selection states → `release.plan` and the selection; review snapshot → `release.prepare`; health → `preparation.read`; notes and version → client state; create → `release.create`; promote → `release.promote`; discard → `preparation.discard`.

**MCP (deferred).** One tool per operation with the same input and output schemas, the same error codes, and the same plan-before-apply requirement, so an agent operating tC Admin follows the same safety path as a manager. No new logic in the MCP layer.
