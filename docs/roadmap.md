# tC Admin Roadmap

Status: Accepted, 17 September 2026. Amended 18 September 2026 (proposed) for the operation catalog and fixture decisions (ADR 0011, ADR 0012) and the satisfied Door43 dependency; accepted when that pull request merges.
Audience: the engineering team building tC Admin, and the agents assisting it
Tracking: [GitHub milestones](https://github.com/unfoldingWord-box3/tc-admin-app/milestones) and `EPIC:` issues in `unfoldingWord-box3/tc-admin-app`; [traceability.md](traceability.md) links every issue to the specification, decisions, invariants, evidence, and operations it depends on; [AGENTS.md](../AGENTS.md) says how to work an issue

## How this roadmap works

A **milestone** is a slice a real manager can use end to end. A milestone is done when the named acceptance owner has used it on the target Door43 host, not when its issues are closed.

An **epic** is one GitHub issue titled `EPIC: …` with the `epic` label and a task list of child issues. Epics are the build phases inside a milestone.

Only Milestone 1 carries a date. Milestones 2 and 3 carry a target month and are re-planned after the Milestone 1 demo.

Capacity assumption: one primary engineer working part time with agent assistance, with product and design support from Birch. If capacity changes, dates move; scope inside Milestone 1 does not grow.

The agent assistance is a design input, not a footnote. The build is organized so that an agent can orient from one file ([AGENTS.md](../AGENTS.md)), check any change against a numbered list of what must never break ([invariants.md](invariants.md)), implement against a catalog of named operations with typed errors ([operations.md](operations.md)), test against recorded Door43 fixtures without credentials (ADR 0012), and never re-probe a fact already recorded ([evidence.md](evidence.md)). Each of these costs a document now and saves a cycle every week until the demo.

## Version one outcome

A manager signs in with Door43, sees the health and coverage of every project they can write to, creates a valid Scripture Burrito project without hand-writing metadata, and releases exactly the books they choose without publishing unfinished work.

`sign in → discover → create → health check → prepare release → pre-release / full release → promote`

## Decisions this roadmap depends on

Recorded in [CONTEXT.md](../CONTEXT.md) and the [ADRs](adr). The ones that shape the build order:

- Scripture Burrito is the internal model, the only format tC Admin creates, and the format of every release. Door43's Scripture Burrito archive supplies repository content for release, converting Resource Container, translationStudio, and translationCore refs on the way ([ADR 0008](adr/0008-scripture-burrito-is-the-internal-model.md)).
- Any valid repository can be released; only Scripture Burrito repositories can be edited. Others are release-only until converted ([ADR 0009](adr/0009-release-any-valid-repository-edit-only-scripture-burrito.md)).
- Each release is one commit on top of the previous release tag, on a lineage separate from the default branch ([ADR 0010](adr/0010-release-lineage-from-the-previous-release-tag.md)). Releases add and update books, never remove them.
- Former hard dependency, satisfied: the DCS change so `/sb/{ref}.zip` serves a rollup when the ref is already Scripture Burrito shipped and was verified on production and QA on 18 September 2026 for all four formats (evidence E1 to E4). tC Admin uses `/sb/{ref}.zip` for every ref and nothing else.
- Everything the system can do is a named operation with plan, apply, and receipt; the UI and any later agent client are projections of one catalog ([ADR 0011](adr/0011-one-operation-catalog-with-plan-apply-and-receipt.md)). The shared schema comes before the first route.
- Tests run against recorded Door43 fixtures; live probes write evidence records ([ADR 0012](adr/0012-recorded-door43-fixtures-and-evidence-records.md)).
- Open questions that shape Milestone 1 code are numbered in [evidence.md](evidence.md) with owners. No decision blocks release code any more (Q8, Q10, Q14, Q19 decided 22 September 2026). The write probe ran on 22 September 2026 and closed Q1, Q2, Q3, and Q5 (E27 to E29). Q13 closed the same day: Door43 accepts a whole aligned Bible as one commit (E31). What remains is the snapshot assembly design inside the Worker's memory (Q22), the health `info` state (Q21), and the wizard's license choices (Q20). Decided 18 September 2026: a `warning` health result does not block release but requires the manager's confirmation (Q6); a release's `currentScope` lists the released books (Q7); Translation Notes, Translation Questions, and Translation Words Links are book package types with the same creation and release flow as Bible (Q11); the portfolio reads catalog metadata, never archives (Q17).
- Door43 runs health checks on every pushed branch. tC Admin polls for the result on the temporary release branch rather than triggering anything.
- Coverage counts against testament scope: 27, 39, or 66 books; 50 stories.
- The version is the Door43 release tag. Loose tags such as `v105` are coerced to semver and bumped. A bare year or no release defaults to `v1.0.0`. The manager can edit before release.

## Milestone 1 — Release

**Due:** Friday 16 October 2026
**Demo:** live on production Door43 against `bahtraku/Perjanjian-Baru-Pendau` (Scripture Burrito, baseline `v1.2`), in front of Birch and the Bahtraku team; the Resource Container path is rehearsed on QA with `bahtraku/id_tb1` (decided 22 September 2026)
**Development host:** QA Door43
**Acceptance owner:** Birch, using the `birch` account
**Scope:** Bible projects only. Release any of the four metadata formats. Create Scripture Burrito only.

### What a manager can do at the end

1. Sign in with Door43 and see every writable repository grouped by organization, with coverage and health.
2. Create a new Bible project with valid Scripture Burrito metadata, no editor required.
3. Pick one or more books from an existing project, watch tC Admin assemble a snapshot, wait for Door43's health result, review generated release notes and the calculated version, create a pre-release, and promote it later.

### What is deliberately not in Milestone 1

Uploads, the metadata editor, Open Bible Stories, RC-to-SB conversion, Setup-incomplete recovery beyond a retry link, accessibility audit, custom domain.

### Epics

**EPIC: Environments and Door43 setup** ([#6](https://github.com/unfoldingWord-box3/tc-admin-app/issues/6)) (week one)
- The `tc-admin-qa-org` organization and the `tc-admin-qa` user exist on production so they survive QA resets (22 September 2026, E23); the user also exists on QA. Seed repositories may hold files there but never releases.
- Register one confidential OAuth application per host at site-admin or unfoldingWord org level, with production, QA, and local redirect URIs.
- Write a seed script that copies one RC Bible (`bahtraku/id_tb1`) and one SB Bible (`bahtraku/Perjanjian-Baru-Pendau`) into `tc-admin-qa` on QA after each reset.
- Confirm the OAuth secret copied to QA by a reset still works, or document the manual step.
- Measure health-check latency on QA after a branch push and record the number.

**EPIC: Application foundation** ([#11](https://github.com/unfoldingWord-box3/tc-admin-app/issues/11))
- Replace `prototypes/tc-admin` with `web/` (Vite, React, TypeScript), `worker/` (Cloudflare Worker, small router, Workers KV sessions, Wrangler), and `shared/schema/` (the operation catalog as types, the only source of API types), laid out per the module map in [architecture.md](architecture.md) §10.
- Copy the translationCore 4 design system tokens and components into `web/`.
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
- Release-only (rc, ts, tc) and unsupported (no metadata) projects surfaced with a reason.

**EPIC: Portfolio and health** ([#27](https://github.com/unfoldingWord-box3/tc-admin-app/issues/27))
- Writable-repository discovery with pagination and de-duplication (carry over from the prototype).
- Organization grouping, filters, configurable sorting, asynchronous per-project analysis.
- Health states from Door43's `healthcheck_severity`, with never-checked, running, unavailable, and error states distinct from healthy.
- Refresh behavior.

**EPIC: Create a Bible project** ([#32](https://github.com/unfoldingWord-box3/tc-admin-app/issues/32))
- Wizard: organization, project type, repository name, target language, title, testament scope.
- Generated `metadata.json` with tC Admin as generator, `scripture/textTranslation` flavor, license ingredient.
- Setup-incomplete state with a retry link when repository creation succeeds but the first commit fails.

**EPIC: Selective release** ([#41](https://github.com/unfoldingWord-box3/tc-admin-app/issues/41))
- Built as the operations `release.plan`, `release.prepare`, `preparation.read`, `release.create`, `release.lookup`, `release.promote`, and `preparation.discard` ([#58](https://github.com/unfoldingWord-box3/tc-admin-app/issues/58)); the preparation is an addressable resource that survives a lost session.
- Candidate detection: new, changed released, unchanged, unknown, grouped for selection.
- Snapshot on `temp-tca-release/<version>` started from the previous release tag, one commit assembled from the release-tag and default-branch archives, bound to the default-branch SHA.
- Metadata merge: previous release metadata plus selected books, refreshed administrative entries, size and md5 for every file, scope set to released books. Nothing preselected; first release needs at least one book; released books are never removed.
- Health poll: every 5 seconds for 3 minutes, then hand off to a refresh button.
- Version calculation and edit, required release notes, pre-release option, create, promote.
- Stale-source protection, lost-response lookup by tag, retained branch on failure, branch deletion after success.

**EPIC: Demo readiness** ([#44](https://github.com/unfoldingWord-box3/tc-admin-app/issues/44))
- Written demo script against a Bahtraku repository on production.
- Full rehearsal on QA, then on production with a pre-release that is promoted during the demo.

## Milestone 2 — Manage

**Target:** November 2026
**Acceptance owner:** Birch

### Epics

- **EPIC: Uploads** ([#45](https://github.com/unfoldingWord-box3/tc-admin-app/issues/45)) — files, folders, drag and drop; path safety; overwrite warnings with text diffs; one-commit batches; metadata ingredient proposals.
- **EPIC: Metadata editing** ([#46](https://github.com/unfoldingWord-box3/tc-admin-app/issues/46)) — structured form over the Scripture Burrito model; validation on blur and save; diff review; direct commit; health rerun.
- **EPIC: Convert a release-only project to Scripture Burrito** ([#47](https://github.com/unfoldingWord-box3/tc-admin-app/issues/47)) — one-time, manager-confirmed conversion of the default branch using Door43's `/sb/` archive, turning a release-only project into an editable one.
- **EPIC: Open Bible Stories** ([#48](https://github.com/unfoldingWord-box3/tc-admin-app/issues/48)) — story detection, 50-story coverage, OBS creation with `gloss/textStories` flavor, release flow parity.
- **EPIC: Setup-incomplete recovery** ([#49](https://github.com/unfoldingWord-box3/tc-admin-app/issues/49)) — resume creation from any failed step without deleting the repository.

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

- Creation and release of the other book package types, Translation Notes, Translation Questions, and Translation Words Links: the same operations as Bible, parameterized by flavor and book file pattern (Q11 decided; Q18 records the flavor and pattern). Not in Milestone 1; scheduled at the Milestone 1 re-plan.
- Release support for subjects without book or story structure, such as Translation Words and Translation Academy, released whole.
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
