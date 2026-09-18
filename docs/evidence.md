# tC Admin Evidence Register

Status: living document; started 18 September 2026
Audience: anyone, human or agent, about to assert something about Door43, Scripture Burrito, or the pilot repositories

Nothing in tC Admin's design is asserted about the outside world without an entry here. A **verified fact** has an identifier `E<n>`, a statement, and the evidence: host, date, method, and where the raw result lives. An **open question** has an identifier `Q<n>`, the decision or fact that is missing, who owns it, what it blocks, and how to close it. Inference and proposal are labeled as such.

## How to use this register

- **Before probing Door43, read this file.** If the fact is here and not stale, cite it instead of probing again.
- **Every live probe writes here.** A probe that changes or confirms a fact updates the entry with the new date; a probe that finds a new fact adds one (ADR 0012).
- **Staleness.** QA Door43 is reset from production periodically; facts observed only on QA are re-verified after a reset. Facts about DCS behavior are re-verified after a DCS release. Each entry names the host.
- **Closing a question** moves it to the verified section (as a fact) or to an ADR or the specification (as a decision), and the entry records where it went.
- **Fixtures.** When a probe's raw result is recorded, it lives in `fixtures/door43/` (proposed in ADR 0012) and the entry links it.

## Verified facts

### E1 — Door43 serves a Scripture Burrito archive for every ref and format
`GET /{owner}/{repo}/sb/{ref}.zip` returns 200 for Resource Container, Scripture Burrito, translationStudio, and translationCore repositories on both hosts. `.tar.gz` also works where tried.

| Repository (format) | Ref | `/sb/…zip` | `/sb/…tar.gz` |
| --- | --- | --- | --- |
| bahtraku/id_tb1 (rc) | master, 1974 | 200 | 200 |
| bahtraku/Perjanjian-Baru-Pendau (sb) | master, v1.2 | 200 | 200 |
| birch/es-419_tit_text_reg (ts) | master | 200 | not tried |
| birch/en_web_mrk_book (tc) | master | 200 | not tried |

