# Release from a temporary snapshot

Status: accepted

Selective releases will be assembled on a temporary `temp-tca-release/<version>` branch, started from the previous release tag (ADR 0010), and health-checked before Door43 release creation. The snapshot carries forward previously released content and includes only explicitly selected new or revised books/stories, preventing unfinished changes on the default branch from being published accidentally. The temporary branch is deleted only after release creation succeeds.
