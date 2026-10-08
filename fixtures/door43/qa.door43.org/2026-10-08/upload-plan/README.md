# `upload.plan` live on QA, 8 October 2026

The answer of `POST /api/projects/tc-admin-qa-org/id_obs1948/uploads/plan`, multipart, sent from the page through `wrangler dev` on the #74 branch (`http://127.0.0.1:8787`), signed in as `tc-admin-qa`, against QA (E64). Nothing was written to Door43: a plan only reads.

| Part | File |
| --- | --- |
| `files.0` | `05.md`: story 5, copied from `bahtraku/id_obs` (`content/05.md`), 3,839 bytes |
| `files.1` | `04.md`: the bytes of `ingredients/content/04.md` on `master` (unlisted in its `metadata.json`), 3,597 bytes |
| `files.2` | `notes.txt`: `probe notes\n`, 12 bytes |

`upload-plan__id_obs1948.json` is the whole answer, re-indented. Both md5s match the bytes Door43 serves for those files.
