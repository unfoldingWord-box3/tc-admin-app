# Project creation on the default branch main, qa.door43.org, 10 October 2026

Recorded by `node --env-file=.env scripts/probe/qa-create-probe.mjs --owner tc-admin-qa-org --out tc-admin-qa-org-main` (#167, ADR 0012), which bundles `worker/src/operations/` with esbuild and runs `project.create.plan` and `project.create.apply` against QA with the `tc-admin-qa` user's token as the session's token (redacted in every file as `token [redacted]`). DCS `28.1.0+dcs.19-g41cde8ce33`. Inputs: a Bible project titled `tC Admin probe 2026-10-10 0118`, abbreviation `tcap0118`, language `id` Bahasa Indonesia (`ltr`), New Testament scope, CC BY-SA 4.0. The date is UTC.

Each `NN-<METHOD>-<path>.json` holds one Door43 request the operations made (headers redacted, the first-commit body replaced by a note) and its response. `plan.json` is the plan returned, `metadata.json` the generated file exactly as committed, `receipt.json` the receipt, `summary.json` the run.

| Run | Owner | Result |
| --- | --- | --- |
| `tc-admin-qa-org-main/` | the organization (`POST /orgs/{org}/repos`) | the plan named the commit `@main`; repository `tc-admin-qa-org/id_tcap0118` created with `default_branch: main` and answered `default_branch: main`, `empty: true` (step 09, 201); one commit of `metadata.json`, `ingredients/license.md`, `README.md` (step 10, 201, `d0ece3e6`); health on `main` `info` with only `release_needed` after 5.5 s (step 11); the repository view says `default_branch: main` and the catalog entry for `main` is valid Scripture Burrito (steps 12, 13); `14-GET-repos_branches.json`, a public read after the run kept to each branch's name and commit, lists `main` alone; the repository is kept for inspection |

The fact derived is E79 in `docs/evidence.md`.
