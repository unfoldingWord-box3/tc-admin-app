# tC Admin Product Specification

Status: Accepted planning baseline. Amended 17 September 2026 for Scripture Burrito as the internal model (ADR 0008) and read-only unsupported projects (ADR 0009). Amended 18 September 2026 (proposed) with scenario and error identifiers and the operation mapping (ADR 0011); accepted when that pull request merges.

Related: [invariants](invariants.md) (what must never break), [operation catalog](operations.md) (what the system can do), [evidence register](evidence.md) (what is verified and what is open), [traceability](traceability.md) (how issues connect to this document).

## 1. Product summary

tC Admin is a hosted, desktop-first web application for Bible translation team leaders and project managers. It manages writable Door43 repositories from creation through project metadata maintenance, health checking, selective release preparation, release creation, and pre-release promotion.

Version one supports Bible translation projects and Open Bible Stories projects. Milestone 1 delivers Bible projects; Open Bible Stories follows in Milestone 2 ([roadmap](roadmap.md)). Bible Passage Sets are deferred.

## 2. Users and access

### Primary user

Bible translation team leaders and project managers who are responsible for the status and release of one or more Door43 projects.

### Authentication and authorization

- Authentication uses Door43 OAuth.
- Door43 organization and repository permissions are authoritative.
- The portfolio includes every organization and repository where the current user has write access.
- Repositories that are read-only to the user are not shown in the normal portfolio.
- Writable repositories in Resource Container, translationStudio, or translationCore format are release-only: they can be released but not edited until converted (ADR 0009). Repositories with no recognized metadata are unsupported and shown with the reason.
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

- Group projects by organization as the primary hierarchy.
- Allow configurable secondary ordering, including most recent activity or language.
- Provide filters for organization, language, project type, and health state.
- Analyze projects asynchronously and show the project immediately with a loading state.
- Display coverage as books present against the project's testament scope: 27 when only New Testament books are in scope, 39 when only Old Testament books are, 66 when both are; stories present out of 50 for OBS projects.
- Do not present coverage as translation completeness; it is repository/file coverage only.

### Health indicator

Each project pill displays a colored pill or eyebrow plus a small issue-count badge. Color is supplemented with text or an icon.

The model includes distinct states for:

- Healthy
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

- Organization
- Project type (Bible or Open Bible Stories), stored as the Scripture Burrito flavor
- Testament scope for Bible projects
- Repository name
- Target language
- Source resource
- Project title

The wizard generates complete Scripture Burrito metadata for the selected type, with tC Admin recorded as generator. The manager reviews the generated metadata before creation. Every project tC Admin creates is Scripture Burrito (ADR 0008).

After the organization is selected, project type is the first protected project-purpose choice. Once the first valid metadata is saved, it cannot be changed through normal editing. A purpose transition is a major repository change and is outside the normal version-one edit flow.

Book names and abbreviations can be inferred as files are added. The wizard may optionally accept an initial upload as its final step.

### Creation acceptance criteria

- A repository is created only in an organization where Door43 permits repository creation.
- The initial `metadata.json` is valid Scripture Burrito for the chosen flavor and lists every ingredient with size and checksum.
- If repository creation succeeds but the metadata commit or initial upload fails, the project is shown as **Setup incomplete** with a retry path.
- tC Admin does not automatically delete a partially created repository.

## 7. Project metadata management

Project metadata is `metadata.json`. Only Scripture Burrito projects can be edited; a release-only project is edited only after a manager-confirmed conversion of its default branch (a later milestone, ADR 0009).

- The primary editor is a friendly structured form.
- An optional obscured raw representation may be shown for inspection; the structured form remains authoritative for normal edits.
- Validation occurs as close to editing as practical: on blur where possible, before save, and during save.
- A successful save commits directly to the project's default branch.
- The manager reviews the metadata diff before confirming the commit.
- A metadata save creates one descriptive Door43 commit attributed to the authenticated Door43 user.
- Metadata changes are not allowed while release preparation is active.
- After a successful metadata commit, the project is refreshed and health is rerun.

Generated metadata must follow the Scripture Burrito specification. Door43's health check verifies that every listed ingredient exists and that its size matches, and verifies checksums on tags, so tC Admin writes size and md5 for every ingredient it touches. See the [Scripture Burrito specification](https://docs.burrito.bible/).

## 8. File management

### Uploads

Support individual files, multiple selected files, folder-style selection, and drag-and-drop. Uploads accept regular repository-relative files, including unknown files, subject to safety checks.

Reject:

- Absolute paths
- Path traversal
- Symlinks
- Executable behavior
- Files or batches over configured size limits

