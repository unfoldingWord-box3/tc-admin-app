# Release any valid repository; edit only Scripture Burrito

Status: accepted, 17 September 2026; rewritten 18 September 2026

Any writable repository whose metadata Door43 recognizes as valid Resource Container, translationStudio, translationCore, or Scripture Burrito can be released through tC Admin. Only Scripture Burrito repositories can be edited through tC Admin: metadata form, uploads, and any other change to the default branch.

Repositories in the other three formats appear in the portfolio as **release-only** projects. The portfolio states the reason in one line and offers the release flow, and later the conversion flow, but no editing. Repositories with no recognized metadata, such as an empty repository with only a license and readme, appear as **unsupported** with the reason stated. Nothing writable is hidden.

Managers at the pilot partner own repositories in all four formats, some produced by tools no longer in use. They need to keep releasing those repositories without first migrating them. Since Door43 converts to Scripture Burrito at archive time (ADR 0008), the release flow does not depend on the default branch format at all, so refusing to release them would be an artificial limit. Editing is limited to Scripture Burrito because tC Admin writes exactly one format.

A manager-confirmed conversion of the default branch to Scripture Burrito is a Milestone 2 feature and turns a release-only project into an editable one.
