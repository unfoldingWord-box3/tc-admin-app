# tC Admin Context

tC Admin manages Door43 translation repositories for Bible translation team leaders and project managers. This glossary defines the product language used across the planning and implementation documents. Terms are the spelling for prose and UI copy; the identifiers at the end are the spelling for code, API, tests, and logs. Neither has synonyms.

## Product language

**Project**:
A Door43 repository managed through tC Admin. A project may contain multiple Bible books or OBS stories. tC Admin says "project" where the translationCore 4 design system says "Bible", because tC Admin also manages OBS and lists repositories it cannot manage.
_Avoid_: Workspace, release unit, project file, Bible (as the name for the repository)

**Project type**:
The kind of content a project holds, derived from its metadata subject. Recognized types: Bible (including Aligned Bible), Translation Notes, Translation Questions, Translation Words Links, and Open Bible Stories. The first four are book package types and share one creation and release flow; Milestone 1 exercises Bible. Any other subject is listed but neither released nor edited in version one.
_Avoid_: Subject (in user-facing copy), resource type

**Book package repository**:
A repository whose files are organized one per Bible book, so that books can be selected individually for release. Bible and Aligned Bible projects are book package repositories with one `.usfm` file per book; Translation Notes, Translation Questions, and Translation Words Links repositories are too, with one `.tsv` file per book. All are created and released through the same operations (decided 18 September 2026, Q11); the milestone that delivers the `.tsv` types is set at the Milestone 1 re-plan.
_Avoid_: Multi-book repo, per-book repo

**Bible project**:
A book package repository whose content is Scripture. The only book package type version one releases.
_Avoid_: Bible (as the name for the repository), scripture repo

**Metadata format**:
How a repository describes itself on its default branch: Scripture Burrito, Resource Container, translationStudio, or translationCore. Any valid format can be released; only Scripture Burrito can be edited.
_Avoid_: Metadata type (in user-facing copy), repo type

**Release-only project**:
A writable project whose metadata format is not Scripture Burrito. It can be released through tC Admin but not edited until it is converted.
_Avoid_: Read-only project, legacy project, unsupported project

**Unsupported project**:
A writable repository with no metadata Door43 recognizes, such as an empty repository. It appears in the portfolio with the reason stated and cannot be released or edited.
_Avoid_: Hidden project, invalid project, broken project

**Scripture Burrito**:
The metadata format tC Admin uses as its internal model, writes for every project it creates, and produces for every release: a `metadata.json` file plus an `ingredients/` folder.
_Avoid_: SB (in user-facing copy), burrito

**Resource Container**:
The older Door43 metadata format built around `manifest.yaml`. Door43 converts it to Scripture Burrito when tC Admin reads it for release. tC Admin does not write it.
_Avoid_: RC (in user-facing copy), legacy format

**Scripture Burrito archive**:
The zip Door43 serves for any ref of a repository, converted to Scripture Burrito when the ref is another format and rolled up as-is when it already is. tC Admin's only source of repository content for a release.
_Avoid_: Conversion zip, sb zip (in user-facing copy)

**Project metadata**:
The file that describes a project: `metadata.json` for Scripture Burrito, `manifest.yaml` for Resource Container. Presented to the manager as one structured form regardless of format.
_Avoid_: Manifest (as the generic term), config

**Ingredient**:
A file listed in a Scripture Burrito project's metadata. A book or story ingredient carries a scope naming its book or story; an administrative ingredient does not.
_Avoid_: Asset, attachment

**Coverage**:
The count of recognized books or stories present in a project against a target set by the project's testament scope: 27 when only New Testament books are in scope, 39 when only Old Testament books are, 66 when both are, and 50 stories for Open Bible Stories. Coverage is file coverage, never translation completeness.
_Avoid_: Progress, completion, percent translated

**Administrative file**:
A repository file that is listed in project metadata but is not a book or story, such as a license, versification, or generator settings file. Always carried forward, never flagged.
_Avoid_: Unknown file, extra file, junk file

**Book**:
A Bible book represented by one or more files in a project.
_Avoid_: Release unit, sub-project

**Story**:
An Open Bible Story represented by one or more files in a project.
_Avoid_: Release unit, sub-project

**Project version**:
The version assigned to one release event for a project, recorded as the Door43 release tag. It covers the complete release snapshot, which may contain one or more books or stories. Scripture Burrito metadata has no version field, so the tag is the only place the version lives. The baseline for the next version is the latest full release on Door43, whichever tool created it.
_Avoid_: Book version, file version, metadata version

**Release snapshot**:
The Scripture Burrito tree prepared for one release: previously released books from the latest full release, selected new and revised books plus every root file and administrative ingredient from the default branch, and metadata describing exactly that set.
_Avoid_: Current project, master snapshot

**Release lineage**:
The line of commits made only of releases, each release one commit on top of the previous release tag. Separate from the default branch history.
_Avoid_: Release branch (for the permanent history), master

**Carried-forward content**:
A book or story copied from the latest full release without incorporating newer unselected changes from the default branch. Once released, a book or story is carried forward in every later release; releases never remove content.
_Avoid_: Unchanged content, old content, removed content

**Pre-release**:
An optional Door43 release created for review before being promoted to a full release. Promotion does not change its version or contents.
_Avoid_: Draft release, release candidate version