The exact byte limits remain an implementation-time decision. Typical operations are expected to contain fewer than 100 files.

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

## 10. Release preparation and release

### Release candidate selection

Any project with valid metadata in one of the four Door43 formats can be released; the result is always Scripture Burrito (ADR 0008). The manager prepares a release for one project at a time. Nothing is preselected. A first release requires at least one book or story. Candidate books/stories are grouped as:

- New and never released
- Previously released with current-branch changes
- Unchanged and available to carry forward
- Unknown files

The manager explicitly selects new books/stories and approved revisions.

### Snapshot rules

The release is assembled on a temporary branch named:

`temp-tca-release/<version>`

The branch starts from the latest full release tag, or from the default branch head for a first release (ADR 0010). tC Admin downloads two Door43 Scripture Burrito archives, the latest full release tag and the default branch, and assembles one commit containing:

- Every root file and every administrative ingredient from the default branch archive
- Previously released books/stories from the release-tag archive, carried forward unchanged unless selected
- Selected new and revised books/stories from the default branch archive
- Explicitly included unknown files
- `metadata.json` based on the previous release's metadata, with selected books added or updated, administrative entries refreshed, ingredient size and md5 correct for every file, and the released books listed as the scope

Unselected changes on the default branch must not enter the release. A released book or story is never removed by a later release. These are the central safety properties of selective release. The default branch is never modified by a release.

### Release stepper

1. Select new and revised books/stories.
2. Review the candidate snapshot and file differences.
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

### Versioning

- The baseline is the latest full release on Door43, whichever tool created it.
- No prior release, or a latest tag that is a bare year such as `1974`: default `v1.0.0`.
- A loose tag such as `v105` or `v1.2` is coerced to semver (`v105.0.0`, `v1.2.0`) before the increment.
- New books/stories: increment the minor component.
- Revisions or metadata-only changes: increment the patch component.
- Fundamental format changes: increment the major component.
- When multiple change categories occur, use the highest-impact category.
- The manager may edit the calculated version.
- The final version must be valid and greater than the latest release.
- Promotion does not change version or contents.
- Changes after a pre-release require a new version.

### Release notes

Release notes are required. tC Admin generates a draft that includes:

- Newly added books/stories
- Revised books/stories
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

Scenario identifiers (`S1` to `S7`) are cited by issues, tests, and [traceability.md](traceability.md).

### S1 — Create a project

Given a manager has repository-creation permission in an organization, when they complete the Bible or OBS wizard, then tC Admin creates the repository and valid Scripture Burrito metadata, and the project appears in the portfolio.

### S2 — Upload and overwrite

Given a project contains `08-RUT.usfm`, when the manager selects a replacement file, then tC Admin shows an overwrite warning, presents the final batch summary, and commits the accepted changes together under the manager's Door43 identity.

### S3 — Selective release

Given Ruth was previously released and Jonah is ready on the default branch, when the manager selects Jonah only, then the release snapshot carries forward the released Ruth version, includes Jonah, excludes unselected changes, and creates a new repository version.

### S4 — Revision release

Given Ruth was previously released and a new approved Ruth revision exists, when the manager selects Ruth, then the snapshot includes the revision and the release notes identify Ruth as updated.

### S5 — Unknown file

Given a repository contains an unmapped file, when the manager prepares a release, then the file appears under Unknown files and is included only after explicit confirmation.

### S6 — Stale release preparation

Given a release stepper has already passed health checking, when the project changes, then tC Admin discards the candidate and requires a fresh health check.

### S7 — Pre-release promotion

Given a pre-release exists, when the manager promotes it, then Door43 changes only its release status; version and contents remain unchanged.

## 14. Open implementation checks

These are facts to verify during implementation, not product decisions. Each is tracked as an open question in the [evidence register](evidence.md), which names its owner, what it blocks, and how it closes; verified results become facts there.

- Exact Door43 Swagger v1 operations for OAuth, writable-repository discovery, repository creation, file commits, branch/ref operations, release creation, release editing, and promotion (Q3, Q10).
- Exact Door43 health-check endpoint and asynchronous result shape (Q1, Q2).
- Required Scripture Burrito metadata for Bible (`scripture/textTranslation`) and OBS (`gloss/textStories`) projects (Q4).
- Health-check latency after a branch push on QA Door43 (Q2).
- How DCS represents tags and release targets for temporary branches (Q5).
- Safe upload byte limits for the Worker and Door43 API (Q15).

Product decisions still open, owned by the acceptance owner: whether a `warning` health result blocks release (Q6), how projects of other types are shown (Q11), and whether a manager can discard a preparation (Q14).
