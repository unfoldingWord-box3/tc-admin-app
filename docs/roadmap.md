# tC Admin Roadmap

Status: Accepted, 17 September 2026. Amended 18 September 2026 for the operation catalog and fixture decisions (ADR 0011, ADR 0012). Re-planned 1 October 2026 (proposed) by Rich and Birch: Scripture Burrito projects only, import from any repository, uploads and Open Bible Stories in Milestone 1 (ADR 0013); accepted when that pull request merges.
Audience: the engineering team building tC Admin, and the agents assisting it
Tracking: [GitHub milestones](https://github.com/unfoldingWord-box3/tc-admin-app/milestones) and `EPIC:` issues in `unfoldingWord-box3/tc-admin-app`; [traceability.md](traceability.md) links every issue to the specification, decisions, invariants, evidence, and operations it depends on; [AGENTS.md](../AGENTS.md) says how to work an issue

## How this roadmap works

A **milestone** is a slice a real manager can use end to end. A milestone is done when the named acceptance owner has used it on the target Door43 host, not when its issues are closed.

An **epic** is one GitHub issue titled `EPIC: …` with the `epic` label and a task list of child issues. Epics are the build phases inside a milestone.

Only Milestone 1 carries a date. Milestones 2 and 3 carry a target month and are re-planned after the Milestone 1 demo.

Capacity assumption: one primary engineer working part time with agent assistance, with product and design support from Birch. If capacity changes, dates move. Milestone 1 scope was re-set on 1 October 2026 and does not grow further; the date did not move with that re-plan, which is a risk Rich accepted. **Amended 8 October 2026 by Rich:** [#125](https://github.com/unfoldingWord-box3/tc-admin-app/issues/125), reopening a release preparation after its page is closed or reloaded, joins Milestone 1, since a stranded preparation would strand the demo's release; Milestone 1's due date and the demo both move to Wednesday 21 October, which leaves room for it. The same day Rich added [#124](https://github.com/unfoldingWord-box3/tc-admin-app/issues/124), showing Door43's health findings so that a blocked release is obvious, at his request as a reviewer of the running app: on QA a blocked Open Bible Stories release listed its errors as plain body text with Door43's Markdown shown raw. Later that day he added [#146](https://github.com/unfoldingWord/tc-admin-app/issues/146), the same findings in the project view, for its default branch and its latest full release, without preparing a release: the view said "Failing · 4 findings · on master" and gave no way to read them. Every check passed or not, and tools to fix what a check finds, stay later (Q35). Once #146 was on QA, he added [#149](https://github.com/unfoldingWord/tc-admin-app/issues/149): a project with many findings made the view so long that its actions were hard to reach, so the health check is closed when the view opens, colored by Door43's worst verdict, and its findings are grouped by check, one closed row each, as Door43's own health check page shows them. He chose the layout from three run locally against QA on 9 October 2026. The same day he added [#154](https://github.com/unfoldingWord/tc-admin-app/issues/154): an audit of the app's look against the translationCore 4 design system, whose tokens and font #8 had named but never copied; each page now has its own title, at the design system's 32px scale, which he chose over a quieter one, and the design system's font, controls, and colors. And he added [#151](https://github.com/unfoldingWord/tc-admin-app/issues/151) on the import screen: the repository list showed repositories of the other project type with a sentence saying each cannot be imported, and it was not clear what could be clicked; it now lists only importable repositories, one radio row each with a filter, and the app is 960px wide instead of 720px, so the book checklist no longer wraps.

The agent assistance is a design input, not a footnote. The build is organized so that an agent can orient from one file ([AGENTS.md](../AGENTS.md)), check any change against a numbered list of what must never break ([invariants.md](invariants.md)), implement against a catalog of named operations with typed errors ([operations.md](operations.md)), test against recorded Door43 fixtures without credentials (ADR 0012), and never re-probe a fact already recorded ([evidence.md](evidence.md)). Each of these costs a document now and saves a cycle every week until the demo.

## Version one outcome

A manager signs in with Door43, sees the health and coverage of every project they can write to, creates a valid Scripture Burrito project without hand-writing metadata, and releases exactly the books they choose without publishing unfinished work.

`sign in → discover → create → add books (upload or import) → health check → select and prepare release → pre-release / full release → promote`

## Decisions this roadmap depends on

Recorded in [CONTEXT.md](../CONTEXT.md) and the [ADRs](adr). The ones that shape the build order:

- Scripture Burrito is the internal model, the only format tC Admin creates, and the format of every release ([ADR 0008](adr/0008-scripture-burrito-is-the-internal-model.md)).
- Only Scripture Burrito Bible and Open Bible Stories repositories are projects: the ones translationCore 4 edits. Any repository in the catalog, in any format, can be imported from through Door43's Scripture Burrito archive; none is released or converted in place. A manager may leave a previously released book out of a release ([ADR 0013](adr/0013-scripture-burrito-projects-only-import-and-explicit-removal.md), 1 October 2026; supersedes ADR 0009).
- Each release is one or more commits on top of the previous release tag, on a lineage separate from the default branch ([ADR 0010](adr/0010-release-lineage-from-the-previous-release-tag.md)). Releases add, update, and, when the manager says so, remove books.
- Former hard dependency, satisfied: the DCS change so `/sb/{ref}.zip` serves a rollup when the ref is already Scripture Burrito shipped and was verified on production and QA on 18 September 2026 for all four formats (evidence E1 to E4); the API route is `GET /api/v1/repos/{owner}/{repo}/sb/{ref}.zip` (E34). tC Admin reads repository content through that archive and nothing else.
- Everything the system can do is a named operation with plan, apply, and receipt; the UI and any later agent client are projections of one catalog ([ADR 0011](adr/0011-one-operation-catalog-with-plan-apply-and-receipt.md)). The shared schema comes before the first route.
- Tests run against recorded Door43 fixtures; live probes write evidence records ([ADR 0012](adr/0012-recorded-door43-fixtures-and-evidence-records.md)).
- Open questions that shape Milestone 1 code are numbered in [evidence.md](evidence.md) with owners. No decision blocks release code any more (Q8, Q10, Q14, Q19 decided 22 September 2026). The write probe ran on 22 September 2026 and closed Q1, Q2, Q3, and Q5 (E27 to E29). Q13 closed the same day: Door43 accepts a whole aligned Bible as one commit (E31). Q22 (snapshot assembly), Q21 (`info` health state), Q12 (Workers paid tier), Q20 (CC BY-SA 4.0 only in Milestone 1), and Q23 (which Door43 subjects name each project type) were decided on 30 September 2026, and Q11 was re-recorded the same day: tC Admin manages the two Scripture Burrito flavors translationCore 4 edits, Bible and Open Bible Stories, and every other type is unsupported, as Birch's original glossary said. Decided 1 October 2026 by Rich and Birch and recorded as Q24 and Q25: the three-state release selection with its defaults and explicit removal; Milestone 1 includes upload, import, and Open Bible Stories; the repository name is derived from language and abbreviation; import offers unreleased sources. No question blocks Milestone 1 code. Decided 18 September 2026: a `warning` health result does not block release but requires the manager's confirmation (Q6); a release's `currentScope` lists the released books (Q7); the portfolio reads catalog metadata, never archives (Q17).
- Door43 runs health checks on every pushed branch. tC Admin polls for the result on the temporary release branch rather than triggering anything.
- Coverage counts against testament scope: 27, 39, or 66 books; 50 stories.
- The version is the Door43 release tag. Loose tags such as `v105` are coerced to semver and bumped. A bare year or no release defaults to `v1.0.0`. The manager can edit before release.

## Milestone 1 — Release

**Due:** Wednesday 21 October 2026 (moved from Friday 16 October by Rich on 8 October 2026; the 1 October re-plan had left it unchanged); the demo is on the same day, Wednesday 21 October 2026 (Rich, 8 October 2026)
**Demo:** live on production Door43 against `bahtraku/Perjanjian-Baru-Pendau` (Scripture Burrito, baseline `v1.2`), in front of Birch and the Bahtraku team; import from `bahtraku/id_tb1` (Resource Container) into a new project is rehearsed on QA (re-planned 1 October 2026; the earlier plan released id_tb1 directly)
**Development host:** QA Door43
**Acceptance owner:** Birch, using the `birch` account
**Scope:** Scripture Burrito Bible and Open Bible Stories projects: create, add books or stories by upload or by import from any Door43 repository, release with the three-state selection, pre-release and promotion. Re-planned 1 October 2026 by Rich and Birch: uploads, import, and Open Bible Stories moved in from Milestone 2 because the product is "set up a project, put its books in it, release it", and a project without a way to add books is not usable end to end.

### What a manager can do at the end

1. Sign in with Door43 and see every writable repository grouped by owner, their organizations first, with coverage and health.
2. Create a new Bible or Open Bible Stories project from a title, an abbreviation, and a language, with valid Scripture Burrito metadata and no editor required.
3. Add books or stories by uploading USFM or markdown files, or by importing them from any repository in the Door43 catalog, in any format.
4. Set each book to include, carry forward, or leave out, watch tC Admin assemble a snapshot, wait for Door43's health result, review generated release notes and the calculated version, create a pre-release, and promote it later.

### What is deliberately not in Milestone 1

The metadata editor, Setup-incomplete recovery beyond a retry link, accessibility audit, custom domain.

### Epics

**EPIC: Environments and Door43 setup** ([#6](https://github.com/unfoldingWord-box3/tc-admin-app/issues/6)) (week one)
- The `tc-admin-qa-org` organization and the `tc-admin-qa` user exist on production so they survive QA resets (22 September 2026, E23); the user also exists on QA. Seed repositories may hold files there but never releases.
- Register one confidential OAuth application per host at site-admin or unfoldingWord org level, with production, QA, and local redirect URIs.
- Write a seed script that copies one RC Bible (`bahtraku/id_tb1`) and one SB Bible (`bahtraku/Perjanjian-Baru-Pendau`) into `tc-admin-qa` on QA after each reset.
- Confirm the OAuth secret copied to QA by a reset still works, or document the manual step.
- Measure health-check latency on QA after a branch push and record the number.

**EPIC: Application foundation** ([#11](https://github.com/unfoldingWord-box3/tc-admin-app/issues/11))
- Replace `prototypes/tc-admin` with `web/` (Vite, React, TypeScript), `worker/` (Cloudflare Worker, small router, Workers KV sessions, Wrangler), and `shared/schema/` (the operation catalog as types, the only source of API types), laid out per the module map in [architecture.md](architecture.md) §10.
- Copy the translationCore 4 design system tokens and components into `web/`. The tokens and font this app uses, its control heights and states, and a title for each page, followed on 9 October 2026 ([#154](https://github.com/unfoldingWord/tc-admin-app/issues/154)); its components are not copied, since the app's screens are its own.
- Deploy to a `workers.dev` URL with QA and production environment configuration.
- Vitest for units and for contract tests of operations against `fixtures/door43/`; the first recordings are the seed repositories in all four formats (ADR 0012). One Playwright smoke test that signs in on QA and loads the portfolio.

**EPIC: Sign-in and session** ([#16](https://github.com/unfoldingWord-box3/tc-admin-app/issues/16))
- Authorization-code exchange in the Worker, HttpOnly SameSite session cookie, CSRF protection on mutations.
- Live permission re-check before every mutation. Fail closed.
- Expired-session handling that preserves unsaved form state where safe.

**EPIC: Project model** ([#22](https://github.com/unfoldingWord-box3/tc-admin-app/issues/22))
- Scripture Burrito reader: metadata, ingredients, scope, administrative files.
- Door43 Scripture Burrito archive client: download and unpack `/sb/{ref}.zip` for any ref.
- Project type and metadata format detection, coverage by testament scope, unknown-file detection.
- Unsupported projects (other formats, no metadata, other types) surfaced with a reason; a Bible or Open Bible Stories repository in another format offered for import.

**EPIC: Portfolio and health** ([#27](https://github.com/unfoldingWord-box3/tc-admin-app/issues/27))
- Writable-repository discovery with pagination and de-duplication (carry over from the prototype).
- Organization grouping, filters, configurable sorting, asynchronous per-project analysis.
- Health states from Door43's `healthcheck_severity`, with never-checked, running, unavailable, and error states distinct from healthy.
- Refresh behavior.
- Health findings that read at a glance: a summary when the release is blocked or a warning needs confirmation, each finding with a severity badge (icon and word), its details and Door43's suggestion, errors first, and Door43's bold, code, and links rendered ([#124](https://github.com/unfoldingWord-box3/tc-admin-app/issues/124), added 8 October 2026).
- The same findings in the project view, for the default branch and the latest full release, without a release ([#146](https://github.com/unfoldingWord/tc-admin-app/issues/146), added 8 October 2026).
- The project's health check closed until opened, colored by Door43's worst verdict, its findings grouped by check, one closed row each ([#149](https://github.com/unfoldingWord/tc-admin-app/issues/149), added 8 October 2026).

**EPIC: Create a project** ([#32](https://github.com/unfoldingWord-box3/tc-admin-app/issues/32))
- Wizard: owner (organization or own account), project type, title, abbreviation, target language, testament scope for Bible; the repository name derived as `<language>_<abbreviation>` and checked for uniqueness.
- Generated `metadata.json` with tC Admin as generator, `scripture/textTranslation` or `gloss/textStories` flavor, license ingredient (E37).
- Setup-incomplete state with a retry link when repository creation succeeds but the first commit fails.
- Last step: add books by upload or import.

**EPIC: Add books: upload and import** ([#45](https://github.com/unfoldingWord-box3/tc-admin-app/issues/45), [#47](https://github.com/unfoldingWord-box3/tc-admin-app/issues/47) re-scoped from conversion)
- Uploads: files, folders, drag and drop; path safety; each file identified as a book from its `\id` header and name, or as a story from its name, confirmed by the manager; overwrite warnings with text diffs; one-commit batches; ingredient entries with size and md5.
- Import: owner search with the account's organizations first; the owner's Bible and Open Bible Stories repositories in any format, released or not; latest content or last release; pick all or some books; files from the Scripture Burrito archive's `ingredients/`; the source recorded as a relationship. Only repositories of the project's type are listed, one radio row each, with a filter ([#151](https://github.com/unfoldingWord/tc-admin-app/issues/151), added 9 October 2026).

**EPIC: Open Bible Stories** ([#48](https://github.com/unfoldingWord-box3/tc-admin-app/issues/48))
- Story detection from `ingredients/content/<NN>.md`, 50-story coverage, creation with the `gloss/textStories` flavor, upload and import of stories, release of the whole default branch.

**EPIC: Selective release** ([#41](https://github.com/unfoldingWord-box3/tc-admin-app/issues/41))
- Built as the operations `release.plan`, `release.prepare`, `preparation.read`, `release.create`, `release.lookup`, `release.promote`, and `preparation.discard` ([#58](https://github.com/unfoldingWord-box3/tc-admin-app/issues/58)); the preparation is an addressable resource that survives a lost session.
- Candidate detection: new, changed released, unchanged, unknown; every book listed with a three-state selection, defaulting to all included on a first release and to released books carried forward and new books left out afterwards.
- Snapshot on `temp-tca-release/<version>` started from the previous release tag: included books uploaded from the default-branch archive, left-out books deleted and listed as removals, bound to the default-branch SHA. Open Bible Stories: the whole default branch.
- Metadata merge: exactly the included and carried-forward books, refreshed administrative entries, size and md5 for every file, scope set to released books. A release needs at least one book; a removal forces a major version.
- Health poll: every 5 seconds for 3 minutes, then hand off to a refresh button.
- Version calculation and edit, required release notes, pre-release option, create, promote.
- Stale-source protection, lost-response lookup by tag, retained branch on failure, branch deletion after success.
- A preparation outlives its page: after a reload, a closed tab, or a new sign-in the manager finds it again, to continue or discard it ([#125](https://github.com/unfoldingWord-box3/tc-admin-app/issues/125), added 8 October 2026).
- The project page opens its latest full release on the release's own page ([#156](https://github.com/unfoldingWord/tc-admin-app/issues/156), added 9 October 2026 by Rich, since a release made elsewhere had no link from the project page). Downloads on that page, and a list of every release Door43 has, are later.
- Polish from the walkthrough of the demo script on QA ([#161](https://github.com/unfoldingWord/tc-admin-app/issues/161), added 9 October 2026 by Rich): the stepper's version label and refusal, the creation wizard's headings, an import's overwrite naming its source, a commit named by its hash, release notes headed by the version alone, and the stepper's findings grouped by check.

**EPIC: Demo readiness** ([#44](https://github.com/unfoldingWord-box3/tc-admin-app/issues/44))
- Written demo script against a Bahtraku repository on production.
- Full rehearsal on QA, then on production with a pre-release that is promoted during the demo.

## Milestone 2 — Manage

**Target:** November 2026
**Acceptance owner:** Birch

### Epics

- **EPIC: Metadata editing** ([#46](https://github.com/unfoldingWord-box3/tc-admin-app/issues/46)) — structured form over the Scripture Burrito model; validation on blur and save; diff review; direct commit; health rerun.
- **EPIC: Setup-incomplete recovery** ([#49](https://github.com/unfoldingWord-box3/tc-admin-app/issues/49)) — resume creation from any failed step without deleting the repository.

Uploads (#45), import (#47), and Open Bible Stories (#48) moved to Milestone 1 on 1 October 2026.

## Milestone 3 — Pilot

**Target:** December 2026
**Acceptance owner:** `jeane_manuhutu` at Yayasan BahtraKu, with `birch` as second tester
**Host:** production Door43 on an unfoldingWord domain

### Epics

- **EPIC: Accessibility** ([#50](https://github.com/unfoldingWord-box3/tc-admin-app/issues/50)) — WCAG 2.2 AA pass; no color-only health signals.
- **EPIC: Security review** ([#51](https://github.com/unfoldingWord-box3/tc-admin-app/issues/51)) — OAuth, sessions, CSRF, upload paths, diagnostics redaction.
- **EPIC: Performance** ([#52](https://github.com/unfoldingWord-box3/tc-admin-app/issues/52)) — portfolios above 100 repositories load progressively; failure-mode and retry testing; archive sizes against Worker memory limits.
- **EPIC: Operations** ([#53](https://github.com/unfoldingWord-box3/tc-admin-app/issues/53)) — custom domain, production secrets, runbook, monitoring of Door43 availability.
- **EPIC: Bahtraku pilot** ([#54](https://github.com/unfoldingWord-box3/tc-admin-app/issues/54)) — named testers, a real release per week for four weeks, issues triaged with the pilot owner.

## Deferred

- Other project types, such as Translation Notes, Translation Questions, Translation Words Links, Translation Words, and Translation Academy: out of scope, not deferred. tC Admin manages the two Scripture Burrito flavors translationCore 4 edits; every other type is listed as unsupported (Q11).
- Releasing or converting a Resource Container, translationStudio, or translationCore repository in place: out of scope. Door43 and Gateway Admin release those; tC Admin imports from them (ADR 0013).
- A tC Admin MCP server exposing Worker operations to Claude clients. After ADR 0011 this is a projection of the operation catalog, one tool per operation with the same schemas, errors, and plan-before-apply rule, so it is a small epic rather than a redesign; it stays deferred because no partner has asked for it yet.
- Bible Passage Sets.
- Deeper file-content validation beyond Door43's health check.
- Translation editing and suggestions.
- Assignment and issue management.
- Coordinated multi-repository releases (today handled by `release_uw_resources`).
- Pull requests and merge resolution for translation content.
- Rich progress metrics and user-configurable progress definitions.
- Interface localization (architecture allows it; English first).

## Working this roadmap

An issue is done when its acceptance criteria hold on QA, its tests are green and named with the invariants they prove, the documents it touches are updated, and its evidence is recorded; not when code is pushed. Every issue carries a Traceability section that matches its row in [traceability.md](traceability.md). Nobody decides an open question by building an answer; the owner named in [evidence.md](evidence.md) decides, and the build proceeds behind the current text with the assumption stated.

## Related experiments

- `prototypes/door43-mcp` is a read-only Door43 MCP proof of concept. It is not a tC Admin deliverable.
