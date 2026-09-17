# tC Admin Context

tC Admin manages Door43 translation repositories for Bible translation team leaders and project managers. This glossary defines the product language used across the planning and implementation documents.

## Product language

**Project**:
A Door43 repository managed through tC Admin. A project may contain multiple Bible books or OBS stories. tC Admin says "project" where the translationCore 4 design system says "Bible", because tC Admin also manages OBS and lists repositories it cannot manage.
_Avoid_: Workspace, release unit, project file, Bible (as the name for the repository)

**Project type**:
The kind of content a project holds, derived from its metadata subject. Version one manages two types: Bible (including Aligned Bible) and Open Bible Stories. Every other type is unsupported.
_Avoid_: Subject (in user-facing copy), resource type

**Unsupported project**:
A writable repository whose project type tC Admin cannot manage, such as translationStudio, translationCore, or helps repositories. It appears in the portfolio read-only with the reason stated.
_Avoid_: Hidden project, invalid project, legacy project

**Scripture Burrito**:
The metadata format tC Admin uses as its internal model for every project and writes for every project it creates: a `metadata.json` file plus an `ingredients/` folder.
_Avoid_: SB (in user-facing copy), burrito

**Resource Container**:
The older Door43 metadata format built around `manifest.yaml`. tC Admin reads Resource Container projects through the Scripture Burrito model and does not write new ones.
_Avoid_: RC (in user-facing copy), legacy format

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
The exact set of project files selected and prepared for a release, including carried-forward previously released content.
_Avoid_: Current project, master snapshot

**Carried-forward content**:
A book or story copied from the latest full release without incorporating newer unselected changes from the default branch.
_Avoid_: Unchanged content, old content

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
