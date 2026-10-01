# Release from a temporary snapshot

Status: accepted; amended 1 October 2026 by [ADR 0013](0013-scripture-burrito-projects-only-import-and-explicit-removal.md): the snapshot carries forward, includes, or leaves out each book as the manager's selection says

Selective releases will be assembled on a temporary `temp-tca-release/<version>` branch, started from the previous release tag (ADR 0010), and health-checked before Door43 release creation. The snapshot carries forward previously released content and includes only explicitly selected new or revised books/stories, preventing unfinished changes on the default branch from being published accidentally. The temporary branch is deleted only after release creation succeeds.
