# tC Admin Vision

## What we are building

tC Admin is a hosted web application that gives Bible translation team leaders and project managers a reliable control surface for their Door43 projects.

It brings together the work that currently requires manual repository inspection and support from unfoldingWord:

- Create a Bible or Open Bible Stories repository with a valid manifest.
- See the health and coverage of every writable project across the user's Door43 organizations.
- Upload and overwrite repository files with clear warnings and Door43 history.
- Maintain the manifest without hand-writing YAML.
- Prepare a precise release from selected books or stories.
- Create an optional pre-release and promote it when ready.

tC Admin does not author translations. It helps the people responsible for translation projects understand repository state, repair safe administrative problems, and release approved content.

## Why it should exist

Translation managers should not need to inspect repositories one at a time, hand-write manifests, or depend on unfoldingWord staff to perform routine releases. Those activities consume support capacity and make release timing dependent on specialized knowledge.

tC Admin should make the safe path visible and repeatable: a manager sees what changed, what is healthy, what will be released, and which exact Door43 version was produced.

## What changes if it succeeds

- Managers have a portfolio-level view of projects instead of a collection of isolated repository pages.
- New books and stories can be released as soon as they are ready without publishing unrelated unfinished work.
- A repository's manifest and health state become understandable to its manager.
- Uploads and administrative changes remain attributable to the Door43 user and recoverable through Door43 history.
- unfoldingWord support is needed for exceptions instead of routine repository creation and release work.

## How it works

1. A manager signs in with Door43 OAuth.
2. tC Admin discovers writable organizations and repositories.
3. Repositories are analyzed asynchronously and displayed by organization.
4. The manager creates or opens a project, uploads files, and maintains its manifest.
5. For a release, the manager selects new or revised books/stories.
6. tC Admin assembles a temporary snapshot from the prior release plus those selected changes.
7. The Door43 health checker validates the snapshot.
8. The manager reviews required release notes and chooses whether to create a pre-release.
9. tC Admin creates the Door43 release, then deletes the temporary branch after success.
10. The manager can later promote the same immutable pre-release.

## Product principles

- Door43 is the system of record for identity, permissions, repository history, and releases.
- A release is an explicit snapshot, never an accidental publication of the current default branch.
- Safe administrative automation is valuable; silent content decisions are not.
- Health failures and integration failures must be visible and retryable.
- The application should support managers at the scale of dozens of projects and remain usable when a portfolio exceeds 100 repositories.
