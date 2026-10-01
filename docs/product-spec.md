# tC Admin Product Specification

Status: Accepted planning baseline. Amended 17 September 2026 for Scripture Burrito as the internal model (ADR 0008). Amended 18 September 2026 with scenario and error identifiers and the operation mapping (ADR 0011). Amended 1 October 2026 (proposed) for Scripture-Burrito-only projects, import, upload, and the three-state release selection (ADR 0013); accepted when that pull request merges.

Related: [invariants](invariants.md) (what must never break), [operation catalog](operations.md) (what the system can do), [evidence register](evidence.md) (what is verified and what is open), [traceability](traceability.md) (how issues connect to this document).

## 1. Product summary

tC Admin is a hosted, desktop-first web application for Bible translation team leaders and project managers. It lets a manager set up a Bible or Open Bible Stories project without thinking in terms of git, repositories, branches, or repository releases: create the project with valid Scripture Burrito metadata, add books or stories by upload or by import from an existing Door43 repository, see health and coverage, and release exactly the books they choose. translationCore 4 does the editing; tC Admin does the rest.

Version one supports Bible translation projects and Open Bible Stories projects, both Scripture Burrito. Milestone 1 delivers creation, upload, import, and release for both (re-planned 1 October 2026, [roadmap](roadmap.md)). Repositories in any other format or of any other type are not managed; they can be imported from (ADR 0013). Bible Passage Sets are deferred.

## 2. Users and access

### Primary user

Bible translation team leaders and project managers who are responsible for the status and release of one or more Door43 projects.

### Authentication and authorization

- Authentication uses Door43 OAuth.
- Door43 organization and repository permissions are authoritative.
- The portfolio includes every owner where the current user has write access: their organizations first, then their own account.
- Repositories that are read-only to the user are not shown in the normal portfolio.
- Only Scripture Burrito Bible and Open Bible Stories repositories are projects. A writable repository in Resource Container, translationStudio, or translationCore format, with no recognized metadata, or of any other type is unsupported and shown with the reason (ADR 0013). For a Bible or Open Bible Stories repository in another format, the reason offers an import into a new project.
- tC Admin must re-check authorization before mutations and releases; a stale screen must not grant access.

## 3. Goals

1. Create valid Bible and OBS repositories as Scripture Burrito without hand-writing metadata.
2. Give managers one portfolio view of project health and coverage.
3. Make safe file upload and overwrite operations possible without becoming a translation editor.
4. Allow managers to prepare releases containing only selected new or revised books/stories.
5. Reduce routine release support work for unfoldingWord.
6. Make every failure explicit, recoverable, and safe to retry.

## 4. Non-goals for version one

- Bible Passage Sets.
- Scripture or OBS text editing in an in-app editor.
- Translation suggestions or content-quality judgments beyond the Door43 health checker.
- Deep file-content validation; a later validator integration may add this.
- Assignment, issue management, or work queues.
- Pull-request creation or merge-conflict resolution for translation content.
- Coordinated releases across multiple repositories.
- A local replacement for Door43 history or release records.

## 5. Portfolio experience

### Organization and repository display

- Group projects by owner as the primary hierarchy: the manager's organizations first, then their own account.
- Allow configurable secondary ordering, including most recent activity or language.
- Provide filters for organization, language, project type, and health state.
- Analyze projects asynchronously and show the project immediately with a loading state.
- Display coverage as books present against the project's testament scope: 27 when only New Testament books are in scope, 39 when only Old Testament books are, 66 when both are; stories present out of 50 for OBS projects.
- Do not present coverage as translation completeness; it is repository/file coverage only.

### Health indicator

Each project pill displays a colored pill or eyebrow plus a small issue-count badge. Color is supplemented with text or an icon.

The model includes distinct states for:

- Healthy
- Information (the check passed with notes; does not block release)
- Warning
- Failing
- Never checked
- Health check running
- Door43 unavailable
- Unexpected health-check error
- Unsupported project type

The dashboard must not represent unavailable or unknown health as healthy.

## 6. Repository creation

### Wizard inputs

The manager provides:

- Owner: one of their organizations or their own account
- Project type (Bible or Open Bible Stories), stored as the Scripture Burrito flavor
- Project title, the name of the Bible or story collection
- Abbreviation, such as ULT, required
- Target language
- Testament scope for Bible projects, which sets the metadata's `currentScope` and the coverage target
- License (CC BY-SA 4.0 in Milestone 1, Q20)

The repository name is derived, not asked: `<language>_<abbreviation>` in lowercase, as in `en_ult`. The wizard shows it and checks that no repository of that name exists in the owner (decided 1 October 2026). The wizard generates complete Scripture Burrito metadata for the selected type (E37 lists what the schema requires), with tC Admin recorded as generator. The manager reviews the generated metadata before creation. Every project tC Admin creates is Scripture Burrito (ADR 0008).

After the owner is selected, project type is the first protected project-purpose choice. Once the first valid metadata is saved, it cannot be changed through normal editing. A purpose transition is a major repository change and is outside the normal version-one edit flow.

The wizard's final step offers to add books or stories at once, by upload or by import from an existing repository (§8); the manager may also do that later or add books with translationCore 4 outside this app.

### Creation acceptance criteria

- A repository is created only in an owner where Door43 permits repository creation for this account, and only under a name no repository there already has.
- The initial `metadata.json` is valid Scripture Burrito for the chosen flavor and lists every ingredient with size and checksum.
- When books were imported, `metadata.json` carries `idAuthorities.dcs` and one `relationships` entry of type `source` per imported repository, naming the repository and revision, with the project's own flavor (E24).
- If repository creation succeeds but the metadata commit or initial upload fails, the project is shown as **Setup incomplete** with a retry path.
- tC Admin does not automatically delete a partially created repository.

## 7. Project metadata management

Project metadata is `metadata.json`. Every project is Scripture Burrito; a repository in another format is never edited, only imported from (ADR 0013).

- The primary editor is a friendly structured form.
- An optional obscured raw representation may be shown for inspection; the structured form remains authoritative for normal edits.
- Validation occurs as close to editing as practical: on blur where possible, before save, and during save.
- A successful save commits directly to the project's default branch.
- The manager reviews the metadata diff before confirming the commit.
- A metadata save creates one descriptive Door43 commit attributed to the authenticated Door43 user.
- Metadata changes are not allowed while release preparation is active.
- After a successful metadata commit, the project is refreshed and health is rerun.

Generated metadata must follow the Scripture Burrito specification. Door43's health check verifies that every listed ingredient exists and that its size matches, and verifies checksums on tags, so tC Admin writes size and md5 for every ingredient it touches. See the [Scripture Burrito specification](https://docs.burrito.bible/).

## 8. Adding books and stories

A manager adds books or stories to a project in two ways: by uploading files they have, or by importing from an existing Door43 repository. translationCore 4 is the third way, outside this app.

### Uploads

Support individual files, multiple selected files, folder-style selection, and drag-and-drop. Uploads accept regular repository-relative files, including unknown files, subject to safety checks. A Bible project takes one USFM file per book; an Open Bible Stories project takes one markdown file per story.

Reject:

- Absolute paths
- Path traversal
- Symlinks
- Executable behavior
- Files or batches over configured size limits

The exact byte limits remain an implementation-time decision. Typical operations are expected to contain fewer than 100 files.

### Identifying the book or story

Each uploaded file is identified before it is committed. For a USFM file, the book comes from the `\id` line in its header, checked against the file name; for a story file, the story number comes from the file name, `01.md` or `1.md` for story 1. For a single file the manager is asked to confirm the book or story; for a batch, every file's identification is shown for confirmation and a file whose header and name disagree, or that identifies nothing, is held back until the manager decides. A confirmed book or story becomes the file's path and ingredient entry in Scripture Burrito form (`ingredients/<BOOK>.usfm`, `ingredients/content/<NN>.md`, E36).

### Import from an existing repository

Any repository in the Door43 catalog, in any metadata format (Scripture Burrito, Resource Container, translationStudio, translationCore), can be imported from, because Door43 serves every one of them as a Scripture Burrito archive (E1, E34). The manager:

