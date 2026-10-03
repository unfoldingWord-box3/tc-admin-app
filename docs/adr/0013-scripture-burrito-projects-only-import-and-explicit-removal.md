# Manage Scripture Burrito projects only; import from any repository; let a manager remove a released book

Status: accepted by Rich and Birch, 1 October 2026; proposed in writing until the pull request that adds it merges. Supersedes ADR 0009 (both its 17 and 18 September versions). Amends ADR 0003, ADR 0005, and ADR 0010 on removal. Decision 1 amended by ADR 0014 (2 October 2026): unsupported repositories are listed when the manager chooses to show all projects.

## Decision

1. **A project is a Scripture Burrito repository of one of the two flavors translationCore 4 edits**: `scripture/textTranslation` (Bible, including Aligned Bible) or `gloss/textStories` (Open Bible Stories). tC Admin creates, fills, and releases those and nothing else. A writable repository in Resource Container, translationStudio, or translationCore format, of any other type, or without recognized metadata is listed as unsupported with the reason stated; it is never edited, released, or converted in place. Door43 and Gateway Admin release such repositories.
2. **Any repository in the Door43 catalog can be imported from.** Door43 serves every repository, in every format, as a Scripture Burrito archive (E1, E34). An import reads the archive of the chosen revision, the latest content or the last release, takes the chosen books or stories from `ingredients/`, and commits them to the project as one upload operation, recording the source repository and revision as a `source` relationship (E24). The source is never written.
3. **A manager may leave a previously released book out of a release.** The release selection is a three-state list: include (the default-branch file goes in), carry forward (the previous release's file, untouched), leave out (not in this release). A first release starts with every book included; a later release starts with released books carried forward and new books left out. A book left out that was released before is removed from that release onward; the plan lists it, the release notes name it, and the version takes a major increment. Earlier releases keep it.
4. **An Open Bible Stories release takes the whole default branch.** Stories are counted and added but not selected for release.

## Why

translationCore 4 edits only Scripture Burrito repositories, and tC Admin exists to set those up and release them for the people who use translationCore 4. The 18 September rewrite of ADR 0009, which made any valid repository releasable, solved a problem this app does not have: repositories in the other formats are already released on Door43 or with Gateway Admin, and their users are not translationCore 4 users. Birch's original glossary said as much: "Version one manages two types: Bible (including Aligned Bible) and Open Bible Stories. Every other type is unsupported." Making the other formats import sources instead keeps their content reachable, through the one archive route Door43 already provides, without tC Admin ever writing a format it does not own.

The rule that a released book is never removed (ADR 0005, ADR 0010) came from unfoldingWord's own resources, where a missing book breaks the apps that consume them. The repositories tC Admin releases have no such consumers; a manager who published a book too early needs to be able to take it back. Making removal explicit, listed, and a major version keeps the safety the rule was protecting: nothing disappears by default or by omission.

## Consequences

- CONTEXT.md loses "Release-only project" and "Source translation" and gains "Import", "Owner", "Abbreviation", "Selection state", and "Removed content"; `editability.state` is `editable | unsupported`; `selection` is `include | carry_forward | leave_out`; `version.rule_applied` gains `removal` and loses `format_change`.
- R2 becomes "Removal is explicit and listed"; R4 becomes "Defaults publish nothing new, and a release needs a book"; W2 becomes "Only a Scripture Burrito project is ever written"; R9 and R10 lose their non-Scripture-Burrito baseline cases.
- The operation catalog gains `owner.search`, `source.search`, `import.plan`, `import.apply`, and moves `upload.plan` and `upload.apply` to Milestone 1; `convert.plan` and `convert.apply` are dropped; `release.plan` and `release.prepare` carry the selection states and removals.
- The roadmap moves uploads (#45), import (#47, re-scoped from conversion), and Open Bible Stories (#48) into Milestone 1 without moving its date; the Resource Container rehearsal on `bahtraku/id_tb1` becomes an import rehearsal.
- The wizard asks for an owner, a title, an abbreviation, a language, and for Bible a testament scope, and derives the repository name `<language>_<abbreviation>`.
