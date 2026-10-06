# Project creation through the Worker's own code, qa.door43.org, 5 October 2026

Recorded by `node --env-file=.env scripts/probe/qa-create-probe.mjs` (#30, ADR 0012), which bundles `worker/src/operations/` with esbuild and runs `project.create.plan` and `project.create.apply` against QA with the `tc-admin-qa` user's token as the session's token (redacted in every file as `token [redacted]`; the account's email address is redacted too). DCS `1.27.3+dcs.13-g23ba3c3ef9`. Inputs: a Bible project titled `tC Admin probe 2026-10-05 1856`, abbreviation `tcap1856`, language `id` Bahasa Indonesia (`ltr`), New Testament scope, CC BY-SA 4.0.

Each `NN-<METHOD>-<path>.json` holds one Door43 request the operations made (headers redacted, the first-commit body replaced by a note) and its response. `plan.json` is the plan returned, `metadata.json` the generated file exactly as committed (the Q4 fixture), `receipt.json` the receipt, `summary.json` the run.

| Run | Owner | Result |
| --- | --- | --- |
| `tc-admin-qa/` | the user's own namespace (`POST /user/repos`) | the plan succeeded; the apply was refused with 403 `required=[write:user]` (step 05) and answered `permission_denied`, writing nothing (E26, Q28) |
| `tc-admin-qa-org/` | the organization (`POST /orgs/{org}/repos`) | repository `tc-admin-qa-org/id_tcap1856` created (step 07, 201), one commit of `metadata.json`, `ingredients/license.md`, `README.md` (step 08, 201), health `info` with only `release_needed` after 10.9 s (step 09), the catalog view and entry (steps 10, 11); the repository is kept for inspection |
| `tc-admin-qa-org-obs/` | the organization, `--type obs`: an Open Bible Stories project titled `tC Admin probe OBS 2026-10-05 1948`, abbreviation `obs1948`, no testament scope | repository `tc-admin-qa-org/id_obs1948` created (step 07), one commit (step 08), health `info` with only `release_needed` after 5.5 s (step 09), read as `gloss/textStories`, subject Open Bible Stories (steps 10, 11); kept for inspection |

The facts derived are E45 (the Bible) and E47 (Open Bible Stories), and the 5 October entries under Q4 and Q28 in `docs/evidence.md`.
