# Door43 fixtures, qa.door43.org, 6 October 2026

Recorded by `node --env-file=.env scripts/probe/qa-create-probe.mjs` (#30, ADR 0012) run in the `tc-admin-qa` user's own namespace with the API token Rich reissued with `write:user` (E23, Q28); the token is redacted in every file as `token [redacted]` and the account's email as `[redacted]`. DCS `1.27.3+dcs.13-g23ba3c3ef9`.

| Folder | Run | Result |
| --- | --- | --- |
| `project-create/tc-admin-qa/` | a Bible project titled `tC Admin probe 2026-10-06 0633`, abbreviation `tcap0633`, language `id`, New Testament scope, owner `tc-admin-qa` | `POST /user/repos` 201 (step 05), one commit of `metadata.json`, `ingredients/license.md`, `README.md` (step 06), health `info` with only `release_needed` after 5.4 s (step 07), the catalog view and entry (steps 08, 09); `plan.json`, `receipt.json`, and `metadata.json` (the file as committed); repository `tc-admin-qa/id_tcap0633` kept for inspection |

The fact derived is E49 in `docs/evidence.md`. The same creation refused the day before, with the token as it then was, is `../2026-10-05/project-create/tc-admin-qa-refused/` (E45).