1. Finds the owner. Their own organizations are listed first; any owner can be found by partial name (E35).
2. Picks a repository, from the owner's Bible and Open Bible Stories repositories (catalog search filtered to the two flavors, E35).
3. Chooses the content: the latest content on the default branch, or the last release. Unreleased repositories are offered too, since a translationCore or translationStudio repository may never have been released (decided 1 October 2026).
4. Picks all or some of the books or stories the repository has.

tC Admin downloads the archive, takes the chosen files from its `ingredients/` folder (for Open Bible Stories, `ingredients/content/<NN>.md`, E36), and adds them to the project as an upload operation: the same overwrite warnings, the same single commit. The repository and revision are recorded in the project's metadata as a `source` relationship (E24). For a Resource Container Open Bible Stories repository the catalog lists one container ingredient, so the stories are found in the archive, not the catalog (E35, E36).

### Overwrites

Before an overwrite, show the affected file and a clear warning. Provide a text diff where practical; for binary files provide old/new metadata comparison. The user confirms the selected files and then confirms one final operation summary.

All accepted additions and overwrites commit together as one operation. Door43 remains the history and recovery mechanism.

### Metadata inference

When a recognized new book or OBS story is uploaded, tC Admin proposes the corresponding ingredient entry. The manager reviews the proposed diff. If accepted, the content files and metadata update are committed together.

Files listed in metadata without a book or story scope are administrative files and are carried forward without confirmation. Unrecognized files that are not listed in metadata appear in an **Unknown files** section. They may be included only after explicit confirmation, remain prominent in release review, and are identified in release notes.

## 9. Health checking

The Door43 health-check service is authoritative for repository and release-snapshot health. tC Admin must not reinterpret its result into a more permissive release decision.

Door43 runs the health check itself on every pushed branch and tag; tC Admin reads the result and never triggers or reinterprets it. tC Admin reads health:

- When the dashboard loads
- When the manager uses the refresh button
- After a metadata commit
- Before release creation

Health analysis is asynchronous. A health-check error or unavailable service blocks release creation. The UI shows the exact actionable state and allows retry.

A health result of severity `warning` on the release snapshot does not block release creation. tC Admin shows the warnings and asks the manager to confirm they want to proceed; the release is created only after that confirmation (decided 18 September 2026).

## 10. Release preparation and release

### Release selection

A project is released when its manager says it is ready and Door43's health check passes. The manager prepares a release for one project at a time.

For a Bible project, every book present on the default branch or in the latest full release is listed with a three-state checkbox (decided 1 October 2026):

- **Include** (checked): the book's current file from the default branch goes into the release, whether the book is new or changed.
- **Carry forward** (dash): the file from the previous release, untouched by whatever is on the default branch.
- **Leave out** (blank): the book is not in the new release. A previously released book left out is removed from this release onward; earlier releases keep it.

Defaults: a first release starts with every book included. A later release starts with every previously released book carried forward, changed or not, and every new book left out, so nothing new or changed goes out unless the manager includes it. The meaning of the three states is shown beside the list. A release needs at least one included or carried-forward book.

For an Open Bible Stories project there is no selection: a release takes the whole default branch.

Unknown files appear in their own section and are included only after explicit confirmation (§8).

### Snapshot rules

The release is assembled on a temporary branch named:

`temp-tca-release/<version>`

The branch starts from the latest full release tag, or from the default branch head for a first release (ADR 0010). tC Admin then makes the branch match the selection in one or more commits (Q22):

- Included books: the file from the default branch is written to the branch (added or changed); carried-forward books are already there and are not touched; left-out books present on the branch are deleted
- Every root file and every administrative ingredient from the default branch, including `.gitea/` workflow files, so a repository's own validation travels with its releases (decided 22 September 2026)
- Explicitly included unknown files
- `metadata.json` whose ingredient entries are exactly the included and carried-forward books plus the refreshed administrative entries, with removed books dropped; whose top-level fields (identification, languages, copyright, localized names, type, relationships) come from the default branch's current metadata; with ingredient size and md5 recomputed for every file and the released books listed as the scope (decided 22 September 2026, Q7 and Q8)

A first release of a Bible project starts from the default branch head and deletes the left-out books. A release of an Open Bible Stories project starts from the default branch head and refreshes `metadata.json`; nothing is selected or deleted.

