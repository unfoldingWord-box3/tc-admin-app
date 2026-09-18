# tC Admin Domain Model

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
| Bible translation | Bible books | 27, 39, or 66 by testament scope |
| Open Bible Stories | Stories | 50 |
| Bible Passage Set | Deferred | Not applicable |
| Any of the above in Resource Container, translationStudio, or translationCore format | Release-only until converted | As above |
| No recognized metadata | Unsupported | Not applicable |

Coverage is the number of recognized units present in the repository compared with the type-specific target. It is not a claim that a book/story is translated, complete, or approved.

## 4. Content inclusion states

- **Unreleased**: Present on the current default branch but not in the latest full release.
- **Released**: Present in the latest full release.
- **Changed released**: Released previously, with newer default-branch changes.
- **Selected**: Explicitly chosen for the current release preparation.
- **Carried forward**: Included from the previous full release without current unselected changes.
- **Excluded**: Never released, present in the current default branch, and intentionally omitted from this candidate. A released book or story can never become excluded.
- **Administrative**: Listed in project metadata without a book or story scope. Always carried forward.
- **Unknown**: Neither a recognized book or story nor listed in project metadata.

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

Only a successful health result can advance a release candidate toward release creation. The Door43 health-check service determines the result and severity.

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

## 7. Version rules

The version is project-level and release-event-level:

- First release: `v1.0.0`.
- New book/story: increment minor.
- Revision or metadata-only change: increment patch.
- Baseline is the latest full release on Door43 regardless of creator. Loose tags are coerced to semver; a bare year or no release defaults to `v1.0.0`.
- Fundamental format change: increment major.
- Multiple categories use the highest-impact increment.
- Manager edits are allowed after calculation, but the final version must be valid and greater than the latest release.
- Pre-release promotion does not increment the version.

## 8. Project metadata model

Project metadata is an administrative description of a project. tC Admin owns the editing experience but Door43 owns the committed file.

The internal model is Scripture Burrito: identification, languages, type (flavor and scope), copyright, localized names, and ingredients with size, checksum, and scope. Resource Container projects are mapped into this model on read (ADR 0008). Scripture Burrito has no version field; the project version is the Door43 release tag.

The flavor is the project-purpose identity. It is selected early and immutable after the first valid save in version one.

## 9. Boundaries

- Door43 owns identity and permissions.
- Door43 owns repository content history and releases.
- The Door43 health checker owns health conclusions.
- tC Admin owns workflow presentation, candidate selection, metadata form, snapshot orchestration, and safe retry behavior.
- Translation tools and managers own translation authorship.
- Passage Sets and assignment concepts are future domain extensions, not version-one entities.
