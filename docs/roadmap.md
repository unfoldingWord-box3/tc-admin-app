# tC Admin Roadmap

Status: Accepted, 17 September 2026
Audience: the engineering team building tC Admin
Tracking: [GitHub milestones](https://github.com/unfoldingWord-box3/tc-admin-app/milestones) and `EPIC:` issues in `unfoldingWord-box3/tc-admin-app`

## How this roadmap works

A **milestone** is a slice a real manager can use end to end. A milestone is done when the named acceptance owner has used it on the target Door43 host, not when its issues are closed.

An **epic** is one GitHub issue titled `EPIC: …` with the `epic` label and a task list of child issues. Epics are the build phases inside a milestone.

Only Milestone 1 carries a date. Milestones 2 and 3 carry a target month and are re-planned after the Milestone 1 demo.

Capacity assumption: one primary engineer working part time with agent assistance, with product and design support from Birch. If capacity changes, dates move; scope inside Milestone 1 does not grow.

## Version one outcome

A manager signs in with Door43, sees the health and coverage of every project they can write to, creates a valid Scripture Burrito project without hand-writing metadata, and releases exactly the books they choose without publishing unfinished work.

`sign in → discover → create → health check → prepare release → pre-release / full release → promote`

## Decisions this roadmap depends on

Recorded in [CONTEXT.md](../CONTEXT.md) and the [ADRs](adr). The ones that shape the build order:

- Scripture Burrito is the internal model, the only format tC Admin creates, and the format of every release. Door43's Scripture Burrito archive supplies repository content for release, converting Resource Container, translationStudio, and translationCore refs on the way ([ADR 0008](adr/0008-scripture-burrito-is-the-internal-model.md)).
- Any valid repository can be released; only Scripture Burrito repositories can be edited. Others are release-only until converted ([ADR 0009](adr/0009-release-any-valid-repository-edit-only-scripture-burrito.md)).
- Each release is one commit on top of the previous release tag, on a lineage separate from the default branch ([ADR 0010](adr/0010-release-lineage-from-the-previous-release-tag.md)). Releases add and update books, never remove them.
- Hard dependency: Rich's DCS change so `/sb/{ref}.zip` serves a rollup when the ref is already Scripture Burrito, deciding by the ref's own metadata type. tC Admin uses `/sb/{ref}.zip` for every ref and nothing else.
- Door43 runs health checks on every pushed branch. tC Admin polls for the result on the temporary release branch rather than triggering anything.
- Coverage counts against testament scope: 27, 39, or 66 books; 50 stories.
- The version is the Door43 release tag. Loose tags such as `v105` are coerced to semver and bumped. A bare year or no release defaults to `v1.0.0`. The manager can edit before release.

## Milestone 1 — Release

**Due:** Friday 16 October 2026
**Demo:** live on production Door43 against a real Bahtraku repository, in front of Birch and the Bahtraku team
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
- Create the `tc-admin-qa` organization on production Door43 so it survives QA resets. Seed repositories may hold files there but never releases.
- Register one confidential OAuth application per host at site-admin or unfoldingWord org level, with production, QA, and local redirect URIs.
- Write a seed script that copies one RC Bible (`bahtraku/id_tb1`) and one SB Bible (`bahtraku/Perjanjian-Baru-Pendau`) into `tc-admin-qa` on QA after each reset.
- Confirm the OAuth secret copied to QA by a reset still works, or document the manual step.
- Measure health-check latency on QA after a branch push and record the number.

**EPIC: Application foundation** ([#11](https://github.com/unfoldingWord-box3/tc-admin-app/issues/11))
- Replace `prototypes/tc-admin` with `web/` (Vite, React, TypeScript) and `worker/` (Cloudflare Worker, small router, Workers KV sessions, Wrangler).
- Copy the translationCore 4 design system tokens and components into `web/`.
- Deploy to a `workers.dev` URL with QA and production environment configuration.
- Vitest for units. One Playwright smoke test that signs in on QA and loads the portfolio.

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

- Release support for other book package repositories: Translation Notes, Translation Questions, Translation Words Links.
- Release support for subjects without book or story structure, such as Translation Words and Translation Academy, released whole.
- A tC Admin MCP server exposing Worker operations to Claude clients.
- Bible Passage Sets.
- Deeper file-content validation beyond Door43's health check.
- Translation editing and suggestions.
- Assignment and issue management.
- Coordinated multi-repository releases (today handled by `release_uw_resources`).
- Pull requests and merge resolution for translation content.
- Rich progress metrics and user-configurable progress definitions.
- Interface localization (architecture allows it; English first).

## Related experiments

- `prototypes/door43-mcp` is a read-only Door43 MCP proof of concept. It is not a tC Admin deliverable.
