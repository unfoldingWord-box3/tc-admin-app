# Milestone 1 demo script

The demo of 16 October 2026 (#42, #44): a manager releases a real Bahtraku Bible from production Door43 with tC Admin, then creates a project. Every step names the operation the interface calls and the report or receipt to expect, so a rehearsal (#43) can be checked line by line against this page. Nothing here is improvised on the day: the pre-release the demo promotes is left by the production rehearsal, and the repository has been agreed with the Bahtraku team beforehand.

## The repository

| | |
| --- | --- |
| Project | `bahtraku/Perjanjian-Baru-Pendau` on `https://git.door43.org` (decided 22 September 2026, E9) |
| What it is | Scripture Burrito, 27 New Testament books, latest full release `v1.2` |
| Why it | Its health is `warning` on both refs (E16: ingredient sizes, and the Acts title in English), so the demo exercises the warning acknowledgement (H2, Q6) and the recomputed sizes and checksums (R10) |
| Rehearsal copy | the QA copy of the same repository, `bahtraku/Perjanjian-Baru-Pendau` on `https://qa.door43.org`, refreshed from production at each QA reset (E23) |
| Agreed with | the Bahtraku team, before the rehearsal: the repository, the two books (below), and the pre-release the rehearsal leaves |
| Book A | the book the production rehearsal includes in its pre-release; revised on the default branch since `v1.2`; named here before the rehearsal: _____ |
| Book B | the book the demo includes on the day; also revised on the default branch since `v1.2`, and not in the rehearsal's pre-release; named here before the rehearsal: _____ |

The manager signing in is a member of `bahtraku` with push right on the repository (A2). The account used in rehearsal on QA is `tc-admin-qa`, which needs push right on the QA copy (the portfolio lists only repositories the account may push to, ADR 0014, P2): it has it through the `bahtraku` team Translators, on production too, so the weekly QA reset keeps it (E58).

## Before the day

1. The production rehearsal (#43) has left exactly one pre-release on the repository, the next version after `v1.2` by the rules of R9, and nothing else: no temporary branch, no second release, the default branch untouched (R3).
2. The deployed production Worker signs in and lists the portfolio (E38, the production callback confirmed).
3. Door43's health check on the pre-release's tag has run (E28: within seconds of the tag).
4. Book A and book B are two different books, both revised on the default branch since `v1.2` and agreed with the team; the rehearsal's pre-release carries book A's revision and not book B's, so on the day book B is the one book "Changed since the last release" once the pre-release is promoted, with no further commit on the default branch. On 7 October 2026 neither condition held: the default branch was `v1.2`'s commit on production, nothing pushed since 21 July (E58), so the team's revisions of both books must land on production's default branch before the production rehearsal.
5. The manager's account may create repositories in `tc-admin-qa-org` on production: the organization is in its `owner.list` (an owner team, or a team that may create repositories). If it is not, step 9 is not run; `bahtraku` is never the fallback.

## The script

Each step: what the presenter does, the operation the interface calls, what Door43 and tC Admin answer. The words in quotation marks are the interface's.

### 1. Sign in and the portfolio (S1 precondition, P1, P2)

- Open the production address; "Sign in with Door43 PROD". Operation: `/auth/login`, then `situation.read`.
- Expect the portfolio: `portfolio.list`, the `bahtraku` group with `Perjanjian-Baru-Pendau`, "Bible · Scripture Burrito · Pendau · 27 of 27 books · New Testament", health "Warning" as text (H4). Point out "Show all projects, including unsupported ones" and that a Resource Container project is listed with its reason and cannot be released (#21).

### 2. Promote the rehearsal's pre-release (S7, R8)

- Open the project; "Prepare a release". Operation: `release.plan`.
- Expect: the plan compares the default branch with the latest full release `v1.2`; the pre-release from the rehearsal is not a full release, so it is not the baseline. Say so: a pre-release is published to Door43 and visible there, and the catalog's full release stays `v1.2` until promotion. Do not prepare from this plan: its calculated version is the pre-release's own (Q31, E58).
- Open the project; in "A release by its tag, to see it or promote a pre-release" type the rehearsal's tag and "Open the release". Operation: `release.lookup`. Expect the release page: the tag, "Pre-release", the snapshot commit, the Door43 link. "Promote to a full release". Operation: `release.promote`: one `PATCH` of the pre-release flag (R8). Expect "Full release" and "Written: release <tag>", and after a few seconds the catalog's `prod` stage on the new tag. Open the release on Door43: same tag, same contents, no longer marked pre-release. This page is reachable after any sign-in; it does not depend on the stepper that made the pre-release (E57).

### 3. Select one book (S3, S4, R4)

- Back on the stepper for the project. Operation: `release.plan` again; the baseline is now the promoted release.
- Expect every book listed: book B "Changed since the last release" (book A is "Unchanged": its revision is the promoted release's) and every other "Unchanged", all "Carry forward" by default, "0 included · 27 carried forward · 0 left out". Read the three meanings beside the list.
- Set book B to "Include". Expect "1 included · 26 carried forward · 0 left out"; the version calculated as a patch increment (R9, a revision).
- Say what is not written: nothing, until the next step (ADR 0011).

### 4. Prepare the snapshot (R1, R2, R3)

- "Prepare the snapshot". Operation: `release.prepare`.
- Expect "Written: Branch … temp-tca-release/<version> · Commit …": the branch from the promoted release's commit, one commit that uploads the included book and `metadata.json` only; "33 files in the snapshot": the 26 carried books from "the previous release", book B and the six administrative files (`LICENSE.md`, `README.md`, `metadata.json`, `ingredients/license.md`, `ingredients/scribe-settings.json`, `ingredients/versification.json`) from "the default branch" (E58). Show the branch on Door43 if asked; the default branch has no new commit (R3).

### 5. Health check (H1, H2, Q6)

- The page polls `preparation.read` every 5 seconds. Expect within about ten seconds: "Health: Warning", the findings listed (the Acts title in English, shown as Door43 words it, Markdown marks included; the size warnings are gone, since the snapshot recomputed sizes and checksums, R10), and "Ready for release" with the acknowledgement box.
- Say: Door43 is the authority on health (H1); tC Admin shows what it reported and asks the manager to confirm before releasing over a warning (H2, Q6). A failing or unavailable check would block here with "Check again".

### 6. Notes, version, pre-release (R9, product spec §10)

- Read the generated notes: book B under "Revised", the carried-forward summary, the source commit and the previous release. Edit one line to show they are the manager's.
- First tick "Create as a pre-release, to promote later" and the acknowledgement: over a warning the button stays disabled until it is ticked, and the button itself creates the release.
- Show the version check: type the previous release's version and press "Create the pre-release". Expect "Version must be valid and greater than <latest>." (`invalid_version`, R9), refused before anything is written. Set the field back to the calculated version. Do not try a higher one: one that is accepted is created as the release.

### 7. Create the release (R3, R7)

- "Create the pre-release". Operation: `release.create` with `acknowledge_warnings: true`.
- Expect "Written: … Tag <version> · Release <version>", "Pre-release created", the link to Door43, and the temporary branch deleted (the branch list on Door43 shows the default branch only). The receipt records the acknowledgement.
- Say: the tag and the release were one write on the snapshot commit; the branch went only after Door43 confirmed the release (R7); a failure here would have kept the branch and let the manager try again.

### 8. Promote it (S7)

- "Promote to a full release". Operation: `release.promote`. Expect "Full release created" and, on Door43, the same tag now a full release; the catalog's full release moves to it.

### 9. Create a project (S1, W1)

- "All projects" · "Create a project". Operation: `owner.list`, `language.list`, then `project.create.plan` and `project.create.apply`.
- The owner is `tc-admin-qa-org`, unfoldingWord's own organization on production (E23), never the partner's; the title, abbreviation, and language are fixed here before the day: title "Demo 16 October 2026", abbreviation `demo1016`, language `id` (Bahasa Indonesia), New Testament scope, so the repository is `tc-admin-qa-org/id_demo1016`. Its name is checked free on the morning (the plan refuses a taken name as `name_taken`). The repository stays after the demo as a record; Rich removes it from Door43 by hand if the team prefers (tC Admin never deletes a repository, W4).
- Expect the plan's preview: repository name `<language>_<abbreviation>`, the three files, the metadata; then the receipt: "Written: Repository … · Commit …" and the project's page, "0 of 27 books", health "Never checked". Back in the portfolio a few seconds later the project reads "Coverage unknown" (Door43 lists no ingredients for a project with no books, E45) and health "Information", the one note that no release exists yet (E28, Q21, E58).

### 10. Close

- The portfolio again: the released project, its health; the new version is on its release page and on Door43, not in the portfolio's row (E58); the new project in the `tc-admin-qa-org` group. Say what Milestone 2 adds (uploads, imports) and that everything shown is one operation per step, each recorded on the receipt the page shows.

## If something goes wrong on the day

| Seen | Say and do |
| --- | --- |
| "Project has been edited. The release process will need to restart." | Someone pushed to the default branch during the preparation (R5). "Start again from the selection": the plan is read again. |
| "Door43 is unavailable currently. Please refresh later." | Door43 did not answer. Refresh; nothing was written that the page does not list. |
| Health "Health check running" past a minute | Press "Refresh"; Door43 checks every push, there is no trigger (E28). |
| "Release creation failed: …" | The branch is kept (R7). "Try the release again". |
| "Door43 did not confirm the release." | Nothing is retried on its own (X1). Press "Try the release again": `release.create` looks the tag up before sending anything. If Door43 made the release, the preparation records it, "This release already exists on Door43." is shown, and nothing is created twice (R6). If not, it is created once. |
| "This release already exists on Door43." | The tag is there already; open it on Door43. |
| The creation plan refuses the name as taken | `tc-admin-qa-org/id_demo1016` already exists (a rehearsal left it): use the abbreviation `demo1016b`, decided here, and say so. |
| `tc-admin-qa-org` is not in the owner list, or the plan refuses it (`permission_denied`) | The account may not create there (before the day, 5). Stop step 9; do not choose another owner. |

## The rehearsals (#43)

Before either rehearsal, read the repository on its host: its latest full release and its default-branch head. `v1.2` above is the latest full release as of 7 October 2026; if the team has released since, the rehearsal compares with that release and the versions in this script move with it. On QA the copy must be as the last reset left it, with production's latest full release and default-branch head: a test release on the QA copy since the reset (the 7 October run left `v1.2.1`, `v1.2.2`, `v2.0.0`, and two commits on `master`, E58) means waiting for the next reset. tC Admin's own stored preparations outlive a reset and, by the code and tests E58 cites (not yet observed across a reset), need no clearing.

1. **QA**, on the QA copy, with `tc-admin-qa` given push right, in this order: the production rehearsal's own steps below (book A, stopping at the pre-release); then the demo's steps 2 to 9 as written (book B, the project under `tc-admin-qa-org` on QA); then one more release with one released book left out (S8: the removal named, the version a major increment, the previous release still holding the book). Record every step's answer against this script; file the recordings as fixtures and the run as an evidence entry. Run on 7 October 2026 (E58), with Titus and Philemon as QA stand-ins for book A and book B, each revised on QA's default branch first.
2. **Production**, on the agreed repository, with the manager's own account, its own steps, not the demo's: `release.plan` against `v1.2` (every book "Carry forward", book A and book B both "Changed since the last release"); set book A to "Include" and nothing else; the version stays the calculated one (the next after `v1.2` by R9: a patch increment); "Prepare the snapshot"; the health check as in step 5, the warning acknowledged; the notes as generated; "Create as a pre-release" ticked; "Create the pre-release". Stop. Do not promote. Book B stays revised on the default branch and is not in that pre-release.

What a rehearsal must leave: on production, exactly one pre-release and no other change; on QA, whatever it made, kept for inspection until the next reset.
