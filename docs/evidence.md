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
Source: stated by the DCS maintainer (Rich), 18 September 2026, closing Q17. Status: verified 21 September 2026 by E14 (both seed repositories, both formats). Consequence: `portfolio.list` and `project.read` read catalog metadata only; archives are downloaded only when a release snapshot is assembled.

### E13 — DCS version on both hosts
QA reports `1.27.3+dcs.6-ga7ba9b25c1`; production reports `1.27.3+dcs`. The swagger's own deprecation notes refer to Gitea 1.23, so the underlying Gitea is 1.22 or later, which has scoped OAuth tokens.
Hosts: both. Date: 21 September 2026. Method: `GET /api/v1/version`. Status: verified.

### E14 — The repository API carries the whole catalog view of a project
`GET /api/v1/repos/{owner}/{repo}` (public for public repositories, no credentials) and each item of `GET /api/v1/repos/search` return, beyond Gitea's fields: `metadata_type` (`rc`, `sb`, `tc`, `ts`; the full vocabulary from `/catalog/list/metadata-types`), `metadata_version`, `subject`, `flavor_type`, `flavor`, `content_format`, `language`, `language_title`, `language_direction`, `language_is_gl`, `title`, `abbreviation`, `checking_level`, `books`, `licenses`, `relations`, `ingredients[] { categories, identifier, path, sort, title, versification, alignment_count, exists, is_dir, size }`, `healthcheck_severity`, `healthcheck_url`, and `catalog { prod, preprod, latest }`, each stage with `branch_or_tag_name`, `commit_sha`, `release_url`, `released`, `zipball_url`, `tarball_url`. `catalog.prod` is the latest full release (Pendau `v1.2`, id_tb1 `1974`), `catalog.preprod` the latest pre-release (null for both), `catalog.latest` the default branch. Ingredient paths are `./ingredients/1JN.usfm` for the Scripture Burrito repository and `./01-GEN.usfm` for the Resource Container one. The search endpoint also filters by `metadataType`, `subject`, `flavorType`, `flavor`, `healthcheckSeverity`, `is_healthy`, `book`, `lang`, `owner`, `uid`, `exclusive`, `private`, `archived`.
Host: qa.door43.org; production identical for Pendau. Date: 21 September 2026. Fixtures: `fixtures/door43/qa.door43.org/2026-09-21/repos/`. Status: verified. Closes Q16. Consequence: `metadata_format` is read from `metadata_type`, `project_type` from `subject` and `flavor_type`, and the release baseline (tag and commit SHA) from `catalog.prod`, with no release paging.

### E15 — Health-check endpoint shape and severity vocabulary
`GET /api/v1/repos/{owner}/{repo}/healthcheck?ref={ref}` is public and returns `{ ok, data: { issues: { <rule_code>: [ { issue_code, rule, severity_level, positive_title, negative_title, details, suggestion } ] }, overall_severity_level, severity_level_count: { error, warning, info, success } } }`. Severities are `error`, `warning`, `info`, `success`. `ref` is a branch or tag and defaults to the canonical catalog entry. An unknown ref returns 422 `{ ok: false, error: "no metadata found for repo [...] and ref [...]" }`. Rule sets differ by format: Scripture Burrito repositories report `sb_ingredient_mismatch` (rule META-015) and `sb_ingredient_missing`; Resource Container ones report `usfm_invalid`, `usfm_no_alignment`, `release_needed`, `tn_relation_missing`, `repo_name_lang_mismatch`, and others.
Host: qa.door43.org. Date: 21 September 2026. Fixtures: `healthcheck/`. Status: verified. Closes the shape and vocabulary part of Q2; latency stays open. Consequence: the poll treats a 422 with that message on a just-pushed branch as `checking` inside the poll window, not as `health_error`.

### E16 — Door43 checks ingredient sizes on branches and on tags, as warnings
Pendau `master` has 27 `sb_ingredient_mismatch` warnings and its tag `v1.2` has 55; each names the ingredient, the size in `metadata.json`, and the size on disk. Overall severity for both refs is `warning`. The rule's title covers sizes and checksums; only size mismatches were observed in the details.
Host: qa.door43.org. Date: 21 September 2026. Fixtures: `healthcheck/bahtraku__Perjanjian-Baru-Pendau__master.json`, `__v1.2.json`. Status: verified for size on both ref kinds; md5 inferred from the rule title. Narrows Q1. Consequence: a snapshot with recomputed sizes and checksums (R10) clears these; Pendau's remaining warning (`ingredient_title_is_en`, the Acts title still in English) will persist and exercise the Q6 acknowledgement in the demo.

