# Door43's Open Bible Stories health checks, 7 October 2026

The health check of `tc-admin-qa-org/id_obs1948` on QA after Rich added Door43's Open Bible Stories checks the same evening (E60).

| File | Ref | What Door43 answered |
| --- | --- | --- |
| `healthcheck-master.json` | `master` (three stories, listed in `metadata.json`) | `error`: `obs_story_missing`, stories 04 to 50; `info`: `release_needed` |
| `healthcheck-v1.0.0.json` | `v1.0.0` (the release of E59) | `error`: `obs_story_missing`, stories 04 to 50 |
| `metadata-unlisted-snapshot.json`, `commit-unlisted-snapshot.json` | `temp-tca-release/v1.1.0` (E59's second run, with story 04 on `master` unlisted; the branch was discarded after the reads) | the snapshot's `metadata.json`: stories 01 to 03 and the license, no entry for 04; its one commit modified `metadata.json` only |
| `healthcheck-unlisted-story.json` | `probe/unlisted-story`, a branch adding `ingredients/content/04.md` without an ingredient entry (commit `26ac0eda`, branch deleted after the read) | `error`: `obs_story_missing`, stories 05 to 50: the unlisted story counted as present, and no other issue (Q32) |
| `healthcheck-master-after-q32.json`, `healthcheck-q32-recheck.json` | `master` (story 04 unlisted, `02.md` one byte longer than listed), and `probe/q32-recheck` at the same commit (deleted after the read), after Rich deployed the metadata check (Q32) | `error`: two `obs_story_missing` entries, stories 05 to 50 missing and story 04 not listed in the ingredients; `warning`: `sb_ingredient_mismatch` for `02.md` |
| `healthcheck-v1.0.0-after-q32.json` | `v1.0.0`, after the same deployment | `error`: `obs_story_missing`, stories 04 to 50 |
| `healthcheck-all50-one-unlisted.json` | `probe/q32-all50` (commit `59014b5c`): all 50 story files, `metadata.json` listing 49, story 04 unlisted (deleted after the read) | `error`: `obs_story_missing`, story 04 not listed in the ingredients, and nothing else |
