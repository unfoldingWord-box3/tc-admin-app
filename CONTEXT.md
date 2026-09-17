# tC Admin Context

tC Admin manages Door43 translation repositories for Bible translation team leaders and project managers. This glossary defines the product language used across the planning and implementation documents.

## Product language

**Project**:
A Door43 repository managed through tC Admin. A project may contain multiple Bible books or OBS stories.
_Avoid_: Workspace, release unit, project file

**Book**:
A Bible book represented by one or more files in a project.
_Avoid_: Release unit, sub-project

**Story**:
An Open Bible Story represented by one or more files in a project.
_Avoid_: Release unit, sub-project

**Project version**:
The version assigned to one release event for a project. It covers the complete release snapshot, which may contain one or more books or stories.
_Avoid_: Book version, file version

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
A repository file that tC Admin cannot map to a recognized Bible book, OBS story, manifest entry, or known administrative purpose.
_Avoid_: Invalid file, orphan file

**Setup incomplete**:
The state of a newly created project whose repository exists but whose manifest or initial upload operation has not completed successfully.
_Avoid_: Broken project, failed project

## Access and change language

**Writable project**:
A project for which the signed-in Door43 account currently has write access. Only writable projects appear in the normal tC Admin portfolio.
_Avoid_: Owned project, editable project

**Manifest edit**:
A change to the repository's `manifest.yaml` made through the structured manifest form and committed to the project's default branch.
_Avoid_: Metadata update, configuration edit

**Upload operation**:
A user-confirmed batch of file additions and overwrites committed together as one Door43 commit.
_Avoid_: Import, sync

**Release preparation**:
The workflow that selects books or stories, creates a temporary release snapshot, runs health checks, and prepares release notes before a Door43 release is created.
_Avoid_: Publishing, deployment

**Promotion**:
Changing an existing Door43 pre-release into a full release without changing its version or contents.
_Avoid_: Republish, rebuild
