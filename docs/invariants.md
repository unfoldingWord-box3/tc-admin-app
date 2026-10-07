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
Changes on the default branch enter a release snapshot only through books the manager set to include. An included book comes from the default branch; a carried-forward book is the file from the release tag, untouched.
Source: product spec §10 snapshot rules; ADR 0003, ADR 0005.
Enforced in: `worker/src/operations/release-prepare` (snapshot assembly); `worker/src/model/candidates` (source of each file: a book comes from the branch only when its selection is `include`; `administrativeFiles` takes the root files and `.gitea/` from the default branch alone).
Verified by: contract test with a fixture where an unselected released book differs between tag and default branch; the snapshot must contain the tag version byte for byte. So far: the `R1:` tests in `worker/test/model/candidates.test.ts` and `worker/test/operations/release-plan.test.ts` (a changed book stays carried forward until included; the administrative files are the default branch's, never the baseline's), the `R1` test in `worker/test/operations/release-prepare.test.ts` (a carried-forward book is never uploaded and an unchanged root file is left alone; only the included books and the metadata reach the commit); and the `R1:` test in `worker/test/model/classify.test.ts`, over one ref at a time (a listed file without a scope, a root file, and a `.gitea/` file are administrative; an unlisted file under `ingredients/` and a path that cannot name one file inside the project are unknown and never carried, S5); the two-ref comparison and the carry are #33 and #34.
Issues: #33, #34.

