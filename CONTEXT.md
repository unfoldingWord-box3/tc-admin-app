# tC Admin Context

tC Admin manages Door43 translation repositories for Bible translation team leaders and project managers. This glossary defines the product language used across the planning and implementation documents. Terms are the spelling for prose and UI copy; the identifiers at the end are the spelling for code, API, tests, and logs. Neither has synonyms.

## Product language

**Project**:
A Door43 repository managed through tC Admin, presented so that a manager never has to think in terms of git, branches, or repository releases. A project may contain multiple Bible books or OBS stories. tC Admin says "project" where the translationCore 4 design system says "Bible", because tC Admin also manages OBS and lists repositories it cannot manage.
_Avoid_: Workspace, release unit, project file, Bible (as the name for the repository)

**Project type**:
The kind of content a project holds, derived from the Scripture Burrito flavor Door43 reads from its metadata, in every format (E42). Version one manages two types, the two flavors translationCore 4 edits: Bible (including Aligned Bible), flavor `scripture/textTranslation`, and Open Bible Stories, flavor `gloss/textStories`. Door43's catalog subject (Bible, Aligned Bible, Open Bible Stories) is a label it derives from the same flavor; tC Admin does not read it. Every other flavor, or none, is unsupported: listed with the reason stated, neither released nor edited; its identifier is `other` (Q11, Q23).
_Avoid_: Subject (Door43's catalog label: not read, never in user-facing copy), resource type

**Book package repository**:
A repository whose files are organized one per Bible book, one `.usfm` file per book, so that books can be selected individually for release. Bible and Aligned Bible projects are book package repositories.
_Avoid_: Multi-book repo, per-book repo

**Bible project**:
A book package repository whose content is Scripture: flavor `scripture/textTranslation`. The Greek and Hebrew Bibles are Bible projects like any other (Q23), though none is in Scripture Burrito yet (E42).
_Avoid_: Bible (as the name for the repository), scripture repo

**Metadata format**:
How a repository describes itself on its default branch: Scripture Burrito, Resource Container, translationStudio, or translationCore. Only Scripture Burrito repositories are projects tC Admin manages; a repository in any other format is unsupported and can be imported from (ADR 0013).
_Avoid_: Metadata type (in user-facing copy), repo type

**Unsupported project**:
A writable repository tC Admin cannot manage: one with no metadata Door43 recognizes, such as an empty repository; one whose project type tC Admin does not manage, such as a Translation Words or Translation Academy repository; or a Bible or Open Bible Stories repository in a format other than Scripture Burrito. It appears in the portfolio, when the manager chooses to show all projects, with the reason stated, and cannot be released or edited (ADR 0014). For a Bible or Open Bible Stories repository in another format, the reason offers an import into a new project.
_Avoid_: Hidden project, invalid project, broken project, release-only project, legacy project

**Scripture Burrito**:
The metadata format tC Admin uses as its internal model, writes for every project it creates, and produces for every release: a `metadata.json` file plus an `ingredients/` folder.
_Avoid_: SB (in user-facing copy), burrito

**Resource Container**:
The older Door43 metadata format built around `manifest.yaml`. Door43 converts it to Scripture Burrito when tC Admin imports from it. tC Admin never writes it and never releases it; Door43 and Gateway Admin release such repositories.
_Avoid_: RC (in user-facing copy), legacy format

**Scripture Burrito archive**:
The zip Door43 serves for any ref of a repository, converted to Scripture Burrito when the ref is another format and rolled up as-is when it already is (`GET /api/v1/repos/{owner}/{repo}/sb/{ref}.zip`, E34). tC Admin's only source of repository content for an import, and the source of book bytes for a release.
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
A book copied from the latest full release without incorporating newer changes from the default branch: the dash state of the release selection. A released book is carried forward in every later release unless the manager leaves it out.
_Avoid_: Unchanged content, old content

**Removed content**:
A book that was in the latest full release and that the manager left out of a new release. It is absent from that release's files and metadata; earlier releases keep it. Removal is explicit: the plan lists it and the release notes name it (ADR 0013).
_Avoid_: Deleted book, unpublished book (in user-facing copy)

**Selection state**:
The state of one book in a release selection, shown as a three-state checkbox. **Include** (checked): the book's current file from the default branch goes into the release, new or changed. **Carry forward** (dash): the file from the previous release, untouched. **Leave out** (blank): the book is not in the new release; a previously released book becomes removed content. A first release starts with every book included; a later release starts with previously released books carried forward and new books left out. Open Bible Stories projects have no selection: a release takes the whole default branch.
_Avoid_: Checked, ticked, unchecked, excluded (in user-facing copy)

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
A user-confirmed batch of file additions and overwrites committed together as one Door43 commit. Each uploaded file is identified as a book or story from its header and name, and the manager confirms the identification before the commit.
_Avoid_: Import, sync

**Release preparation**:
The workflow that selects books or stories, creates a temporary release snapshot, runs health checks, and prepares release notes before a Door43 release is created.
_Avoid_: Publishing, deployment

**Promotion**:
Changing an existing Door43 pre-release into a full release without changing its version or contents.
_Avoid_: Republish, rebuild

**Discard**:
Abandoning an unreleased release preparation after confirmation. tC Admin deletes its temporary branch; a released preparation cannot be discarded.
_Avoid_: Cancel, abort, rollback

**Import**:
Adding books or stories to a project from an existing Door43 repository of any metadata format, read through its Scripture Burrito archive. The manager finds the owner, picks the repository, chooses its latest content or its last release, and picks all or some of its books or stories; the files come from the archive's `ingredients/` folder. The repository and revision are recorded in the project's metadata as a `source` relationship under the `dcs` id authority (E24).
_Avoid_: Convert, clone, fork, sync, source translation

**Owner**:
The Door43 organization or user account that holds a project's repository. The manager's own account is an owner like any organization; the portfolio lists the manager's organizations first.
_Avoid_: Namespace, org (in user-facing copy)

**Abbreviation**:
The short name of a project, such as ULT for unfoldingWord Literal Text, written to the metadata's `identification.abbreviation`. With the language code it forms the repository name, `<language>_<abbreviation>` in lowercase, which the wizard derives and checks for uniqueness in the owner.
_Avoid_: Repository name (as a wizard field), slug, code

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
Whether tC Admin may write to a project's default branch: editable (a Scripture Burrito Bible or Open Bible Stories project) or unsupported (anything else). Always shown with its reason.
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
| Project type | `project_type` | `bible`, `obs`, `other` |
| Metadata format | `metadata_format` | `sb`, `rc`, `ts`, `tc`, `none` |
| Editability | `editability.state` | `editable`, `unsupported` |
| Testament scope | `coverage.scope` | `nt`, `ot`, `full`, `obs`, `unknown` |
| Coverage basis | `coverage.basis` | `catalog`, `archive` |
| Health state | `health.state` | `healthy`, `info`, `warning`, `failing`, `never_checked`, `checking`, `door43_unavailable`, `health_error`, `unsupported` |
| Content inclusion state | inclusion | `unreleased`, `released`, `changed_released`, `selected`, `carried_forward`, `excluded`, `removed`, `administrative`, `unknown` |
| Selection state | `selection` | `include`, `carry_forward`, `leave_out` |
| Candidate group | group | `new`, `changed_released`, `unchanged`, `unknown` |
| Release preparation state | `preparation.state` | `selecting`, `snapshot_prepared`, `health_checking`, `health_blocked`, `ready_for_release`, `pre_release`, `full_release`, `restart_required`, `retryable_failure`, `discarded` |
| Version rule | `version.rule_applied` | `first`, `removal`, `new_books`, `revisions` |
| Setup state | `setup.state` | `complete`, `incomplete` |
| Freshness source | `freshness.source` | `live`, `cache` |
| Temporary branch | — | `temp-tca-release/<version>` |
| Operation | operation name | dotted, as in the [operation catalog](docs/operations.md) §3: `release.plan`, `import.apply` |
| Error | `error.code` | snake_case, as in the operation catalog §6: `source_changed`, `health_blocked` |
| Invariant | — | group letter and number: `R1`, `H3`, `A2` |
| Evidence record, open question | — | `E<n>`, `Q<n>` |
| Acceptance scenario | — | `S1` to `S9` in product spec §13 |
