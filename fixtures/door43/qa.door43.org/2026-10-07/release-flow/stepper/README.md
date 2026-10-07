# The release stepper from the browser, 7 October 2026

Public re-reads of `tc-admin-qa/id_tcar1546` after the release stepper (`web/src/ReleaseStepper.tsx`) was driven in Chrome through `wrangler dev` on `http://127.0.0.1:8787`, signed in as `tc-admin-qa` on QA (E56): the stepper left Mark out of a release of Matthew and John, prepared `temp-tca-release/v2.0.0`, polled the health to `healthy`, created `v2.0.0` as a pre-release, promoted it, then prepared `v2.0.1` with the defaults and discarded it.

| File | Request |
| --- | --- |
| `01-GET-releases_tags_v2.0.0.json` | the release: a full release after the promotion, targeting the snapshot commit |
| `02-GET-git_trees_v2.0.0.json` | its tree: Matthew, John, the license, the README, `metadata.json`; no Mark |
| `metadata-v2.0.0.json` | the released `metadata.json`: exactly those ingredients, `currentScope` Matthew and John |
| `03-GET-healthcheck_v2.0.0.json` | the tag's health: `success` |
| `04-GET-branches.json` | `master` only, after the release's branch deletion and the discard |
| `05-GET-repos.json` | the catalog view: `prod` on `v2.0.0` |

Every `email` is redacted. The one failure on the way, Door43's `null` for a deleted file in a commit's answer, is recorded with its fix on #103 (`fixtures/door43/qa.door43.org/2026-10-07/contents-delete/`).