### E17 — `/sb/` archive layout and size
Each archive has one top-level folder (the repository name lowercased), a `metadata.json`, the repository's own root `README.md` (and `LICENSE.md` when the repository has one), and one `ingredients/` folder. Pendau (Scripture Burrito rollup): 35 entries, 415 KB zipped, 1.2 MB unpacked, 30 ingredients (27 books plus `versification.json`, `license.md`, `scribe-settings.json` as administrative ingredients), 28 of 30 with stale size or md5 (E5, carried as-is). id_tb1 (converted from Resource Container by `go-rc2sb v0.5.0`): 71 entries, 1.5 MB zipped, 5.2 MB unpacked, 67 ingredients (66 books plus `ingredients/LICENSE.md`), 0 stale. Both downloaded in about one second. The converter writes `identification.primary.dcs` keyed by the repository's original full name (`Indonesian-Bible-Society/id_tb1`) with the commit SHA as revision and the conversion time as timestamp; `localizedNames` keys are `book-1ch` style, Scribe's are `MAT` style; ingredient `mimeType` is `text/plain` from the converter and `text/x-usfm` from Scribe.
Host: qa.door43.org. Date: 21 September 2026. Fixtures: `sb-archives/`. Status: verified. Narrows Q12: a 66-book unaligned Bible is far below Worker limits; an aligned Bible is larger and unmeasured.

### E18 — Conversion and rollup preserve book bytes exactly
The converted `ingredients/GEN.usfm` in id_tb1's archive is byte-identical to `01-GEN.usfm` on `master` (same md5, same git blob SHA `fcdd2dce…`). The rolled-up `ingredients/MAT.usfm` in Pendau's archive is byte-identical to the file on `master`.
Host: qa.door43.org. Date: 21 September 2026. Method: md5 and git blob SHA comparison against the raw file endpoint. Status: verified for one book per repository. Consequence: a book's git blob SHA is the same whether it sits in a Resource Container layout on the default branch or in a Scripture Burrito release commit, so change detection can compare blob SHAs from `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=true` (E19) instead of downloading archives.

### E19 — The git trees endpoint lists every blob with its SHA
`GET /api/v1/repos/{owner}/{repo}/git/trees/{ref}?recursive=true&per_page=1000` returns `{ sha, tree: [ { path, mode, type, size, sha, url } ], truncated, total_count, page }`; id_tb1 `master` has 69 entries, not truncated.
Host: qa.door43.org. Date: 21 September 2026. Fixture: `repos/bahtraku__id_tb1__git-trees__master.json`. Status: verified.

### E20 — Catalog endpoints serve metadata per ref without an archive
`GET /api/v1/catalog/metadata/{owner}/{repo}/{ref}` returns the Scripture Burrito `metadata.json` for a release tag or the default branch (8 KB for Pendau `v1.2`). `GET /api/v1/catalog/entry/{owner}/{repo}/{ref}` returns the catalog entry: `stage`, `commit_sha`, `metadata_type`, `ingredients[]` (as in E14), `healthcheck_severity`, `is_healthy`, `is_healthy_without_warnings`, `is_valid`, `released`. Release objects carry the same entry as `door43_metadata`.
Host: qa.door43.org. Date: 21 September 2026. Fixtures: `catalog/`. Status: verified. Caution: for a Scripture Burrito repository this metadata is the repository's own file, so its sizes and checksums can be stale (E5); it is not a substitute for recomputation (R10).