Hosts: git.door43.org and qa.door43.org. Date: 18 September 2026, after the DCS release that added the rollup. Method: HTTP probe. Source: [#18 comment](https://github.com/unfoldingWord-box3/tc-admin-app/issues/18#issuecomment-5735911678). Status: verified. Supersedes E6. Closes the roadmap's hard dependency.

### E2 — Converted archives are complete Scripture Burrito
The rc, ts, and tc archives contain a `metadata.json` with `format: scripture burrito`, flavor `textTranslation`, generator `go-rc2sb`. Every ingredient listed is present with matching size and md5.
Host: qa.door43.org. Date: 18 September 2026. Method: archive content inspection. Source: #18 comment. Status: verified.

### E3 — A Scripture Burrito ref is rolled up byte for byte
The `/sb/` archive of a Scripture Burrito ref is a plain rollup: its `metadata.json` equals the one in `/archive/v1.2.zip` for bahtraku/Perjanjian-Baru-Pendau.
Host: qa.door43.org. Date: 18 September 2026. Source: #18 comment. Status: verified.

### E4 — Every archive has one top-level folder to strip
Every `/sb/` archive has a single top-level folder named after the repository in lowercase (`perjanjian-baru-pendau/`, `id_tb1/`). The archive client must strip it.
Host: qa.door43.org. Date: 18 September 2026. Source: #18 comment. Status: verified. Consumers: #18.

### E5 — Real repositories carry stale checksums
bahtraku/Perjanjian-Baru-Pendau's own `metadata.json`, written by Scribe, has a stale size or md5 for 28 of 30 ingredients. That is the repository's data, not the archive's doing, and it matches Door43's `warning` health severity for the repository.
Host: qa.door43.org. Date: 18 September 2026. Source: #18 comment. Status: verified. Consequence: invariant R10; #35 recomputes size and md5 for every file.

### E6 — Before the DCS change, Scripture Burrito refs had no `/sb/` archive (superseded)
On production before the change: `bahtraku/id_tb1/sb/master.zip` returned 200; `bahtraku/Perjanjian-Baru-Pendau/sb/master.zip` returned 404.
Host: git.door43.org. Date: 18 September 2026, before the release. Source: #18 body. Status: superseded by E1; kept so the history of the decision in ADR 0008 stays legible.

### E7 — Repository search returns the fields the portfolio needs
`GET /api/v1/repos/search?uid={user id}&exclusive=false&private=true&page=&limit=50` returns pages of repositories with `id`, `name`, `full_name`, `owner.login`, `archived`, `permissions.push`, `permissions.admin`, `default_branch`, `updated_at`, `title`, `subject`, `language`, `language_title`, `ingredients[] { identifier, path, title, exists }`, and `healthcheck_severity`. Pagination ends with an empty page.
Host: qa.door43.org. Date: undated, before 17 September 2026. Method: the prototype's live QA run with a test account across several writable organizations. Source: `prototypes/tc-admin/door43.mjs` and the prototype README's verification statement. Status: verified for field presence; the meaning of `ingredients[].exists` and whether `ingredients` is populated for Scripture Burrito repositories is inferred, see Q16.

### E8 — Door43 OAuth accepts PKCE and a confidential client for read scopes
Authorization at `/login/oauth/authorize` and token exchange at `/login/oauth/access_token` work with PKCE S256, scopes `read:user read:repository read:organization`, and a client secret sent only in the server-side exchange. A sign-in completed and repository discovery ran.
Host: qa.door43.org (production sign-in also allowed by the prototype). Date: undated, before 18 September 2026. Source: prototype README and `door43.mjs`. Status: verified for read scopes. Write scopes are Q10.

### E9 — Seed repositories and their baselines
bahtraku/id_tb1 is Resource Container with 66 books and a release tag `1974`. bahtraku/Perjanjian-Baru-Pendau is Scripture Burrito with 27 New Testament books and a release tag `v1.2`.
Host: git.door43.org, copied to qa.door43.org. Date: 18 September 2026. Source: #3, #18 comment. Status: verified (tags observed in E1). Consequence: version rules must coerce `1974` (bare year, baselines at `v1.0.0`) and `v1.2` (loose tag, coerced to `v1.2.0`).

### E10 — Empty writable repositories exist in real portfolios
Managers have writable repositories containing only a license and a readme, with no subject or metadata.
Source: #49, ADR 0009. Status: reported by the DCS maintainer, undated. Consequence: the `unsupported` editability state (P1).

### E11 — The pilot partner uses every format
The pilot partner's active translation work is Scripture Burrito generated by Scribe; their older repositories are Resource Container; other partners still release translationStudio and translationCore repositories.
Source: ADR 0008, ADR 0009. Status: reported, undated. Consequence: release any valid format; edit only Scripture Burrito.

## Stated in the design, not yet probed

These are asserted in the specification or architecture and shape the build. Each has an open question below that closes it.

| Statement | Where stated | Closes with |
| --- | --- | --- |
| Door43 verifies ingredient existence and size on branches and md5 on tags | product spec §7; #35 | Q1 |
| Door43 runs the health check on every pushed branch and tag; there is no trigger endpoint; the result is at `GET /repos/{owner}/{repo}/healthcheck?ref=` | product spec §9; architecture §3; #36 | Q2 |
| Health severities are `success`, `warning`, `error`, and possibly `info` | prototype `door43.mjs` | Q2 |
| `POST /orgs/{org}/repos` creates a repository; `POST /repos/{owner}/{repo}/contents` commits several files at once; releases are created with `POST /repos/{owner}/{repo}/releases` and edited with `PATCH` | #30, #34, #39 | Q3 |

## Open questions

Each question names an owner. An agent does not decide an open question; it records a proposal here, builds behind the current text, and asks the owner. Owners: Rich (DCS and Worker), Birch (product and acceptance).

### Q1 — What exactly does the health check verify on a branch and on a tag?
Blocks: #35, #36. Owner: Rich.
Close by: pushing a branch to a seed repository with one wrong size and one wrong md5 and reading the severity for the branch and for a tag on the same commit. Record the result as a fact and a fixture.

### Q2 — Health-check result shape, severity vocabulary, and latency
The response shape of `GET /repos/{owner}/{repo}/healthcheck?ref=`, the complete set of `healthcheck_severity` values, and the time from branch push to a fresh result on QA.
Blocks: #5, #25, #36. Owner: Rich.
Close by: #5 records the latency; a probe records the shape and vocabulary as a fixture; the poll constants (5 seconds for 3 minutes) are tuned from the numbers.

### Q3 — Exact Door43 operations for the Milestone 1 writes
Repository creation, multi-file commit, branch creation and deletion, release creation and editing, and how a release targets a commit. Includes whether the multi-file contents endpoint accepts a 66-book snapshot in one request (Q13).
Blocks: #30, #34, #39. Owner: Rich.
Close by: reading `https://qa.door43.org/swagger.v1.json` and probing each write on a `tc-admin-qa` repository; recording request and response fixtures.

### Q4 — Required Scripture Burrito metadata for the two flavors
The minimum valid `metadata.json` for `scripture/textTranslation` and, for Milestone 2, `gloss/textStories`, and whether Door43's health check accepts what the wizard generates.
Blocks: #29, #48. Owner: Rich.
Close by: validating a generated file against the Scripture Burrito schema and committing it to a `tc-admin-qa` repository until health is `success`; recording the file as a fixture.

### Q5 — Can a release target a commit whose branch is later deleted?
The snapshot commit lives on `temp-tca-release/<version>`, which is deleted after the release. The tag must keep the commit reachable.
Blocks: #39. Owner: Rich.
Close by: creating a tag and release on a QA branch, deleting the branch, and reading the release and its archive afterwards.

### Q6 — Does a `warning` health result on the snapshot block release?
The specification says only a successful result advances a release. Real repositories carry `warning` today (E5). If the snapshot's recomputed checksums clear the warning, the question may be moot for that cause, but other warnings exist.
Blocks: #36, #39. Owner: Birch.
Proposal (labeled): `warning` does not block, is shown prominently in the review step, and is listed in the release notes; `error`, `door43_unavailable`, `health_error`, `checking`, and `never_checked` block. Until decided, H2 blocks on everything but `success`.

### Q7 — Does the release scope list the released books, or the project's testament scope?
#35 currently sets `currentScope` to the released books.
Blocks: #35. Owner: Rich.
Close by: a decision recorded in #35 and reflected in product spec §10 and CONTEXT.md.

### Q8 — Is the base metadata for a release the previous release's, not the default branch's?
#35 currently starts from the previous release's `metadata.json`.
Blocks: #35. Owner: Rich.
Close by: a decision recorded in #35 and in ADR 0010.

### Q9 — Does the OAuth registration survive a QA reset?
Blocks: #4, #12 on QA. Owner: Rich.
Close by: #4 after the next reset; result recorded here and in the runbook.

### Q10 — Which OAuth scopes do the Milestone 1 writes need?
The prototype used read scopes only. Repository creation, commits, branches, and releases need write scopes, and the least-privilege set is unknown.
Blocks: #2, #12, #30. Owner: Rich.
Close by: reading the Gitea OAuth scope documentation for the DCS version and confirming each write on QA with the minimal set; recording the set as a fact.

### Q11 — How does the portfolio show a writable repository with valid metadata whose type is neither Bible nor OBS?
Translation Notes, Translation Questions, Translation Words, Translation Academy, and similar repositories are writable, have valid metadata, and are neither `release_only` (that state is for rc, ts, tc repositories of a supported type) nor `unsupported` (that state is for no recognized metadata). The prototype shows them as type Unsupported.
Blocks: #19, #21. Owner: Birch.
Proposal (labeled): `project_type: other`, `editability: unsupported` with the reason "<Subject> projects are not supported in this version"; neither releasable nor editable; still listed (P1). The roadmap defers their release.

### Q12 — Archive size against Worker limits
The largest expected `/sb/` archive (a 66-book aligned Bible) against Cloudflare Worker memory and CPU limits, for download, unpack, and re-upload in one request.
Blocks: #18, #34; Milestone 3 #52. Owner: Rich.
Close by: measuring `bahtraku/id_tb1/sb/master.zip` size and unpacked size, and reading the current Workers limits; recording both.

### Q13 — Multi-file commit limits
Maximum files and bytes per request for the multi-file contents endpoint, against a 66-book snapshot.
Blocks: #34. Owner: Rich.
Close by: probing on QA with the id_tb1 snapshot; recording the limit or the need to chunk (which would break W5 and needs an ADR).

### Q14 — Is a manager-initiated discard of a preparation in scope?
The specification retains the temporary branch on failure and deletes it on success, but has no cancel. An agent or a manager who abandons a preparation needs a way to clean up.
Blocks: nothing in Milestone 1. Owner: Birch.
Proposal (labeled): `preparation.discard` deletes the temporary branch of an unreleased preparation after confirmation; listed in the operation catalog as pending.

### Q15 — Safe upload byte limits (Milestone 2)
Blocks: #45. Owner: Rich. Close by: reading Worker request limits and Door43 contents limits; recording both.

### Q16 — What does `ingredients[].exists` mean, and is it populated for Scripture Burrito repositories?
The prototype counts coverage from `ingredients[].exists === true` in the search response. Whether Door43 populates `ingredients` for Scripture Burrito repositories the same way as for Resource Container is inferred, not observed.
Blocks: #19, #23. Owner: Rich.
Close by: reading the search response for bahtraku/Perjanjian-Baru-Pendau on QA and recording it as a fixture.

### Q17 — What is the portfolio's analysis source?
Per-project analysis in the portfolio can read the catalog metadata already in the search response (one call for the whole portfolio, coverage from `ingredients`, health from `healthcheck_severity`) or download the `/sb/` archive per project (exact, but one download per repository, heavy at 100 repositories).
Blocks: #18, #19, #24. Owner: Rich.
Proposal (labeled): the portfolio uses the catalog metadata; the archive is downloaded only by `project.read` when Q16 shows the catalog is insufficient, and always by `release.plan`. The project report's `coverage.basis` names which source produced it.
