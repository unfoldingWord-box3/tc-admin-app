# tC Admin Domain Model

Status: Accepted planning baseline. Amended 18 September 2026 (proposed) with identifiers and the release transition table (ADR 0011); accepted when that pull request merges.

Every state named here has an identifier, listed in [CONTEXT.md](../CONTEXT.md) "Identifiers" and repeated in the [operation catalog](operations.md) §5. The identifier is the spelling used in code, API, tests, and logs; the glossary term is the spelling used in prose and UI copy. The safety properties these states protect are numbered in [invariants.md](invariants.md).

## 1. Core concepts

### Project

A Door43 repository that a manager can oversee. A project has one project type, a target language, project metadata, a default branch, repository history, and zero or more releases.

### Book and story

A Bible project is a book package repository: one file per Bible book, so books are the content-selection units for release. An OBS project contains stories, which are its selection units. Translation Notes, Translation Questions, and Translation Words Links repositories are also book package repositories and could be released the same way in a later version. None of these units are separate tC Admin projects.

### Project version

A project-level version assigned to a release event. One version can contain one or more books or stories. The version increases even when the release adds or revises only one book/story.

### Release snapshot

An immutable Scripture Burrito candidate assembled for one release event from two Door43 archives: the latest full release tag and the default branch. It has a source project state, a selected content set, a resulting commit on the release lineage, health result, release notes, and a target version.

### Release lineage

Each release is one commit on top of the previous release tag (ADR 0010). The lineage is separate from the default branch history, and for non-Scripture-Burrito repositories it is the only place Scripture Burrito exists.

### Repository history

Door43 commits, tags, branches, and releases are the authoritative record of changes. tC Admin creates descriptive commits and links managers to Door43 history instead of creating a second durable audit ledger.

## 2. Relationships

```text
Door43 account
  └─ has write access to → Organization
                              └─ contains → Project (repository)
                                               ├─ has → Project metadata (Scripture Burrito model)
                                               ├─ contains → Books / Stories
                                               ├─ has → Default branch state
                                               └─ has → Project versions
                                                            └─ created from → Release snapshot
```

## 3. Project type and coverage

| Project type | Content units | Version-one target |
| --- | --- | ---: |
| Bible translation (including Aligned Bible) | Bible books, one `.usfm` file per book | 27, 39, or 66 by testament scope |
| Translation Notes, Translation Questions, Translation Words Links | Bible books, one `.tsv` file per book | 27, 39, or 66 by testament scope |
| Open Bible Stories | Stories | 50 |
| Bible Passage Set | Deferred | Not applicable |
| Any of the above in Resource Container, translationStudio, or translationCore format | Release-only until converted | As above |
| No recognized metadata | Unsupported | Not applicable |

Coverage is the number of recognized units present in the repository compared with the type-specific target. It is not a claim that a book/story is translated, complete, or approved (H5). Unknown coverage is `null`, never zero and never complete (H3).

Identifiers: `project_type` is `bible`, `tn`, `tq`, `twl`, `obs`, or `other`; `content_structure`, derived from it, is `book_package` (the first four), `story_package` (`obs`), or `whole` (`other`); `metadata_format` is `sb`, `rc`, `ts`, `tc`, or `none`; `editability` is `editable` (Scripture Burrito), `release_only` (Resource Container, translationStudio, translationCore), or `unsupported` (no recognized metadata), always with a one-line reason. Every book package type is created and released through the same operations, parameterized by its flavor and book file pattern (Q11, decided; Q18 records the flavor and pattern for the `.tsv` types). Milestone 1 exercises `bible`. A writable repository whose subject has no book or story structure (Translation Words, Translation Academy) is `other`: listed, with the reason stated, and neither releasable nor editable in version one.

Type, coverage, and health are read from the catalog metadata Door43 returns in the repository search, which is the same for every type (E12); the `/sb/` archive is read only when planning a release.

## 4. Content inclusion states

- **Unreleased** (`unreleased`): Present on the current default branch but not in the latest full release.
- **Released** (`released`): Present in the latest full release.
- **Changed released** (`changed_released`): Released previously, with newer default-branch changes.
- **Selected** (`selected`): Explicitly chosen for the current release preparation.
- **Carried forward** (`carried_forward`): Included from the previous full release without current unselected changes.
- **Excluded** (`excluded`): Never released, present in the current default branch, and intentionally omitted from this candidate. A released book or story can never become excluded (R2).
- **Administrative** (`administrative`): Listed in project metadata without a book or story scope. Always carried forward.
- **Unknown** (`unknown`): Neither a recognized book or story nor listed in project metadata.

For selection, `release.plan` groups units as `new` (unreleased), `changed_released`, `unchanged` (released and identical), and `unknown`. Nothing is selected by default (R4).

## 5. Health states

Health is separate from project lifecycle and release state.

- `healthy`
- `warning`
- `failing`
- `never_checked`
- `checking`
- `door43_unavailable`
- `health_error`
- `unsupported`

A `healthy` result advances a release candidate toward release creation. A `warning` result also advances it, but release creation then requires the manager to have read the warnings and confirmed (H2, Q6 decided). Every other state blocks (H1, H2). The Door43 health-check service determines the result and severity. Every health value carries the ref it was read for, the time, and the raw severity.

