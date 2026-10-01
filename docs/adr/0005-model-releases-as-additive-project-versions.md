# Model releases as additive project versions

Status: accepted; amended 1 October 2026 by [ADR 0013](0013-scripture-burrito-projects-only-import-and-explicit-removal.md): a release may also remove a book the manager leaves out, explicitly and listed, with a major version increment

A project version is assigned to each repository release event, while books and stories are independently selectable within that event. A release carries forward prior released content and adds or revises only the selected content. This matches the manager's need to release Jonah without publishing unfinished Ruth changes and keeps version history at the repository level.