### R2 — Removal is explicit and listed
A book present in the latest full release leaves a later release only when the manager set it to leave out. The plan's preview lists every removal, the release notes name each one, and the snapshot and its merged metadata drop exactly those books and no other. Nothing is removed by default or by omission (amended 1 October 2026, ADR 0013; before that, a released book could never be removed).
Source: ADR 0013; CONTEXT.md "Removed content", "Selection state".
Enforced in: `worker/src/operations/release-plan` (default selection carries every released book forward); `release-prepare` (deletes only books whose selection is `leave_out`); `worker/src/model/burrito` (metadata merge drops exactly the removed ingredients).
Verified by: the default selection on a project with a release contains no `leave_out`; a `leave_out` on a released book appears in `preview.removals`, is absent from the snapshot tree and the merged metadata, and every other released book is present byte for byte. So far: the `R2:` tests in `worker/test/model/candidates.test.ts` (no released book is left out by default, so the plan's removals are empty; one set to leave out is listed; an Open Bible Stories story the branch lost is listed), `worker/test/operations/release-prepare.test.ts` (a released book left out is deleted from the branch with its blob SHA, dropped from the metadata and the scope, and named in the notes) and `worker/test/model/notes.test.ts` (every removed book is named in the draft), and the `R2:` tests in `worker/test/model/burrito-merge.test.ts` (every book of the previous release is in the merged metadata when carried forward; one left out is gone from the entries and the scope and is listed as removed; a lost Open Bible Stories story is listed).
Issues: #33, #35, #38.

### R3 — A release never writes to the default branch
The only Door43 writes a release performs are: create the temporary branch, one or more commits on it (Q22), the tag, and the Door43 release. Nothing else, and nothing on the default branch.
Source: ADR 0008, ADR 0010; architecture §5.
Enforced in: `worker/src/operations/release-prepare`, `release-create`; the Door43 adapter exposes no write to a default branch from the release operations.
Verified by: recorded-request test asserting the exact set of write calls for a release; a plan's `would_write` list contains only those four kinds, and every commit is on the temporary branch. So far: the `R3, W5` tests in `worker/test/operations/release-prepare.test.ts` (the prepare's writes are the branch and the commits on it, no more than the plan announced, and none on the default branch) and the `R3, R7` test in `worker/test/operations/release-create.test.ts` (the release's writes are one release on the snapshot commit, which makes the tag, and the branch deletion after it).
Issues: #34, #39.

### R4 — Defaults publish nothing new, and a release needs a book
A first release starts with every book present included. A later release starts with every previously released book carried forward, changed or not, and every new book left out, so nothing new or changed is published unless the manager includes it. A release needs at least one included or carried-forward book (amended 1 October 2026, ADR 0013).
Source: product spec §10; CONTEXT.md "Selection state".
Enforced in: `worker/src/operations/release-plan` (default selection); `release-prepare` (rejects a selection with no included or carried-forward book).
Verified by: plan output on a project with a release has `carry_forward` for every released book and `leave_out` for every new one; on a project without a release, `include` for every book; a selection with nothing included or carried forward returns `invalid_selection`. So far: the `R4:` tests in `worker/test/model/candidates.test.ts` and `worker/test/operations/release-plan.test.ts` over the recorded Pendau refs (E52) and a synthetic changed and added pair; `invalid_selection` is #34.
Issues: #33.

### R5 — Preparation is bound to the source commit
Every release preparation records the default-branch commit SHA it was planned from. Before the snapshot is written and again before the release is created, the Worker re-reads the SHA. If it moved, the preparation becomes `restart_required` and is never silently merged with the new state.
Source: product spec §10 "Project has been edited"; architecture §6 stale source protection.
Enforced in: `worker/src/operations/release-prepare`, `release-create` (precondition check).
Verified by: fixture where the default-branch head changes between plan and apply; apply returns `source_changed` and writes nothing. So far: the `R5` binding in `worker/test/operations/release-plan.test.ts` (the plan carries the default-branch SHA and the baseline tag and SHA it compared, and reads each tree at that commit) and the `R5:` test in `worker/test/operations/release-prepare.test.ts` (a default branch that moved since the plan is `source_changed` and nothing is written); the re-check before release creation is #39.
Issues: #34, #40.

### R6 — Never a duplicate release
When release creation returns an ambiguous result, the Worker looks up the expected tag and release on Door43 before any retry. If one exists it is shown and nothing new is created.
Source: architecture §6 duplicate release protection; product spec §11.
Enforced in: `worker/src/operations/release-create` (the lookup before any retry after an unconfirmed attempt, and on a 409) and `preparation-discard` (the lookup before a discard after an unconfirmed attempt); `release-lookup` over `GET /repos/{owner}/{repo}/releases/tags/{tag}` (E21).
Verified by: simulated lost response followed by a fixture where the tag exists; retry returns `release_exists` and creates no release (the only write is the branch deletion of a release found on the snapshot commit, R7). So far: the `R6, X1` tests in `worker/test/door43/release-writes.test.ts` (a refused, an existing, and an unconfirmed release are told apart, and none is sent twice) and `worker/test/operations/release-create.test.ts` (a release Door43 did not confirm is `release_outcome_unknown`, the preparation says so, the next create looks the tag up first and, finding the release, creates nothing, answers `release_exists`, records a release on the snapshot commit on the preparation and deletes its branch as after any release (R7, decided 7 October 2026); finding none, it creates; a tag Door43 already has is `release_exists`); the lookup itself is `release.lookup` (#100).
Issues: #39, #40.

### R7 — The temporary branch outlives failure
The temporary branch is deleted only after release creation succeeds, or when the manager explicitly discards an unreleased preparation (`preparation.discard`, Q14). On health failure, commit failure, or release failure it is retained for inspection and retry.
Source: ADR 0003; architecture §6 branch lifecycle.
Enforced in: `worker/src/operations/release-create` (delete branch is the last step and runs only on success); `worker/src/operations/preparation-discard` (the one deletion, only for a preparation with no release, an unconfirmed attempt looked up first).
Verified by: failed release fixture leaves the branch; successful release fixture deletes it; deletion failure after success is reported as a warning in the receipt, not as a release failure; discard of a released preparation returns `already_released` and writes nothing. So far: the `R7, X1` test in `worker/test/operations/release-prepare.test.ts` (a commit Door43 refuses leaves the branch, is not retried, and the preparation is stored as `retryable_failure` with the error) and the `R7` tests in `worker/test/operations/release-create.test.ts` (a release Door43 refuses or does not confirm keeps the branch; the branch is deleted only after the release is confirmed and recorded; a deletion that fails is a `branch_not_deleted` warning on the receipt and the release stands; a release found by the lookup after an unconfirmed attempt is recorded first and its branch deleted after, a failed deletion put on the record) and the `R7` tests in `worker/test/operations/preparation-discard.test.ts` (an unreleased preparation is discarded by exactly one branch deletion; a released one is `already_released` and nothing is written; a deletion Door43 did not do leaves the branch and the preparation as `retryable_failure`, and the retry discards).
Issues: #34, #39, #58.

### R8 — Promotion changes only status
Promoting a pre-release changes the Door43 release's pre-release flag and nothing else: not the tag, not the version, not the contents.
Source: product spec §10 versioning and §13 pre-release promotion.
Enforced in: `worker/src/operations/release-promote` (single PATCH of the pre-release flag).
Verified by: recorded-request test asserting the PATCH body contains only the pre-release flag. So far: the `R8` tests in `worker/test/door43/release-writes.test.ts` and `worker/test/operations/release-create.test.ts` (the promotion is one PATCH whose body is `{ prerelease: false }`, against the recorded promotion of E27).
Issues: #39.

### R9 — The version is valid and moves forward
The final version is valid semver and greater than the latest full release on Door43, whichever tool created that release. Loose tags are coerced before comparison; a bare year or no release yields `v1.0.0`; a release that removes a book forces a major increment (ADR 0013, Q19).
Source: product spec §10 versioning; domain model §7.
Enforced in: `worker/src/model/version`; `worker/src/operations/release-create` (precondition).
Verified by: table-driven tests over the coercion and bump rules; edited version not greater than baseline returns `invalid_version`. So far: the `R9:` tests in `worker/test/model/version.test.ts` (`1974` and no release give `v1.0.0`; `v1.2` with a revision `v1.2.1`, with a new book `v1.3.0`, with a released book left out `v2.0.0`; `v105` coerces) and the `R9` test in `worker/test/operations/release-create.test.ts` (a version that is not valid, not after the baseline, or below the one confirmed at prepare is `invalid_version` and nothing is written).
Issues: #37.

### R10 — Every release is Scripture Burrito with true sizes and checksums
Every release tC Admin creates is Scripture Burrito assembled from the project's own files, and every ingredient in its `metadata.json` carries the size and md5 recomputed from the file actually in the snapshot. Base metadata is never trusted for these values.
Source: ADR 0008; product spec §7; evidence E5 (stale checksums in a real repository).
Enforced in: `worker/src/model/burrito` (a new project's ingredient entries, and the metadata merge, carry the size and md5 computed from the bytes written; `worker/src/model/md5`).
Verified by: the `R10:` tests in `worker/test/model/burrito.test.ts` and `md5.test.ts` (the license ingredient and every planned file carry the size and md5 of their bytes; md5 against the RFC 1321 suite and Node's digest) and in `worker/test/operations/project-create-plan.test.ts` (the preview's sizes and checksums are those of the stored files the apply writes). For the merge, the `R10:` tests in `worker/test/model/burrito-merge.test.ts`: over Pendau's archive, whose own metadata has stale checksums (E5), every merged entry carries the size and md5 of the file in the snapshot; a snapshot file without an entry, or an entry without a file, is refused.
Issues: #29, #35.

## H — Health and coverage truthfulness

### H1 — Door43 health is authoritative
Door43's health-check result is the health result. tC Admin maps severities to display states and never reinterprets a result into a more permissive release decision.
Source: ADR 0007; product spec §9.
Enforced in: `worker/src/model/health` (pure mapping, no local judgement); `worker/src/operations/release-create` (reads the state, adds no exceptions).
Verified by: mapping tests over every observed severity (the `H1:` tests in `worker/test/model/health.test.ts`, over the catalog severity and over one health-check read, with a severity outside the vocabulary as `health_error`); no code path sets `healthy` without a Door43 success result. So far: the `H1` tests in `worker/test/door43/health.test.ts` (the recorded success, info, and warning answers in tC Admin's words, the issues as Door43 wrote them) and `worker/test/operations/preparation-read.test.ts` (each result moves the preparation as domain model §6 says, and the health stored is the read's); the release gate is #39.
Issues: #25, #36.

### H2 — Health blocks release, and a warning needs acknowledgement
A failing, unavailable, errored, running, or never-run health check on the snapshot branch blocks release creation. A `warning` result does not block, but release creation requires the manager to have seen the warnings and confirmed they want to proceed; without that confirmation it is refused (decided 18 September 2026, Q6).
Source: ADR 0007 (amended); product spec §9 and §11; domain model §5.
Enforced in: `worker/src/operations/release-create` (precondition on `preparation.health.state`; `acknowledge_warnings` required when the state is `warning`).
Verified by: release attempt in each blocking state returns `health_blocked` and writes nothing; release attempt on `warning` without acknowledgement returns `warning_not_acknowledged` and writes nothing; with acknowledgement it proceeds and the receipt records the acknowledgement. So far: the `H2` tests in `worker/test/model/health.test.ts` (only `healthy`, `info`, and `warning` let a preparation go on) and `worker/test/operations/preparation-read.test.ts` (a warning result is `ready_for_release` with `requires_acknowledgement` and the warnings; failing, unavailable, and error results are `health_blocked`; a refresh from `health_blocked` reads again) and the `H2` tests in `worker/test/operations/release-create.test.ts` (every state short of ready is `health_blocked` and writes nothing; a warning without acknowledgement is `warning_not_acknowledged` and writes nothing; with it the release proceeds and the receipt records the acknowledgement).
Issues: #36, #39.

### H3 — Unknown is never shown as good
Unknown, unavailable, running, or never-checked health is never displayed as healthy. Unknown coverage is never displayed as complete or as zero.
Source: product spec §5; issues #19, #25.
Enforced in: `worker/src/model/health`, `worker/src/model/project` (coverage `present` is `null`, not `0`, when unknown); `web` renders each state distinctly.
Verified by: the prototype tests carried over by #7: the `H3:` tests in `worker/test/model/health.test.ts` (a missing or unknown severity is `never_checked`; a pending, unavailable, or failed health-check read is `checking`, `door43_unavailable`, or `health_error`, and no read but a success result is `healthy`), the `H3` tests in `worker/test/door43/health.test.ts` and `worker/test/operations/preparation-read.test.ts` (the 422 before the check has run stays `checking`), and the OBS container test in `worker/test/model/project.test.ts`. Coverage: the `H3:` tests in `worker/test/model/project.test.ts` and `worker/test/contract/project-catalog.test.ts` (no ingredients, a container directory, and unknown never equal to the target).
Issues: #19, #25.

### H4 — Health is never color alone
Every health state is conveyed with text or an icon in addition to color.
Source: product spec §5; architecture §8; roadmap Milestone 3 accessibility epic.
Enforced in: `web` health components (label map is the source of visible text).
Verified by: component test that every health state renders a visible label; Milestone 3 WCAG audit.
Issues: #8, #25, #50.

### H5 — Coverage is file coverage
Coverage counts recognized books present against the testament-scope target (27, 39, 66) for a Bible project, or stories against 50 for an Open Bible Stories project. It is never presented as translation completeness. It is computed from catalog metadata (E12), and it is distinct from a release's `currentScope`, which lists only released books (Q7).
Source: CONTEXT.md "Coverage"; product spec §5.
Enforced in: `worker/src/model/project` (coverage carries `basis` and `target`); `web` copy uses the glossary wording.
Verified by: the `H5:` tests in `worker/test/model/project.test.ts` over each scope, in `worker/test/contract/project-catalog.test.ts` over the seed repositories (E32), and in `worker/test/operations/project-create-apply.test.ts` (a new Open Bible Stories project's report counts 0 of 50 stories); UI copy review against CONTEXT.md.
Issues: #19, #24, #82.

## A — Access and identity

### A1 — Door43 credentials never reach the browser
No Door43 access token appears in JavaScript-visible state, browser storage, URLs, or client or server logs. The browser holds only an opaque HttpOnly session cookie.
Source: ADR 0001; architecture §2 and §8.
Enforced in: `worker/src/http/session` (token lives in Workers KV keyed by a hash of the session id; the cookie is HttpOnly, SameSite=Lax, and Secure on HTTPS); `worker/src/http` response serialization; logging redaction (the sign-in failure log carries only the code and the error kind).
Verified by: response-shape tests assert no token field on any route; log redaction test; Playwright smoke test inspects storage and URLs.
Issues: #12, #15, #51.

### A2 — Permission is checked live before every mutation
Before repository creation, any commit, branch change, release creation, or promotion, the Worker re-reads the repository permission from Door43. Ambiguity fails closed. A project the user lost access to leaves the writable portfolio.
Source: product spec §2; architecture §3 authorization.
Enforced in: `worker/src/operations` shared precondition used by every apply operation; for creation, `ownerForCreation` in `project-create-plan` reads the account's creation right in the owner (E43) at plan and again at apply, and `owner-list` offers the wizard only the owners that read allows, so the interface never shows a choice the Worker would refuse (the Worker still decides); the per-repository precondition is #14.
Verified by: each apply operation with a fixture lacking push permission returns `permission_denied` and writes nothing; a missing `permissions` object is treated as no permission. So far: the `A2:` tests in `worker/test/operations/project-create-plan.test.ts` and `project-create-apply.test.ts` (an owner that grants no creation right, a team without it, a non-boolean grant, or no team at all is `permission_denied` at plan and at apply, and nothing is written; in the plan tests, a granting team on a later page grants) and in `worker/test/operations/owner-list.test.ts` (an organization without the right is not offered, whatever the team order; a granting team on a later page is), and the `R5, A2` test in `worker/test/operations/release-create.test.ts` and the promote test beside it (a lost push right is `permission_denied` at release creation and at promotion, and nothing is written), and the `A2` test in `worker/test/operations/preparation-discard.test.ts` (a discard without push right is `permission_denied` and nothing is written).
Issues: #14, #30.

### A3 — Every write is attributed to the signed-in user
Every Door43 commit, tag, and release tC Admin creates is made with the signed-in manager's credential and carries their identity.
Source: ADR 0004; product spec §7.
Enforced in: `worker/src/door43` (no service account; requests use the session's token only; `writes.ts` sends no author or committer, so Door43 attributes every commit to the token's user).
Verified by: the `A3:` tests in `worker/test/door43/api.test.ts`, `writes.test.ts`, `worker/test/http/session.test.ts`, and `worker/test/operations/project-create-apply.test.ts` (every read and write carries the session bearer token and no other credential, and names no author or committer).
Issues: #12, #30, #39.

### A4 — Browser mutations are same-origin with a CSRF token
Every mutation from the browser passes a same-origin check and a CSRF token. Cross-origin requests are rejected.
Source: architecture §8; issue #13.
Enforced in: `worker/src/http/csrf` middleware ahead of every `POST` under `/api/` and of `POST /auth/logout`: the `Origin` header must be the Worker's own origin, and the `x-csrf-token` header must be the session's token, which `operations/sign-in` makes at sign-in and `http/app` issues to the signed-in browser in a response header, never in a cookie or a body.
Verified by: the `A4:` tests in `worker/test/http/csrf.test.ts` (a missing or foreign origin, a missing token, and a wrong token each answer `csrf_rejected` and the operation does not run; the token is issued only to a signed-in browser) and in `web/test/client.test.ts` (the client sends the issued token on every `POST` and on no `GET`).
Issues: #13.

## W — Writes and formats

### W1 — tC Admin writes one format
Every project tC Admin creates is Scripture Burrito with tC Admin recorded as generator. tC Admin never writes Resource Container, translationStudio, or translationCore metadata.
Source: ADR 0008.
Enforced in: `worker/src/model/burrito` is the only metadata writer.
Verified by: the `W1:` tests in `worker/test/model/burrito.test.ts` (a new Bible project's metadata validates against the recorded Scripture Burrito source schema, E44, for every testament scope, and names tC Admin as generator with the flavor `scripture/textTranslation`; a new Open Bible Stories project's validates with `gloss/textStories` and the fixed scope, E46) and in `worker/test/operations/project-create-plan.test.ts`; no writer for other formats exists.
Issues: #17, #29, #82.

### W2 — Only a Scripture Burrito project is ever written
tC Admin writes only to repositories it manages: Scripture Burrito Bible and Open Bible Stories projects. A repository in any other format, of any other type, or without recognized metadata is read for import and never written, released, or converted in place (amended 1 October 2026, ADR 0013).
Source: ADR 0013; architecture §5.
Enforced in: `worker/src/operations` editability precondition (`editable` required for upload, import, and metadata applies); the import operations read the source repository through the archive and write only the destination project.
Verified by: edit-class operations on an `unsupported` project return `not_editable` and write nothing; an import's recorded requests write only to the destination repository.
Issues: #21, #45, #46, #47.

### W3 — Project purpose is protected after the first save
The Scripture Burrito flavor is chosen in the wizard and cannot be changed through normal editing after the first valid metadata is saved.
Source: ADR 0006.
Enforced in: `worker/src/operations/metadata-apply` (Milestone 2) rejects flavor changes; the wizard (`web/src/CreateProject.tsx`) asks the project type once, right after the owner, and `project.create.plan` writes the flavor from it.
Verified by: a metadata plan that changes the flavor returns `validation_failed` (Milestone 2, #46). Until then: the `W1:` tests in `worker/test/model/burrito.test.ts` and `worker/test/operations/project-create-plan.test.ts` prove the flavor is written from the project type the wizard sends, and the review screen renders the project type the plan was asked for, not a later edit (`web/src/CreateProject.tsx`, bench round 1).
Issues: #28, #46.

### W4 — No automatic repository deletion
tC Admin never deletes a repository. A partially created project is shown as setup incomplete with a retry path.
Source: product spec §6; architecture §8.
Enforced in: the Door43 adapter has no repository-delete method (`worker/src/door43/writes.ts`); `project-create-apply` keeps the repository and answers `setup_incomplete` when the first commit fails.
Verified by: the `W4:` tests in `worker/test/door43/writes.test.ts` (the adapter exports no delete) and `worker/test/operations/project-create-apply.test.ts` (a failed first commit leaves the repository, lists it in the receipt, warns `setup_incomplete`, and keeps the plan for the retry; a replay of a plan whose repository is recorded on it, with no receipt yet, answers setup incomplete for that repository and writes nothing; a store that refuses the record does not stop the apply; a repository the plan could not learn of reads as a taken name, the accepted window of Q29).
Issues: #30, #31, #49.

### W5 — One operation, one commit
The accepted changes of one operation are committed together as one Door43 commit: the first commit of a new project and, in Milestone 2, an upload batch or a metadata edit with its proposed ingredient entries. The exception is a release snapshot whose selected books exceed one Worker request, which is prepared by several commits on the temporary branch and is still one release (Q22, ADR 0010).
Source: product spec §8; ADR 0004; ADR 0010.
Enforced in: `worker/src/door43/writes.ts` `commitFiles`, the multi-file contents call used by every committing operation.
Verified by: recorded-request tests assert exactly one contents call per apply, except `release.prepare`, where the number of contents calls equals the plan's announced commit count. So far: the `W5:` tests in `worker/test/door43/writes.test.ts` and `worker/test/operations/project-create-apply.test.ts` (one contents call with the plan's three files; the receipt's `wrote` equals the plan's `would_write`).
Issues: #30, #34, #45, #46.

### W6 — Upload paths are safe
Uploads reject absolute paths, path traversal, symlinks, executable behavior, and files or batches over the configured limits.
Source: product spec §8; architecture §5.
Enforced in: `worker/src/model/upload-paths.ts` `checkUpload`, which `upload.plan` runs first, before identification or any Door43 read: names are normalized to repository-relative paths and an absolute, traversing, backslash, control-character, empty-segment, or `.git` name is refused; an entry whose reported `mode` is a symlink, not a regular file, or executable is refused; so is a file or a batch over `MAX_UPLOAD_BYTES`, one value (the Q15 proposal), each as `validation_failed` naming the file.
Verified by: the table-driven `W6:` tests in `worker/test/model/upload-paths.test.ts` (each unsafe name, symlink, executable, and non-file entry refused naming the file; `./a.usfm` and Unicode names accepted as repository-relative; a file and a batch of exactly the limit accepted and one byte over refused). That `upload.plan` runs the check before anything else is #74's test.
Issues: #45, #51, #73.

### W7 — No metadata edit during an active preparation (Milestone 2)
Metadata edits are rejected while a release preparation for the project is active.
Source: product spec §7.
Enforced in: `worker/src/operations/metadata-apply` precondition on active preparations.
Verified by: metadata apply with an active preparation returns `preparation_active`.
Issues: #46.

## P — Portfolio truthfulness

### P1 — Nothing writable is hidden from show all
With "Show all projects" (`show: all`), every non-archived repository where the user has push or admin permission appears in the portfolio. Unsupported projects appear with a one-line reason; for a Bible or Open Bible Stories repository in another format the reason offers an import into a new project. By default (`show: supported`) every such Scripture Burrito Bible or Open Bible Stories repository appears, and the choice to show all is always on the page.
Source: ADR 0013, ADR 0014; product spec §2.
Enforced in: `worker/src/operations/portfolio-list` (no filter beyond writable and non-archived, and by default Door43's format and flavor filter); `worker/src/model/project` (editability with reason).
Verified by: the `P1:` tests in `worker/test/operations/portfolio-list.test.ts`: a fixture portfolio of the recorded seed repositories (E32) and sb, ts, tc, metadata-less, and Translation Words stand-ins lists every writable one with its `editability.state` and reason under `show: all`, and that mode sends Door43 no format or flavor filter; `web/test/portfolio-labels.test.ts` (only an editable project opens).
Issues: #21, #23.

### P2 — Missing permission grants nothing
A repository is writable only when Door43 explicitly returns push or admin permission for it. A missing or ambiguous permissions object means not writable.
Source: product spec §2; prototype behavior carried over by #7.
Enforced in: `worker/src/operations/portfolio-list` filter.
Verified by: the `P2:` tests in `worker/test/operations/portfolio-list.test.ts` (no permissions object, a non-boolean grant, or pull only is not writable; a read-only or archived repository is not listed).
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
Enforced in: `worker/src/door43` (`writeDoor43` sends a write once; no automatic retry); `worker/src/operations/*-apply`.
Verified by: the `X1:` tests in `worker/test/door43/writes.test.ts` (a write that times out raises after one request; a body that cannot be read keeps the status and is not sent again; a commit whose answer could not be read is an unknown outcome) and `worker/test/operations/project-create-apply.test.ts` (a first commit whose outcome is unknown, by a network failure or an unreadable answer, is not retried, is reported as setup incomplete with the outcome recorded on the plan, and a repeated apply answers the same receipt without writing).
Issues: #30, #40.

### X2 — Every failure is typed and recoverable
Every failure returns an error code from the catalog in [operations.md](operations.md), the user-facing message the specification fixes for it, whether it is retryable, the next action, and a request id.
Source: product spec §11; architecture §7.
Enforced in: `worker/src/http/errors` maps every thrown error to the catalog; unknown errors become `unexpected` with a request id.
Verified by: every catalog code has a test producing it; no route returns an uncataloged shape. So far: the `X2:` tests in `shared/test/catalog.test.ts` (the schema's codes, statuses, and messages are the catalog's), `worker/test/http/app.test.ts` (unknown routes and methods and unbuilt operations answer `unknown_operation`; invalid input and an output outside its schema all answer with the error shape), `web/test/client.test.ts`, and `web/test/create-project.test.ts` (the wizard shows a `validation_failed` at the field its `details.fields` path names, `name_taken` at the abbreviation, and `permission_denied` at the owner, each with the catalog message).
Issues: #15, #31, #40.

### X3 — Diagnostics never carry secrets or content
Diagnostics and logs may include request id, project, commit SHA, version, target ref, health state, and Door43 response status. They never include tokens, secrets, or file contents.
Source: architecture §7; Milestone 3 security review.
Enforced in: `worker/src/http/errors` and the logger's redaction list.
Verified by: redaction tests (so far the `X3:` test in `worker/test/http/app.test.ts`: the failure log carries the request id, code, and details, not the thrown message); security review checklist.
Issues: #51.