### E21 — The Milestone 1 write endpoints exist with these request shapes
From the QA swagger (`1.27.3+dcs+6-ga7ba9b25c1`): `POST /orgs/{org}/repos` (`CreateRepoOption`: `name`, `auto_init`, `default_branch`, `private`, `readme`, `license`, `description`); `POST /repos/{owner}/{repo}/branches` (`CreateBranchRepoOption`: `new_branch_name`, `old_ref_name` "branch/tag/commit to create from"); `POST /repos/{owner}/{repo}/contents` (`ChangeFilesOptions`: `files[] { operation: create | update | upload | rename | delete, path, content (base64), sha for existing files }`, `branch` (base), `new_branch`, `message`, `author`, `committer`); `DELETE /repos/{owner}/{repo}/branches/{branch}`; `POST /repos/{owner}/{repo}/releases` (`CreateReleaseOption`: `tag_name`, `target_commitish`, `prerelease`, `draft`, `body`, `name`, `tag_message`); `PATCH /repos/{owner}/{repo}/releases/{id}` (`EditReleaseOption`: `prerelease` among others); `GET /repos/{owner}/{repo}/releases/tags/{tag}` (200 for Pendau `v1.2`, the lookup R6 needs). Existing releases have `target_commitish: master` and `prerelease: false`.
Host: qa.door43.org. Date: 21 September 2026. Status: verified for existence and shape; not yet exercised with a token. Closes the endpoint part of Q3; the token probe remains.

### E22 — Health on the Resource Container release tag
id_tb1 tag `1974` reports `success` with zero issues under the Resource Container rule set.
Host: qa.door43.org. Date: 21 September 2026. Fixture: `healthcheck/bahtraku__id_tb1__1974.json`. Status: verified.

## Stated in the design, not yet probed

These are asserted in the specification or architecture and shape the build. Each has an open question below that closes it.

| Statement | Where stated | Closes with |
| --- | --- | --- |
| Door43 verifies md5 as well as size (size is verified on branches and tags, E16) | product spec §7; #35 | Q1 |
| Door43 runs the health check on every pushed branch and tag, including branches created through the API, with no trigger endpoint | product spec §9; architecture §3; #36 | Q2 |
| `go-rc2sb` preserves every book's bytes, not only the one checked per repository (E18) | E18 | Q3 token probe records a full-archive comparison |

## Open questions

Each question names an owner. An agent does not decide an open question; it records a proposal here, builds behind the current text, and asks the owner. Owners: Rich (DCS and Worker), Birch (product and acceptance).

### Q1 — Does the health check verify md5 as well as size, and on which refs? (closed for tags)
**Verified 22 September 2026 (E28):** md5 is verified on tags and reported as `sb_ingredient_mismatch`, severity `warning`; size is verified on branches and tags (E16). On the branch the same commit reported `success` 110 ms after the commit, which is either "md5 is not verified on branches" or a result for the previous commit. R10 recomputes both regardless, so nothing in Milestone 1 depends on the answer; the probe's `health-branch-recheck` step (a second poll after 8 seconds) settles it on the next run.

### Q2 — Health-check latency after a push, and whether API-created branches are checked (closed)
**Verified 22 September 2026 (E28):** API-created branches and tags are checked; the first result on a brand-new repository arrived within 5.6 seconds, later refs on the first poll. The poll constants (5 seconds, 3 minutes) stay as a ceiling. The intermediate response while a check runs was not observed in this run; the poll still maps a 422 "no metadata found" inside the window to `checking` (E15).

### Q3 — Do the Milestone 1 writes succeed, and does `target_commitish` accept a commit SHA? (closed)
**Verified 22 September 2026 (E27):** every write succeeded with an API token holding `write:repository` and `write:organization`; `target_commitish` accepts and records a commit SHA; `operation: upload` updates an existing file without a blob `sha`. The same scopes on an OAuth token are Q10's decided set.

### Q4 — Required Scripture Burrito metadata for the two flavors
The minimum valid `metadata.json` for `scripture/textTranslation` and, for Milestone 2, `gloss/textStories`, and whether Door43's health check accepts what the wizard generates.
Blocks: #29, #48. Owner: Rich.
Close by: validating a generated file against the Scripture Burrito schema and committing it to a `tc-admin-qa` repository until health is `success`; recording the file as a fixture.

### Q5 — Can a release target a commit whose branch is later deleted? (closed)
**Verified 22 September 2026 (E29):** yes; the release and its `/sb/` archive remain readable after the branch is deleted.

