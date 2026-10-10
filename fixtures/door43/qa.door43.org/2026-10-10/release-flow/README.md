# Door43 fixtures, qa.door43.org, 10 October 2026: the release flow on a project on main

`tc-admin-qa-org/` was recorded by `node --env-file=.env scripts/probe/qa-release-probe.mjs --owner tc-admin-qa-org`, which runs the Worker's own operation code (bundled with esbuild) against QA with `TEST_TOKEN` standing in for the session's token, as on 7 October 2026 (E54). The code is #170's: a repository's default branch is the `default_branch` Door43 answers for it, and the catalog's `latest` stage gives its head only when it names that branch. DCS `28.1.0+dcs.19-g41cde8ce33`. Every Door43 request the operations made is one numbered file in the usual request and response wrapper, the token and every email redacted.

| Phase | Files | What happened |
| --- | --- | --- |
| seed | `01`–`11`, `seed-receipt.json` | `project.create.plan` and `project.create.apply` created `tc-admin-qa-org/id_tcar0228` on `main` (#167); one `POST /contents` on `main` (`11`) added MAT and JHN from `bahtraku/Perjanjian-Baru-Pendau`, read from that repository's own `default_branch`, `master` |
| first release | to `33`, `release-plan-1.json` to `release-promote-1.json` | both books `new` and included, `v1.0.0`; prepared "from main at c9acaba290"; created as a pre-release, then promoted |
| second release | `34`–`57`, `release-plan-2.json` to `release-create-2.json` | one `POST /contents` on `main` revising MAT and adding MRK (`34`); released as `v1.1.0`, prepared "from main at a7cf701557" |
| discard | `58`–`75`, `release-plan-3.json`, `release-prepare-3.json`, `preparation-discard-3.json` | `v1.1.1` prepared, then discarded: one `DELETE` of its branch (`74`, 204); `GET /branches` lists `main` only (`75`) |

`summary.json` holds the per-phase results. The facts derived are E81 in `docs/evidence.md`.
