# Door43's Open Bible Stories health checks, 7 October 2026

The health check of `tc-admin-qa-org/id_obs1948` on QA after Rich added Door43's Open Bible Stories checks the same evening (E60).

| File | Ref | What Door43 answered |
| --- | --- | --- |
| `healthcheck-master.json` | `master` (three stories, listed in `metadata.json`) | `error`: `obs_story_missing`, stories 04 to 50; `info`: `release_needed` |
| `healthcheck-v1.0.0.json` | `v1.0.0` (the release of E59) | `error`: `obs_story_missing`, stories 04 to 50 |
| `metadata-unlisted-snapshot.json`, `commit-unlisted-snapshot.json` | `temp-tca-release/v1.1.0` (E59's second run, with story 04 on `master` unlisted; the branch was discarded after the reads) | the snapshot's `metadata.json`: stories 01 to 03 and the license, no entry for 04; its one commit modified `metadata.json` only |
| `healthcheck-unlisted-story.json` | `probe/unlisted-story`, a branch adding `ingredients/content/04.md` without an ingredient entry (commit `26ac0eda`, branch deleted after the read) | `error`: `obs_story_missing`, stories 05 to 50: the unlisted story counted as present, and no other issue (Q32) |