Changes on the default branch enter a release only through included books. A previously released book leaves a release only when the manager left it out, and the plan and the release notes name it (ADR 0013). These are the central safety properties of selective release. The default branch is never modified by a release.

### Release stepper

1. Set the selection state of each book: include, carry forward, or leave out.
2. Review the candidate snapshot: included, carried forward, removed, and file differences.
3. Run the health check.
4. Review and edit required release notes.
5. Confirm the calculated version or edit it.
6. Choose whether to create a pre-release.
7. Create the Door43 release.
8. Promote the same release later if it was a pre-release.

Each step is one operation in the [operation catalog](operations.md): steps 1 and 2 are `release.plan` and `release.prepare`, step 3 is `preparation.read`, steps 4 to 7 are `release.create` with the confirmed notes, version, and pre-release choice, and step 8 is `release.promote`. Nothing is written to Door43 before step 2, and nothing outside the plan's announced writes is written after it.

The temporary branch is deleted only after release creation succeeds. It remains available for inspection and retry after a release failure.

If the project changes during preparation, tC Admin shows:

> Project has been edited. The release process will need to restart.

The candidate is discarded and the stepper restarts from selection.

A manager may also discard an unreleased preparation. tC Admin asks for confirmation, deletes the temporary branch, and marks the preparation discarded. A preparation that has been released cannot be discarded (decided 22 September 2026, Q14).

### Versioning

- The baseline is the latest full release on Door43, whichever tool created it.
- No prior release, or a latest tag that is a bare year such as `1974`: the release is `v1.0.0`, and the project uses semantic versions from then on (decided 22 September 2026, Q19).
- A loose tag such as `v105` or `v1.2` is coerced to semver (`v105.0.0`, `v1.2.0`) before the increment.
- A previously released book is left out: increment the major component, because a consumer loses a book (decided 1 October 2026).
- New books/stories: increment the minor component.
- Revisions or metadata-only changes: increment the patch component.
- When multiple change categories occur, use the highest-impact category.
- The manager may edit the calculated version.
- The final version must be valid and greater than the latest release.
- Promotion does not change version or contents.
- Changes after a pre-release require a new version.

### Release notes

Release notes are required. tC Admin generates a draft that includes:

- Newly added books/stories
- Revised books/stories
- Removed books, each named
- Carried-forward content summary
- Explicitly included unknown files
- Project version and source snapshot/commit

The manager must review and confirm the notes before release creation.

## 11. Failure and retry requirements

Each situation is an error code in the [operation catalog](operations.md) §6, which fixes the message, whether it is retryable, and the next action. The code is the identifier used in code, tests, and logs; the behavior column here is the product requirement.

| Situation | Code | Required behavior |
| --- | --- | --- |
| Door43 unavailable | `door43_unavailable` | Show “Door43 is unavailable currently. Please refresh later.” Do not mutate. |
| Door43 session expired | `session_expired` | Ask the user to sign in again and preserve unsaved form state where safe. |
| User loses write access | `permission_denied` | Re-evaluate access and remove the project from the writable portfolio. |
| Concurrent project edit | `source_changed` | Show the restart message, discard the candidate, and rerun preparation. |
| Commit failure | `commit_failed` | Show `Commit failed: <error message>`. |
| Health-check error | `health_blocked` | Show the health-check error, block release, and offer retry. |
| Health-check warning | `warning_not_acknowledged` | Show the warnings; create the release only after the manager confirms they want to proceed. |
| Release creation failure | `release_failed` | Keep the temporary branch and offer retry. |
| Lost release response | `release_outcome_unknown` | Query Door43 for the expected tag/release before retrying. |
| Existing expected release found | `release_exists` | Show the existing release; do not create a duplicate. |
| Pre-release promotion failure | `promotion_failed` | Show `Pre-release promotion failed. <error message>`. |
| Partial creation | `setup_incomplete` | Show Setup incomplete with retry; do not auto-delete the repository. |

## 12. Success measures

- Managers can see the status of their writable projects without inspecting each repository individually.
- More projects are released more often.
- Routine release support requests to unfoldingWord decrease.
- Managers can create a valid repository and metadata without hand-writing metadata.
- Release attempts do not publish unselected unfinished changes.

## 13. Acceptance scenarios