**Health check**:
The authoritative Door43 repository-health analysis for a project or release snapshot.
_Avoid_: Local validation, content review

**Unknown file**:
A repository file that is neither a recognized Bible book or OBS story nor listed in project metadata as an administrative file.
_Avoid_: Invalid file, orphan file

**Setup incomplete**:
The state of a newly created project whose repository exists but whose project metadata or initial upload operation has not completed successfully.
_Avoid_: Broken project, failed project

## Access and change language

**Writable project**:
A project for which the signed-in Door43 account currently has write access. Only writable projects appear in the normal tC Admin portfolio.
_Avoid_: Owned project, editable project

**Metadata edit**:
A change to the project metadata made through the structured metadata form and committed to the project's default branch.
_Avoid_: Manifest edit, configuration edit

**Upload operation**:
A user-confirmed batch of file additions and overwrites committed together as one Door43 commit.
_Avoid_: Import, sync

**Release preparation**:
The workflow that selects books or stories, creates a temporary release snapshot, runs health checks, and prepares release notes before a Door43 release is created.
_Avoid_: Publishing, deployment

**Promotion**:
Changing an existing Door43 pre-release into a full release without changing its version or contents.
_Avoid_: Republish, rebuild

## System language

**Operation**:
One named thing tC Admin can do, listed in the [operation catalog](docs/operations.md). Every action in the interface, every test, and every future agent tool is an operation. Three kinds: read, plan, apply.
_Avoid_: Endpoint, action, command (as the generic term)

**Plan**:
The result of a plan operation: exactly what an apply would write to Door43, bound to the source commit it was computed from, without writing anything. The manager reviews a plan before confirming.
_Avoid_: Preview, dry run, draft (as the generic term)

**Receipt**:
The result of an apply operation: what was written to Door43, with a request id. A receipt never lists a write the plan did not announce.
_Avoid_: Response, result, log

**Project report**:
The complete situation of one project returned by one read: type, format, editability, coverage, health, latest release, default-branch head, active preparation, setup state, permissions, and freshness, each derived fact with its source and age.
_Avoid_: Project detail, summary, dashboard data

**Editability**:
Whether tC Admin may write to a project's default branch: editable (Scripture Burrito), release-only (other valid formats), or unsupported (no recognized metadata). Always shown with its reason.
_Avoid_: Mode, capability, status

**Freshness**:
When a fact was read, whether live or from cache, and how old it is. Every cached fact shows its freshness.
_Avoid_: Timestamp, cache state

**Invariant**:
A safety property that must hold in every state, numbered in [invariants.md](docs/invariants.md), enforced in one place, and proven by a test carrying its identifier.
_Avoid_: Rule, constraint, requirement (for these properties)

**Evidence record**:
A verified fact about Door43, Scripture Burrito, or the pilot repositories, numbered `E<n>` in the [evidence register](docs/evidence.md) with its host, date, and method.
_Avoid_: Note, finding, assumption

**Open question**:
A missing fact or decision, numbered `Q<n>` in the evidence register with its owner, what it blocks, and how it closes. Not decided by whoever is building; built behind with a labeled assumption.
_Avoid_: TODO, unknown, risk

## Identifiers

The identifier is the only spelling used in code, API payloads, tests, logs, and fixtures. The term is the only spelling used in prose and UI copy. A label map in `web/` translates identifier to term.

| Term | Identifier | Values |
| --- | --- | --- |
| Project type | `project_type` | `bible`, `tn`, `tq`, `twl`, `obs`, `other` |
| Content structure | `content_structure` | `book_package`, `story_package`, `whole` |
| Metadata format | `metadata_format` | `sb`, `rc`, `ts`, `tc`, `none` |
| Editability | `editability.state` | `editable`, `release_only`, `unsupported` |
| Testament scope | `coverage.scope` | `nt`, `ot`, `full`, `obs`, `unknown` |
| Coverage basis | `coverage.basis` | `catalog`, `archive` |
| Health state | `health.state` | `healthy`, `warning`, `failing`, `never_checked`, `checking`, `door43_unavailable`, `health_error`, `unsupported` |
| Content inclusion state | inclusion | `unreleased`, `released`, `changed_released`, `selected`, `carried_forward`, `excluded`, `administrative`, `unknown` |
| Candidate group | group | `new`, `changed_released`, `unchanged`, `unknown` |
| Release preparation state | `preparation.state` | `selecting`, `snapshot_prepared`, `health_checking`, `health_blocked`, `ready_for_release`, `pre_release`, `full_release`, `restart_required`, `retryable_failure` |
| Setup state | `setup.state` | `complete`, `incomplete` |
| Freshness source | `freshness.source` | `live`, `cache` |
| Temporary branch | — | `temp-tca-release/<version>` |
| Operation | operation name | dotted, as in the [operation catalog](docs/operations.md) §3: `release.plan`, `release.prepare` |
| Error | `error.code` | snake_case, as in the operation catalog §6: `source_changed`, `health_blocked` |
| Invariant | — | group letter and number: `R1`, `H3`, `A2` |
| Evidence record, open question | — | `E<n>`, `Q<n>` |
| Acceptance scenario | — | `S1` to `S7` in product spec §13 |