### Q6 — Does a `warning` health result on the snapshot block release? (closed)
**Decided 18 September 2026 by Rich:** a `warning` result does not block release creation, but the manager must be shown the warnings and asked to confirm they want to proceed. Failing, unavailable, errored, running, and never-run results still block.
Recorded in: invariant H2, ADR 0007 (amended), product spec §9 and §11, domain model §6, `release.create` in the operation catalog (`acknowledge_warnings`, error `warning_not_acknowledged`), #36.
Was blocking: #36, #39.

### Q7 — Does the release's `currentScope` list the released books, or the project's testament scope? (closed)
In plain terms: the release snapshot's `metadata.json` has a `currentScope` field naming which books the burrito contains. Does tC Admin write only the books actually in the release (so the list grows with each release), or the project's whole testament scope?
**Decided 18 September 2026 by Rich:** the release's `currentScope` lists just the books that are released. It grows as books are released and is never the full testament scope until every book is released.
Recorded in: product spec §10 snapshot rules, ADR 0010, #35. Coverage on the portfolio still counts against the testament scope (H5); the release scope is a different thing.
Was blocking: #35.

### Q8 — Which `metadata.json` is the starting point for a release's metadata? (closed)
**Decided 22 September 2026 by Rich:** the ingredient entries come from the previous release's `metadata.json` plus the selected books, so no released book is lost (R2); every top-level field (identification, languages, copyright, localized names, type, relationships) comes from the default branch's current metadata, where the manager maintains them; sizes and checksums are recomputed from the snapshot files (R10). For a first release everything comes from the default branch. Recorded in ADR 0010 (amended), product spec §10, `release.prepare`, #35.

The question as it was put, kept for the record. In plain terms: when tC Admin assembles a release snapshot it writes a new `metadata.json`. There are two files it could start from:

- **(a)** the previous release's `metadata.json`, taken from the release-tag `/sb/` archive, then adding entries for newly selected books and updating entries for selected revisions; or
- **(b)** the default branch's `metadata.json`, taken from the default-branch `/sb/` archive, then removing the entries for books that are not in this release.

#35 and ADR 0010 currently say (a). The two differ when a manager has edited the default branch's top-level metadata since the last release (identification, copyright, localized names, language): with (a) the release keeps the previously released values unless tC Admin refreshes those fields from the default branch; with (b) the release picks up the edits automatically. Either way, ingredient size and md5 are recomputed from the files (R10) and administrative ingredients come from the default branch.
Was blocking: #35. Resolved as (a) for ingredients with every top-level field refreshed from the default branch.

### Q9 — Does the OAuth registration survive a QA reset?
Blocks: #4, #12 on QA. Owner: Rich.
Close by: #4 after the next reset; result recorded here and in the runbook.

### Q10 — Which Door43 OAuth token permissions do the Milestone 1 writes need? (closed)
**Decided 22 September 2026 by Rich:** `read:user write:repository write:organization`; these are the permissions a signed-in user has with DCS. The QA write probe (`scripts/probe/qa-write-probe.mjs`) records each operation succeeding with them. Recorded in #2, #12, architecture §8.

