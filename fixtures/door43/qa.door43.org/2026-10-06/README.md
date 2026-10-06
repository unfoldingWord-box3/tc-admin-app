# Door43 fixtures, qa.door43.org, 6 October 2026

`project-create/` was recorded by `node --env-file=.env scripts/probe/qa-create-probe.mjs` (#30, ADR 0012) run in the `tc-admin-qa` user's own namespace with the API token Rich reissued with `write:user` (E23, Q28); the token is redacted in every file as `token [redacted]` and the account's email as `[redacted]`. `languages/` and `wizard-create/` were recorded read-only from public endpoints with no credentials (#28). DCS `1.27.3+dcs.13-g23ba3c3ef9`.

| Folder | Run | Result |
| --- | --- | --- |
| `project-create/tc-admin-qa/` | a Bible project titled `tC Admin probe 2026-10-06 0633`, abbreviation `tcap0633`, language `id`, New Testament scope, owner `tc-admin-qa` | `POST /user/repos` 201 (step 05), one commit of `metadata.json`, `ingredients/license.md`, `README.md` (step 06), health `info` with only `release_needed` after 5.4 s (step 07), the catalog view and entry (steps 08, 09); `plan.json`, `receipt.json`, and `metadata.json` (the file as committed); repository `tc-admin-qa/id_tcap0633` kept for inspection |
| `project-create/tc-admin-qa-flavor/` | the same with `--project-type daughter --translation-type revision --audience literary --out tc-admin-qa-flavor` (#28): title `tC Admin probe 2026-10-06 2014`, abbreviation `tcaf2014` | the same steps; the committed `metadata.json` carries the three values; health `info` with only `release_needed` after 5.5 s; repository `tc-admin-qa/id_tcaf2014` kept for inspection |

| File | Request |
| --- | --- |
| `languages/langnames.json.gz` | `GET /api/v1/languages/langnames.json`: the full language list, 9,166 entries, in the usual request and response wrapper, gzipped (1.5 MB and nine thousand lines plain); `gunzip -c` reads it, as the tests do |
| `languages/catalog__list__languages__owner=tc-admin-qa-org__stage=latest.json` | `GET /api/v1/catalog/list/languages?owner=tc-admin-qa-org&stage=latest`: one language, `id` |
| `languages/catalog__list__languages__owner=bahtraku__stage=latest.json` | the same for `bahtraku`: 37 languages |
| `languages/catalog__list__languages__owner=no-such-owner-xyz__stage=latest.json` | the same for an owner Door43 does not know: `{ ok: true, data: null }` |
| `wizard-create/01-GET-repos_catalog-view.json`, `02-GET-catalog_entry_master.json`, `03-health-master.json`, `04-GET-commits.json`, `metadata.json` | the public re-reads of `tc-admin-qa-org/ums_tcaw2030`, the Bible the creation wizard created from the browser through `wrangler dev` (E51): the repository view, the catalog entry for `master`, the health result, the commits, and the committed `metadata.json` (`GET /tc-admin-qa-org/ums_tcaw2030/raw/branch/master/metadata.json`) |

The facts derived are E49 (the user's namespace), E50 (the translation details), E51 (the wizard from the browser), and the 6 October re-read of E25 (the language lists) in `docs/evidence.md`. The same creation refused the day before, with the token as it then was, is `../2026-10-05/project-create/tc-admin-qa-refused/` (E45).