## 6. Release state model

```text
Not started
    ↓
Selecting content
    ↓
Snapshot prepared ── project changed ──→ Restart required
    ↓
Health checking ── checker unavailable/error ──→ Health blocked
    ↓
Ready for release
    ↓
Pre-release requested ── optional ──→ Release created
    ↓                                      ↓
Pre-release                             Full release
    ↓                                      ↑
Promotion ────────────────────────────────┘

Any release-creation failure → Retryable failure (temporary branch retained)
Successful release creation → temporary branch may be deleted
```

### Transitions

A release preparation is an addressable resource (see the [operation catalog](operations.md) §2). Its `state` takes these values, and only these transitions move it. `sha moved` means the default-branch head no longer equals the one the preparation is bound to (R5).

| From | Event | Guard | To |
| --- | --- | --- | --- |
| (none) | `release.plan` | project releasable | `selecting` |
| `selecting` | `release.prepare` | selection valid (R2, R4), version valid (R9), sha unchanged, permission (A2) | `snapshot_prepared` |
| `selecting` | `release.prepare` | commit failed | `retryable_failure` |
| `snapshot_prepared` | push confirmed | — | `health_checking` |
| `health_checking` | health read | `healthy` | `ready_for_release` |
| `health_checking` | health read | `warning` | `ready_for_release` with `requires_acknowledgement` |
| `health_checking` | health read | failing, unavailable, error | `health_blocked` |
| `health_checking` | health read | still running | `health_checking` |
| `health_blocked` | manager retries | — | `health_checking` |
| `ready_for_release` | `release.create` | notes confirmed, version valid, warnings acknowledged when present, sha unchanged, permission | `pre_release` or `full_release` |
| `ready_for_release` | `release.create` | Door43 failed | `retryable_failure` |
| `ready_for_release` | `release.create` | outcome unknown | `retryable_failure` (next action `release.lookup`, R6) |
| `retryable_failure` | `release.lookup` | release found | `pre_release` or `full_release` |
| `retryable_failure` | manager retries | — | the step that failed |
| any state before release | sha moved | — | `restart_required` |
| `restart_required` | `release.plan` | — | new preparation in `selecting` |
| any state before release | `preparation.discard` | manager confirmed, permission | `discarded` |
| `pre_release` | `release.promote` | permission | `full_release` |

The temporary branch exists from `snapshot_prepared` until `release.create` succeeds or the manager discards the preparation, and is retained in every failure state (R7). `discarded` is terminal: its branch is deleted and nothing further happens to it.

### State definitions

**Selecting content**:
The manager is choosing new books/stories, revisions, and unknown files.

**Snapshot prepared**:
A temporary branch, started from the previous release tag, contains the exact candidate contents in one commit and is bound to the default branch commit the selected books came from.

**Health checking**:
The authoritative health service is evaluating the candidate snapshot.

**Ready for release**:
The candidate has a successful health result, valid release version, and reviewed required notes.

**Pre-release**:
Door43 has created the candidate as a pre-release. Its version and contents are immutable in tC Admin.

**Full release**:
The same Door43 release has been promoted without changing version or contents.

**Restart required**:
The project changed after preparation began. The candidate cannot continue and must be rebuilt.

**Health blocked**:
The health checker is unavailable or returned an unexpected error. No release mutation is permitted.

**Retryable failure**:
A release mutation failed or its response was lost. tC Admin checks Door43 for an existing expected release before retrying.

**Discarded**:
The manager abandoned an unreleased preparation after confirmation; its temporary branch is deleted (Q14).

## 7. Version rules

The version is project-level and release-event-level:

- First release, or a bare-year baseline such as `1974`: `v1.0.0`, and semantic versions from then on (Q19).
- Baseline is the latest full release on Door43 regardless of creator. Loose tags are coerced to semver.
- Baseline release not in Scripture Burrito format (`rc`, `ts`, `tc`, read from the release tag's catalog entry): increment major, because the format change breaks consumers (Q19).
- New book/story: increment minor.
- Revision or metadata-only change: increment patch.
- Multiple categories use the highest-impact increment.
- Manager edits are allowed after calculation, but the final version must be valid and greater than the latest release.
- Pre-release promotion does not increment the version.

## 8. Project metadata model

Project metadata is an administrative description of a project. tC Admin owns the editing experience but Door43 owns the committed file.

The internal model is Scripture Burrito: identification, languages, type (flavor and scope), copyright, localized names, and ingredients with size, checksum, and scope. Resource Container projects are mapped into this model on read (ADR 0008). Scripture Burrito has no version field; the project version is the Door43 release tag.

The flavor is the project-purpose identity. It is selected early and immutable after the first valid save in version one.

## 9. Boundaries

The boundaries below are enforced as invariants R3, W1, W2, A1, A2, H1, and P3 in [invariants.md](invariants.md).

- Door43 owns identity and permissions.
- Door43 owns repository content history and releases.
- The Door43 health checker owns health conclusions.
- tC Admin owns workflow presentation, candidate selection, metadata form, snapshot orchestration, and safe retry behavior.
- Translation tools and managers own translation authorship.
- Passage Sets and assignment concepts are future domain extensions, not version-one entities.