The question as it was put, kept for the record. This is about the OAuth `scope` parameter sent at sign-in (Gitea's token permissions), not the Scripture Burrito `currentScope` field, which is Q7.
In plain terms: the prototype signs in requesting `read:user read:repository read:organization`, which lets it list repositories but would be refused when it tries to create a repository, commit files, create a branch or tag, or create a release. Gitea's OAuth scopes include `write:repository` and `write:organization` (and `write:user`); which of these, at minimum, lets every Milestone 1 write operation succeed is not yet known, and asking for too much would violate least privilege (architecture §8).
Was blocking: #2, #12, #30. The proposal (`read:user write:repository write:organization`, from Gitea's scoped-token model, E13) is what Rich confirmed.

### Q11 — How does the portfolio show a writable repository with valid metadata whose type is neither Bible nor OBS? (closed)
**Decided 18 September 2026 by Rich:** a Translation Notes repository is a book package repository like a Bible repository: it has one file per book, `.tsv` instead of `.usfm`. It can be created and released through the same operations as a Bible project. The same holds for Translation Questions and Translation Words Links (CONTEXT.md "Book package repository").
Recorded in: CONTEXT.md (project type, book package repository, identifiers `project_type` and `content_structure`), domain model §3, operation catalog §5, #19, #21. Milestone 1 still exercises Bible only; the milestone that delivers creation and release for `tn`, `tq`, and `twl` is set at the Milestone 1 re-plan (roadmap). Subjects with no book or story structure (Translation Words, Translation Academy) remain `other`: listed, not releasable or editable in version one, with the reason stated.
Opens: Q18 (the Scripture Burrito flavor and book file pattern for each type).
Was blocking: #19, #21.

### Q12 — Aligned Bible archive size against Worker limits, and the Workers plan (measured)
A 66-book unaligned Bible is 1.5 MB zipped and 5.2 MB unpacked (E17). An aligned Bible is 10.8 MB zipped and 106 MB unpacked (E30); Door43 accepts it as one request (E31), the Worker cannot build one, and Q22 decides how the snapshot is assembled. Still open: whether the Cloudflare account is on the Workers Paid plan (Rich said it is a paid company account; confirm that Workers are on the paid tier, since the free plan's CPU limit would not cover inflating and hashing even a few aligned books).
Blocks: #34. Owner: Rich.
Close by: confirming the Workers plan in the Cloudflare dashboard.

### Q21 — How is a Door43 severity of `info` shown, and does it block release?
Observed 22 September 2026 (E28): a repository with no release reports `overall_severity_level: info` with a `release_needed` note. tC Admin's health states (domain model §5) map `success`, `warning`, and `error` but had no state for `info`; the prototype showed it as "Information". H1 forbids folding it into `healthy` silently.
Blocks: #25, #36. Owner: Rich (severity meaning), Birch (display).
Proposal (labeled): add health state `info`, shown as "Information" with the notes visible; it does not block release and needs no acknowledgement, since Door43 itself treats it as below `warning`.
Close by: Rich confirms `info` is advisory only; then `info` joins the identifiers in CONTEXT.md, domain model §5, and the operation catalog §5, with H2 unchanged.

### Q22 — How is a snapshot assembled when its bytes exceed one Worker request?
E30: an aligned Bible is 106 MB of files, about 135 MB as one base64 request. Door43 accepts that in one request (E31, Q13 closed), so the constraint is only the Worker: 128 MB of memory and a request it would have to build and hold. The design so far assumed one multi-file commit carrying every file (ADR 0010 "exactly one commit", W5). **Decided 22 September 2026 by Rich:** `.gitea/` and the other root files are carried into releases, so the repository's validation workflows travel with them.
Blocks: #34, and the aligned-Bible case of Milestone 1 (`bahtraku/Perjanjian-Baru-Pendau` and `id_tb1` are unaligned and small, E17). Owner: Rich.
Proposal (labeled), in three parts that together upload almost nothing:
1. **Carried-forward books need no upload.** The temporary branch starts from the previous release tag (ADR 0010), so every previously released book is already in the tree; the commit touches only selected books, refreshed administrative files, and `metadata.json`.
2. **A first release of a Resource Container repository is renames, not uploads.** The branch starts from the default branch, whose USFM files are byte-identical to the converted ingredients (E18), so the commit uses `operation: rename` with `from_path` to move `01-GEN.usfm` to `ingredients/GEN.usfm` for every book and `LICENSE.md` to `ingredients/LICENSE.md`, creates `metadata.json`, and deletes files the `/sb/` archive does not carry (`manifest.yaml`, `media.yaml`). Only `metadata.json` carries content.
3. **Selected books are uploaded one by one from the default-branch archive**, inflating each entry only when needed (5.4 MB raw, 7 MB base64 at most per book). When the selected set is too large for one Worker request, either the Worker streams the request body while inflating entries one at a time (Door43 accepts the size, E31), or the snapshot is written as several commits on the temporary branch, which amends ADR 0010's "exactly one commit" to "one release, prepared by one or more commits on the temporary branch", with the release targeting the final commit.
4. **A server-side DCS operation** that writes the converted snapshot of a ref onto a branch would move no bytes through the Worker at all; only Rich can judge whether that is realistic.
Close by: Rich choosing among parts 1 to 3, part 4, or an alternative; then ADR 0010 and W5 are amended and #34's design follows.

### Q13 — Multi-file commit limits (closed)
**Verified 22 September 2026 (E31):** one request with 79 files and about 135 MB of base64 (101 MB of files) was accepted and became one commit in 68 seconds. A Milestone 1 snapshot of an unaligned Bible (7 MB, E17) is far inside that. Any limit that exists is above the largest real Bible we have.

### Q14 — Is a manager-initiated discard of a preparation in scope? (closed)
**Decided 22 September 2026 by Rich:** yes. `preparation.discard` is a Milestone 1 operation, built by #58: after confirmation it deletes the temporary branch of an unreleased preparation and marks it `discarded`; a released preparation cannot be discarded. Recorded in the operation catalog §4, product spec §10, domain model §6, R7.

### Q15 — Safe upload byte limits (Milestone 2)
Blocks: #45. Owner: Rich. Close by: reading Worker request limits and Door43 contents limits; recording both.

### Q16 — Is `ingredients[]` populated for Scripture Burrito repositories? (closed)
**Verified 21 September 2026 (E14):** yes, with `exists`, `size`, `path`, `identifier`, `categories`, and `sort` for both the Scripture Burrito and the Resource Container seed repository.

### Q17 — What is the portfolio's analysis source? (closed)
**Decided 18 September 2026 by Rich:** the catalog metadata in the repository search response is enough to know about a repository, and its fields are the same for every project type (E12). `portfolio.list` and `project.read` read catalog metadata only; only `release.plan` downloads `/sb/` archives. The project report's `coverage.basis` is `catalog`; a release plan's candidate detection is `archive`.
Recorded in: E12, operation catalog §1 rule 8 and §4, architecture §3, #18, #19, #24.
Was blocking: #18, #19, #24.

### Q18 — What Scripture Burrito flavor and book file pattern do Translation Notes, Translation Questions, and Translation Words Links use?
Opened by the Q11 decision. Creating one of these projects needs the flavor and minimum `metadata.json` (as Q4 does for Bible); releasing one needs the file name pattern that identifies a book file in the `/sb/` archive (Bible uses `.usfm` per book; these use `.tsv`).
Blocks: creation and release for `tn`, `tq`, `twl` (scheduled at the Milestone 1 re-plan; Rich confirmed on 22 September 2026 that Milestone 1 stays Bible and OBS only). Owner: Rich.
Close by: downloading the `/sb/` archive of one repository of each type on QA, recording `metadata.json` and the file list as fixtures, and adding the flavor and pattern here as facts.

### Q19 — Version bump when the latest release is not Scripture Burrito, and bare-year baselines (closed)
**Decided 22 September 2026 by Rich:** when the latest full release's metadata format is not Scripture Burrito (`rc`, `ts`, `tc`, read from the release tag's catalog entry, E20), the first tC Admin release is a major bump, because the format change is breaking for consumers. A bare-year tag such as `1974` has no semantic baseline: the release is `v1.0.0` and the project uses semantic versions from then on. For id_tb1 both apply and the result is `v1.0.0`; the `1974` archive is still the content baseline for carried-forward books. Recorded in product spec §10, domain model §7, R9, #37.

### Q20 — Where do the wizard's language list and license choices come from? (languages closed)
**Languages, decided 22 September 2026 by Rich:** any language may be chosen. The full list is `GET /api/v1/languages/langnames.json` (E25: 9,165 entries), so the wizard offers it with search rather than a plain dropdown. For narrowing to languages an owner already has repositories in, `GET /api/v1/catalog/list/languages?owner=<owner>&stage=latest`, optionally `&flavor=textTranslation` for Bibles or `&flavor=textStories` for Open Bible Stories; the same endpoint can feed the portfolio's language filter.
**Licenses, still open.** Owner: Birch.
Proposal (labeled): CC BY-SA 4.0 (default), CC BY 4.0, CC0 1.0, and public domain, each writing its text to `ingredients/license.md` and a `copyright.licenses` entry that names the ingredient.
Blocks: #28, #29 (license part only).
Close by: Birch confirms the license list.

### E23 — The QA organization and test user, and where they live
`tc-admin-qa-org` exists on production (id 53536, public) and, since later on 22 September 2026, on QA as well (id 53535, public, no repositories yet), with `tc-admin-qa` as owner. The user `tc-admin-qa` exists on production (id 53535) and on QA (id 53533). Its password and a QA API token are held in Rich's local `.env` as `TEST_ORG`, `TEST_USER`, `TEST_PASSWORD`, and `TEST_TOKEN`; they are not present in the agent environment and are never committed. The token's scopes include `write:organization`, `write:repository`, and `read:user`, and cover all repositories.
Hosts: both. Date: 22 September 2026. Method: public organization and user endpoints. Status: verified. Consequence: QA probes create repositories in `tc-admin-qa-org` (set `TEST_ORG`); production holds seed files only, never releases (#1). A token is valid on the host that issued it only. First probe run: `POST /user/repos` returned 403 for this user on QA while `TEST_ORG` was unset, so the user's own namespace is not usable for creation there.

### E25 — Door43 language lists
`GET /api/v1/languages/langnames.json` (public, 1.5 MB) returns 9,165 entries with `lc` (tag), `ln` (native name), `ang` (English name), `ld` (direction), `gw` (gateway language), `hc` (home country), `cc` (countries), `lr` (region), `alt` (alternate names), `pk`. `GET /api/v1/catalog/list/languages?owner=<owner>&stage=latest[&flavor=textTranslation|textStories]` returns the same shape for languages the owner has repositories in (unfoldingword: 5, of which 4 textTranslation; bahtraku: 7, including `ums` Pendau).
Host: qa.door43.org. Date: 22 September 2026. Method: public probes; endpoints named by Rich. Status: verified. Consequence: the wizard's language field searches the full list (Q20); the portfolio language filter uses the owner-scoped list.

### E26 — Creating a repository under a user needs `write:user`
`POST /user/repos` on QA with a token holding `write:repository` and `write:organization` but not `write:user` returns 403 with `token does not have at least one of required scope(s), required=[write:user]`. Gitea gates every `/user/…` route by the `user` scope category regardless of what the operation changes; `POST /orgs/{org}/repos` is gated by `write:organization` instead.
Host: qa.door43.org. Date: 22 September 2026. Method: Rich's probe run, message quoted from the response. Status: verified. Consequence: the probe defaults to `tc-admin-qa-org`; tC Admin creates projects in organizations only, so Q10's three scopes stand.

### E27 — Every Milestone 1 write works with the QA token, including a release targeting a commit SHA
Rich's probe run on 22 September 2026 (repository `tc-admin-qa-org/tca-probe-20260922194921`, kept for inspection): `POST /orgs/{org}/repos` 201; first multi-file commit to an empty repository 201; `POST /releases` with `target_commitish` set to the commit SHA 201, and the release records that SHA; `POST /branches` with `old_ref_name` = a tag 201; `POST /contents` on that branch using `operation: upload` for the existing `metadata.json` without a blob `sha` 201; pre-release 201; `PATCH /releases/{id}` to promote 200; `GET /releases/tags/{tag}` 200; `DELETE /branches/{branch}` 204. After promotion `catalog.prod` moved to `v1.1.0`.
Host: qa.door43.org. Date: 22 September 2026. Method: `scripts/probe/qa-write-probe.mjs` (recordings in Rich's clone under `fixtures/door43/qa.door43.org/2026-09-22/probe-write/`, to be committed). Status: verified. Closes Q3 except the size question (Q13). Consequence: `release.prepare` needs no blob SHAs (use `upload`), and `release.create` targets the snapshot commit SHA directly.

### E28 — Health check latency, coverage of API-created refs, and md5 verification
After the first commit to a new repository, the poll at 0.2 s answered 422 "no metadata found for repo […] and ref [master]" (the E15 intermediate response) and the poll at 5.6 s answered 200 with severity `info` and one `release_needed` note, the only issue on a repository that has no release yet. The result for a new tag, for a branch created through the API and committed to through the API, and for a second tag was available on the first poll, about 0.1 seconds after creation. On tag `v1.1.0`, whose `metadata.json` carries a deliberately wrong md5 for `EXO.usfm` with a correct size, the check reports `sb_ingredient_mismatch`: "has an MD5 checksum in metadata.json that does not match the file", severity `warning`; the tag's catalog entry is still `is_valid: true` with `healthcheck_severity: warning`. The branch `temp-tca-release/v1.1.0`, on the same commit, reported `success` with no issues 110 ms after the commit: either md5 is not verified on branches (product spec §7 says checksums are verified on tags) or that result still described the branch's previous commit. After releases existed, `master` and `v1.0.0` (correct checksums) report `success`.
Host: qa.door43.org. Date: 22 September 2026. Method: probe run (steps 05, 07, 10, 12), recordings in `fixtures/door43/qa.door43.org/2026-09-22/probe-write/`, and public re-reads. Status: verified. Closes Q1 for tags and Q2. Consequence: the poll maps the 422 to `checking` as designed; the `info` severity needs a health state (Q21); the probe now re-polls a branch after a pause to settle the branch md5 question (Q1, branch part).

### E29 — A release and its archive survive deletion of the temporary branch
After `DELETE /branches/temp-tca-release/v1.1.0`, `GET /releases/tags/v1.1.0` returned 200 and `GET /{owner}/{repo}/sb/v1.1.0.zip` returned 200 with `metadata.json`, `README.md`, and all three ingredients.
Host: qa.door43.org. Date: 22 September 2026. Method: probe steps 15 to 17 and a public re-read. Status: verified. Closes Q5.

### E30 — An aligned Bible archive is 106 MB unpacked
`unfoldingWord/en_ult` (Resource Container, Aligned Bible, 66 books, `catalog.prod` `v90`) converts to a `/sb/master.zip` of 10.8 MB that downloads in 3.6 s and unpacks to 105,975,744 bytes across 79 files: `metadata.json`, `README.md`, `.gitignore`, the repository's `.gitea/workflows/` files, and 68 ingredients, the largest books 5.4 MB (`JER`), 5.1 MB (`GEN`, `PSA`). As base64 in one multi-file commit that is about 141 MB of request body.
Host: qa.door43.org. Date: 22 September 2026. Method: public download and inspection. Status: verified. Closes the measurement part of Q12 and opens Q22: a Cloudflare Worker (128 MB memory) cannot hold that request, so a snapshot of an aligned Bible cannot be one in-memory multi-file commit whatever Door43 accepts. Also: the archive carries every root file of the repository, including CI workflow files, so "every root file" in the snapshot rules needs a decision about `.gitea/` (folded into Q22).

### E31 — Door43 accepts a whole aligned Bible as one multi-file commit
Rich's `--bulk` run on 22 September 2026 pushed `unfoldingWord/en_ult`'s converted archive into `tc-admin-qa-org/tca-bulk-en_ult-20260922210827` as a single `POST /repos/{owner}/{repo}/contents`: 79 files, 105,975,744 bytes raw, about 135 MB of base64 in one request body, accepted with 201 in 68 seconds and recorded as exactly one commit of 79 blobs. The archive download took 10.8 s that time (3.6 s on 21 September). The health result for `master` and for the release tag was available on the first poll; both report `warning` for `title_has_uw` and `language_is_en`, which is expected for an English unfoldingWord resource copied under another owner. The release `v1.0.0` targets the commit SHA; the new repository's `/sb/v1.0.0.zip` is 10.05 MB and downloads in 2.5 s. The repository is Scripture Burrito with 66 ingredients in the catalog.
Host: qa.door43.org. Date: 22 September 2026. Method: probe run (steps 03 to 09) and public re-reads. Status: verified. Closes Q13: neither `[repository.upload]` `MAX_FILES` nor a proxy body limit applies to this endpoint at this size. Consequence: the constraint on snapshot assembly is the Worker's memory and request handling (Q22), not Door43.

### E24 — Scripture Burrito relationship schema
A `relationships[]` entry has `relationType` (`source`, `target`, `expression`, `parascriptural`, `peripheral`), `flavor` (for `source`: `textTranslation` or `audioTranslation`), `id` (a prefixed id such as `dcs::unfoldingWord/en_ult`, whose prefix names an entry in `idAuthorities`), `revision` (a revision string such as `v90`), and an optional `variant`. translationCore 4 records a translation's source this way, with `idAuthorities.dcs = { id: "https://git.door43.org/", name: { en: "Door43 Content Service" } }`.
Source: https://docs.burrito.bible/en/v1.0.0/schema_docs/relationship.html, read 22 September 2026; the translationCore 4 shape from Rich, 22 September 2026. Status: verified against the published schema. Consequence: the wizard's source translation writes `idAuthorities.dcs` and one `source` relationship whose `flavor` equals the project's (#29). `go-rc2sb` writes the `dcs` authority id without the trailing slash (E17); #29 settles which spelling tC Admin uses.
