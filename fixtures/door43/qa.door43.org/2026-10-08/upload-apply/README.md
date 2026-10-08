# `upload.apply` live on QA, 8 October 2026

Two books uploaded from the upload screen (#76, stacked on #75) through `wrangler dev` against QA, signed in as `tc-admin-qa`, to `tc-admin-qa/id_tcar1546` (the test account's own namespace): `LUK.usfm` (166,834 bytes) and `ACT.usfm` (159,318 bytes), copied from `bahtraku/Perjanjian-Baru-Pendau`'s `master` (E68). Public re-reads after the commit; every `email` redacted.

| File | What it holds |
| --- | --- |
| `branch-master.json` | `GET /branches/master`: the head `da76985e` |
| `commit.json` | the commit: parent `8e3fcd0a` (the head the plan was bound to), author and committer `tc-admin-qa`, `ingredients/LUK.usfm` and `ingredients/ACT.usfm` added, `metadata.json` modified, nothing else |
| `metadata-after.json` | `metadata.json` at `master` after the commit: LUK and ACT listed with the size and md5 of their bytes |
| `healthcheck-master.json` | the health of `master` after the commit: `warning`, `ingredient_title_is_en` |