Scenario identifiers (`S1` to `S9`) are cited by issues, tests, and [traceability.md](traceability.md).

### S1 — Create a project

Given a manager has repository-creation permission in an owner, when they complete the Bible or OBS wizard with a title, abbreviation, and language, then tC Admin creates the repository named `<language>_<abbreviation>` with valid Scripture Burrito metadata, and the project appears in the portfolio.

### S2 — Upload and overwrite

Given a project contains `08-RUT.usfm`, when the manager selects a replacement file, then tC Admin shows an overwrite warning, presents the final batch summary, and commits the accepted changes together under the manager's Door43 identity.

### S3 — Selective release

Given Ruth was previously released and Jonah is ready on the default branch, when the manager includes Jonah and leaves Ruth carried forward, then the release snapshot carries forward the released Ruth version, includes Jonah, excludes every other default-branch change, and creates a new repository version.

### S4 — Revision release

Given Ruth was previously released and a new approved Ruth revision exists, when the manager includes Ruth, then the snapshot includes the revision and the release notes identify Ruth as updated.

### S5 — Unknown file

Given a repository contains an unmapped file, when the manager prepares a release, then the file appears under Unknown files and is included only after explicit confirmation.

### S6 — Stale release preparation

Given a release stepper has already passed health checking, when the project changes, then tC Admin discards the candidate and requires a fresh health check.

### S7 — Pre-release promotion

Given a pre-release exists, when the manager promotes it, then Door43 changes only its release status; version and contents remain unchanged.

### S8 — Remove a released book

Given Ruth and Jonah were previously released, when the manager leaves Ruth out and carries Jonah forward, then the plan lists Ruth as removed, the snapshot and its metadata lack Ruth, the release notes name Ruth as removed, the version takes a major increment, and the previous release still holds Ruth.

### S9 — Import from an existing repository

Given a new Bible project and a Resource Container Bible repository in another owner, when the manager imports Ruth and Jonah from its last release, then tC Admin takes the two USFM files from the repository's Scripture Burrito archive, commits them as one upload operation with their ingredient entries, records the repository and revision as a source relationship, and the project's coverage shows two books.

## 14. Open implementation checks

These are facts to verify during implementation, not product decisions. Each is tracked as an open question in the [evidence register](evidence.md), which names its owner, what it blocks, and how it closes; verified results become facts there.

- Exact Door43 Swagger v1 operations for OAuth, writable-repository discovery, repository creation, file commits, branch/ref operations, release creation, release editing, and promotion (Q3, Q10).
- Exact Door43 health-check endpoint and asynchronous result shape (Q1, Q2).
- Required Scripture Burrito metadata for Bible (`scripture/textTranslation`) and OBS (`gloss/textStories`) projects (Q4; the schema's required fields are E37, what Door43's health check accepts is still open).
- Health-check latency after a branch push on QA Door43 (Q2).
- How DCS represents tags and release targets for temporary branches (Q5).
- Safe upload byte limits for the Worker and Door43 API (Q15).

Product decisions still open: the wizard's language list source (Q20). Decided on 1 October 2026 by Rich and Birch (ADR 0013, Q24, Q25): only Scripture Burrito Bible and Open Bible Stories repositories are projects, and any repository can be imported from; a manager may leave a previously released book out of a release; a first release starts with every book included and a later one with released books carried forward and new books left out; Open Bible Stories releases the whole default branch; the repository name is derived from language and abbreviation; Milestone 1 includes upload, import, and Open Bible Stories. Decided on 22 September 2026: a manager can discard an unreleased preparation (Q14); the release metadata takes ingredients from the previous release and top-level fields from the default branch (Q8); a non-Scripture-Burrito baseline forces a major version bump and a bare-year baseline yields `v1.0.0` (Q19); the OAuth permissions are `read:user write:repository write:organization` (Q10). Decided on 18 September 2026 and recorded in the evidence register: a `warning` does not block release but requires confirmation (Q6); version one manages Bible and Open Bible Stories only and every other type is unsupported (Q11, as first written; re-recorded 30 September 2026 after an agent-recorded reversal); the portfolio reads catalog metadata, not archives (Q17); a release's `currentScope` lists the released books (Q7).
