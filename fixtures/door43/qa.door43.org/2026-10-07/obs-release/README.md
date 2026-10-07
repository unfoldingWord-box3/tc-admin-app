# An Open Bible Stories release from the stepper, 7 October 2026

Public re-reads of `tc-admin-qa-org/id_obs1948` on QA after the release stepper, run through `wrangler dev` from the #84 branch and signed in as `tc-admin-qa`, released it as `v1.0.0` (E59). Before the run, the project held README, license, and `metadata.json`; `tc-admin-qa` then committed three stories copied from `bahtraku/id_obs` (`ingredients/content/01.md` to `03.md`, commit `6beaeaba`) and a `metadata.json` listing them with their sizes, md5s, and `unfoldingWord/en_obs` v9's scopes (commit `5b1e85b9`).

| File | What it holds |
| --- | --- |
| `releases.json` | `v1.0.0`, a full release on `c8b45d2a` |
| `commit-release.json` | the snapshot commit: parent `5b1e85b9`, the default-branch head; `metadata.json` modified, nothing else |
| `tree-master.json`, `tree-v1.0.0.json` | the two trees: the three stories with the same blob SHAs |
| `metadata-v1.0.0.json` | the released `metadata.json`: the three stories and the license, each with the size and md5 of its bytes |
| `healthcheck-v1.0.0.json` | the tag's health at release time: `success`, before Door43's Open Bible Stories checks (E60) |
| `branches.json` | `master` only |
| `repo.json` | `catalog.prod` on `v1.0.0` |

Every `email` is redacted.
