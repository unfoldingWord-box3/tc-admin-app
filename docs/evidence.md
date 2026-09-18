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
Host: qa.door43.org (production sign-in also allowed by the prototype). Date: undated, before 18 September 2026. Source: prototype README and `door43.mjs`. Status: verified for read scopes. The OAuth token permissions the writes need are Q10.

### E9 — Seed repositories and their baselines
bahtraku/id_tb1 is Resource Container with 66 books and a release tag `1974`. bahtraku/Perjanjian-Baru-Pendau is Scripture Burrito with 27 New Testament books and a release tag `v1.2`.
Host: git.door43.org, copied to qa.door43.org. Date: 18 September 2026. Source: #3, #18 comment. Status: verified (tags observed in E1). Consequence: version rules must coerce `1974` (bare year, baselines at `v1.0.0`) and `v1.2` (loose tag, coerced to `v1.2.0`).

### E10 — Empty writable repositories exist in real portfolios
Managers have writable repositories containing only a license and a readme, with no subject or metadata.
Source: #49, ADR 0009. Status: reported by the DCS maintainer, undated. Consequence: the `unsupported` editability state (P1).

### E11 — The pilot partner uses every format
The pilot partner's active translation work is Scripture Burrito generated by Scribe; their older repositories are Resource Container; other partners still release translationStudio and translationCore repositories.
Source: ADR 0008, ADR 0009. Status: reported, undated. Consequence: release any valid format; edit only Scripture Burrito.

### E12 — The catalog metadata in the repository search is the same for every project type
The fields the repository search returns (E7: `subject`, `language`, `title`, `ingredients[]` with `exists`, `healthcheck_severity`, and the rest) are populated the same way for every metadata format and every subject, and are enough to classify a repository, count its coverage, and read its health without downloading an archive.
Source: stated by the DCS maintainer (Rich), 18 September 2026, closing Q17. Status: stated by the maintainer; the fixture recording under #19 confirms it for the Scripture Burrito seed repository (Q16). Consequence: `portfolio.list` and `project.read` read catalog metadata only; only `release.plan` downloads `/sb/` archives.

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

### Q6 — Does a `warning` health result on the snapshot block release? (closed)
**Decided 18 September 2026 by Rich:** a `warning` result does not block release creation, but the manager must be shown the warnings and asked to confirm they want to proceed. Failing, unavailable, errored, running, and never-run results still block.
Recorded in: invariant H2, ADR 0007 (amended), product spec §9 and §11, domain model §6, `release.create` in the operation catalog (`acknowledge_warnings`, error `warning_not_acknowledged`), #36.
Was blocking: #36, #39.

### Q7 — Does the release's `currentScope` list the released books, or the project's testament scope? (closed)
In plain terms: the release snapshot's `metadata.json` has a `currentScope` field naming which books the burrito contains. Does tC Admin write only the books actually in the release (so the list grows with each release), or the project's whole testament scope?
**Decided 18 September 2026 by Rich:** the release's `currentScope` lists just the books that are released. It grows as books are released and is never the full testament scope until every book is released.
Recorded in: product spec §10 snapshot rules, ADR 0010, #35. Coverage on the portfolio still counts against the testament scope (H5); the release scope is a different thing.
Was blocking: #35.

### Q8 — Which `metadata.json` is the starting point for a release's metadata?
In plain terms: when tC Admin assembles a release snapshot it writes a new `metadata.json`. There are two files it could start from:

- **(a)** the previous release's `metadata.json`, taken from the release-tag `/sb/` archive, then adding entries for newly selected books and updating entries for selected revisions; or
- **(b)** the default branch's `metadata.json`, taken from the default-branch `/sb/` archive, then removing the entries for books that are not in this release.

#35 and ADR 0010 currently say (a). The two differ when a manager has edited the default branch's top-level metadata since the last release (identification, copyright, localized names, language): with (a) the release keeps the previously released values unless tC Admin refreshes those fields from the default branch; with (b) the release picks up the edits automatically. Either way, ingredient size and md5 are recomputed from the files (R10) and administrative ingredients come from the default branch.
Blocks: #35. Owner: Rich.
Close by: choosing (a) or (b) here; if (a), naming which top-level fields refresh from the default branch. Then reflect it in #35 and ADR 0010.

### Q9 — Does the OAuth registration survive a QA reset?
Blocks: #4, #12 on QA. Owner: Rich.
Close by: #4 after the next reset; result recorded here and in the runbook.

### Q10 — Which Door43 OAuth token permissions do the Milestone 1 writes need?
This is about the OAuth `scope` parameter sent at sign-in (Gitea's token permissions), not the Scripture Burrito `currentScope` field, which is Q7.
In plain terms: the prototype signs in requesting `read:user read:repository read:organization`, which lets it list repositories but would be refused when it tries to create a repository, commit files, create a branch or tag, or create a release. Gitea's OAuth scopes include `write:repository` and `write:organization` (and `write:user`); which of these, at minimum, lets every Milestone 1 write operation succeed is not yet known, and asking for too much would violate least privilege (architecture §8).
Blocks: #2, #12, #30. Owner: Rich.
Close by: reading the OAuth scope list for the DCS Gitea version and confirming on QA that each write in the operation catalog succeeds with the minimal set; recording the set as a fact.

### Q11 — How does the portfolio show a writable repository with valid metadata whose type is neither Bible nor OBS? (closed)
**Decided 18 September 2026 by Rich:** a Translation Notes repository is a book package repository like a Bible repository: it has one file per book, `.tsv` instead of `.usfm`. It can be created and released through the same operations as a Bible project. The same holds for Translation Questions and Translation Words Links (CONTEXT.md "Book package repository").
Recorded in: CONTEXT.md (project type, book package repository, identifiers `project_type` and `content_structure`), domain model §3, operation catalog §5, #19, #21. Milestone 1 still exercises Bible only; the milestone that delivers creation and release for `tn`, `tq`, and `twl` is set at the Milestone 1 re-plan (roadmap). Subjects with no book or story structure (Translation Words, Translation Academy) remain `other`: listed, not releasable or editable in version one, with the reason stated.
Opens: Q18 (the Scripture Burrito flavor and book file pattern for each type).
Was blocking: #19, #21.

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

### Q17 — What is the portfolio's analysis source? (closed)
**Decided 18 September 2026 by Rich:** the catalog metadata in the repository search response is enough to know about a repository, and its fields are the same for every project type (E12). `portfolio.list` and `project.read` read catalog metadata only; only `release.plan` downloads `/sb/` archives. The project report's `coverage.basis` is `catalog`; a release plan's candidate detection is `archive`.
Recorded in: E12, operation catalog §1 rule 8 and §4, architecture §3, #18, #19, #24.
Was blocking: #18, #19, #24.

### Q18 — What Scripture Burrito flavor and book file pattern do Translation Notes, Translation Questions, and Translation Words Links use?
Opened by the Q11 decision. Creating one of these projects needs the flavor and minimum `metadata.json` (as Q4 does for Bible); releasing one needs the file name pattern that identifies a book file in the `/sb/` archive (Bible uses `.usfm` per book; these use `.tsv`).
Blocks: creation and release for `tn`, `tq`, `twl` (scheduled at the Milestone 1 re-plan). Owner: Rich.
Close by: downloading the `/sb/` archive of one repository of each type on QA, recording `metadata.json` and the file list as fixtures, and adding the flavor and pattern here as facts.
