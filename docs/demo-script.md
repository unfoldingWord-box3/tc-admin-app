# Milestone 1 demo script

The demo of 16 October 2026 (#42, #44): a manager releases a real Bahtraku Bible from production Door43 with tC Admin, then creates a project. Every step names the operation the interface calls and the report or receipt to expect, so a rehearsal (#43) can be checked line by line against this page. Nothing here is improvised on the day: the pre-release the demo promotes is left by the production rehearsal, and the repository has been agreed with the Bahtraku team beforehand.

## The repository

| | |
| --- | --- |
| Project | `bahtraku/Perjanjian-Baru-Pendau` on `https://git.door43.org` (decided 22 September 2026, E9) |
| What it is | Scripture Burrito, 27 New Testament books, latest full release `v1.2` |
| Why it | Its health is `warning` on both refs (E16: ingredient sizes, and the Acts title in English), so the demo exercises the warning acknowledgement (H2, Q6) and the recomputed sizes and checksums (R10) |
| Rehearsal copy | the QA copy of the same repository, `bahtraku/Perjanjian-Baru-Pendau` on `https://qa.door43.org`, refreshed from production at each QA reset (E23) |
| Agreed with | the Bahtraku team, before the rehearsal: the repository, the book the demo includes, and the pre-release the rehearsal leaves |

The manager signing in is a member of `bahtraku` with push right on the repository (A2). The account used in rehearsal on QA is `tc-admin-qa`, which must be given push right on the QA copy before the rehearsal (the portfolio lists only repositories the account may push to, ADR 0014, P2).

## Before the day

1. The production rehearsal (#43) has left exactly one pre-release on the repository, the next version after `v1.2` by the rules of R9, and nothing else: no temporary branch, no second release, the default branch untouched (R3).
2. The deployed production Worker signs in and lists the portfolio (E38, the production callback confirmed).
3. Door43's health check on the pre-release's tag has run (E28: within seconds of the tag).
4. A second book to include is ready on the default branch, so the demo's own release has a visible change: one book revised since `v1.2`, agreed with the team.

## The script

Each step: what the presenter does, the operation the interface calls, what Door43 and tC Admin answer. The words in quotation marks are the interface's.

### 1. Sign in and the portfolio (S1 precondition, P1, P2)

- Open the production address; "Sign in with Door43 PROD". Operation: `/auth/login`, then `situation.read`.
- Expect the portfolio: `portfolio.list`, the `bahtraku` group with `Perjanjian-Baru-Pendau`, "Bible · Scripture Burrito · Pendau · 27 of 27 books · New Testament", health "Warning" as text (H4). Point out "Show all projects, including unsupported ones" and that a Resource Container project is listed with its reason and cannot be released (#21).

### 2. Promote the rehearsal's pre-release (S7, R8)

- Open the project; "Prepare a release". Operation: `release.plan`.
- Expect: the plan compares the default branch with the latest full release `v1.2`; the pre-release from the rehearsal is not a full release, so it is not the baseline. Say so: a pre-release is published to Door43 and visible there, and the catalog's full release stays `v1.2` until promotion.
- Promotion is one call: from the rehearsal's own stepper page if its session is still open, or through `release.promote` for the tag. Expect: one `PATCH` of the pre-release flag (R8), the release "Full release created", and after a few seconds the catalog's `prod` stage on the new tag. Open the release on Door43: same tag, same contents, no longer marked pre-release.

### 3. Select one book (S3, S4, R4)

- Back on the stepper for the project. Operation: `release.plan` again; the baseline is now the promoted release.
- Expect every book listed: the revised book "Changed since the last release" and every other "Unchanged", all "Carry forward" by default, "0 included · 27 carried forward · 0 left out". Read the three meanings beside the list.
- Set the revised book to "Include". Expect "1 included · 26 carried forward · 0 left out"; the version calculated as a patch increment (R9, a revision).
- Say what is not written: nothing, until the next step (ADR 0011).

### 4. Prepare the snapshot (R1, R2, R3)

- "Prepare the snapshot". Operation: `release.prepare`.
- Expect "Written: Branch … temp-tca-release/<version> · Commit …": the branch from the promoted release's commit, one commit that uploads the included book and `metadata.json` only; "26 files in the snapshot" with the carried books "from the previous release". Show the branch on Door43 if asked; the default branch has no new commit (R3).

### 5. Health check (H1, H2, Q6)

- The page polls `preparation.read` every 5 seconds. Expect within about ten seconds: "Health: Warning", the findings listed (the Acts title in English; the size warnings are gone, since the snapshot recomputed sizes and checksums, R10), and "Ready for release" with the acknowledgement box.
- Say: Door43 is the authority on health (H1); tC Admin shows what it reported and asks the manager to confirm before releasing over a warning (H2, Q6). A failing or unavailable check would block here with "Check again".

### 6. Notes, version, pre-release (R9, product spec §10)

- Read the generated notes: the revised book under "Revised", the carried-forward summary, the source commit and the previous release. Edit one line to show they are the manager's.
- Confirm the version; show that a lower one is refused (`invalid_version`, R9) and that a higher one is accepted.
- Tick "Create as a pre-release, to promote later"; tick the acknowledgement.

### 7. Create the release (R3, R7)

- "Create the pre-release". Operation: `release.create` with `acknowledge_warnings: true`.
- Expect "Written: … Tag <version> · Release <version>", "Pre-release created", the link to Door43, and the temporary branch deleted (the branch list on Door43 shows the default branch only). The receipt records the acknowledgement.
- Say: the tag and the release were one write on the snapshot commit; the branch went only after Door43 confirmed the release (R7); a failure here would have kept the branch and let the manager try again.

### 8. Promote it (S7)

- "Promote to a full release". Operation: `release.promote`. Expect "Full release created" and, on Door43, the same tag now a full release; the catalog's full release moves to it.

### 9. Create a project (S1, W1)

- "All projects" · "Create a project". Operation: `owner.list`, `language.list`, then `project.create.plan` and `project.create.apply`.
- Choose the owner (an organization the account may create in, or the account itself), "Bible", a title, an abbreviation, a language from the live Door43 list (a tag Door43 lists but the Scripture Burrito schema refuses is shown with the reason, Q30), New Testament scope.
- Expect the plan's preview: repository name `<language>_<abbreviation>`, the three files, the metadata; then the receipt: "Written: Repository … · Commit …", the project in the portfolio with "0 of 27 books", health "Information" with the one note that no release exists yet (E28, Q21).

### 10. Close

- The portfolio again: the released project with its new version, the new project at the bottom. Say what Milestone 2 adds (uploads, imports) and that everything shown is one operation per step, each recorded on the receipt the page shows.

## If something goes wrong on the day

| Seen | Say and do |
| --- | --- |
| "Project has been edited. The release process will need to restart." | Someone pushed to the default branch during the preparation (R5). "Start again from the selection": the plan is read again. |
| "Door43 is unavailable currently. Please refresh later." | Door43 did not answer. Refresh; nothing was written that the page does not list. |
| Health "Health check running" past a minute | Press "Refresh"; Door43 checks every push, there is no trigger (E28). |
| "Release creation failed: …" | The branch is kept (R7). "Try the release again". |
| "Door43 did not confirm the release." | Nothing is retried on its own (X1). The page reads the preparation again: if Door43 made the release, it is shown and nothing is created twice (R6). |
| "This release already exists on Door43." | The tag is there already; open it on Door43. |

## The rehearsals (#43)

1. **QA**, on the QA copy, with `tc-admin-qa` given push right: run steps 3 to 9 twice, first as written, then with one released book left out (S8: the removal named, the version a major increment, the previous release still holding the book). Record every step's answer against this script; file the recordings as fixtures and the run as an evidence entry.
2. **Production**, on the agreed repository, with the manager's own account: run steps 3 to 7 once and stop after the pre-release. That pre-release is what step 2 promotes on the day. Confirm the branch list shows the default branch only.

What a rehearsal must leave: on production, exactly one pre-release and no other change; on QA, whatever it made, kept for inspection until the next reset.
