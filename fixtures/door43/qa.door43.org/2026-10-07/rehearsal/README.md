# The QA rehearsal of the Milestone 1 demo, 7 October 2026

Public re-reads of Door43 QA after each write of the QA rehearsal (#43) of `docs/demo-script.md`, driven in Chrome against the deployed QA Worker `https://tc-admin-qa.unfoldingword.workers.dev` (version `b69d0815`, deployed from `main` at `ad09818`), signed in as `tc-admin-qa` (E58). Every read is anonymous; every `email` is redacted. Times are UTC.

Book A and book B are QA stand-ins, not the demo's books: Titus (A) and Philemon (B), each revised on `master` by one `\rem` line before the run (`00-seeded`), since `master` was `v1.2`'s commit on both hosts (E52, E58).

| Step | Directory | What it holds |
| --- | --- | --- |
| Seed | `00-seeded/` | the two commits on `master` by `tc-admin-qa`: `80699fa0` (Titus), `6f9dfea3` (Philemon), each one file |
| Rehearsal: prepare book A | `01-prepared/` | `temp-tca-release/v1.2.1` at `40ff914a`, one commit from `v1.2`'s `2d9dbd1e` changing `ingredients/TIT.usfm` and `metadata.json`; the branch's `metadata.json` (gzipped); its health: `warning`, the Acts title only |
| Rehearsal: the pre-release | `02-prerelease/` | `v1.2.1` a pre-release on `40ff914a`; `master` the only branch; `catalog.prod` still `v1.2`; health on the tag `warning` |
| Demo 2: promoted | `03-promoted/` | `v1.2.1` a full release; `catalog.prod` on `v1.2.1` |
| Demo 4: prepare book B | `04-prepared-b/` | `temp-tca-release/v1.2.2` at `efabd06f`, one commit from `40ff914a` changing `ingredients/PHM.usfm` and `metadata.json`; its `metadata.json` (gzipped), identical to the released `v1.2.2`'s; health `warning` |
| Demo 7: the pre-release | `05-prerelease-b/` | `v1.2.2` a pre-release on `efabd06f`, its notes with the line the presenter added; `master` the only branch |
| Demo 8: promoted | `06-promoted-b/` | `v1.2.2` a full release; `catalog.prod` on `v1.2.2` |
| S8: a book left out | `07-removal/` | `v2.0.0` a full release on `3a4c3ded`, one commit from `efabd06f` removing `ingredients/3JN.usfm` and modifying `metadata.json`; its `metadata.json` (gzipped): 29 ingredients, `currentScope` 26 books, no 3 John; every release in full (`releases-full.json.gz`) |
| Demo 9: the project | `08-created/` | `tc-admin-qa-org/id_demo1016`: `metadata_type: sb`, health `info` with `release_needed` only, `master` only, the committed `metadata.json` |

The directory numbers do not follow the run: step 9 (`08-created`, its commit at 20:21:16) ran before S8 (`07-removal`, its release at 20:22:17), in the script's order, as E58 tells it.

`releases.json` in each step keeps each release's tag, flag, target, creation time, author, and notes; the full answer is kept once, at the end. Duplicate copies of an unchanged `metadata.json` were not kept.
