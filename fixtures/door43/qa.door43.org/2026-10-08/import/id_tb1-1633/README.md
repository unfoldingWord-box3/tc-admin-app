# The import rehearsal on QA, 8 October 2026

`scripts/probe/qa-import-probe.mjs` run with `TEST_TOKEN` as `tc-admin-qa` (ADR 0012, #80): `import.plan` and `import.apply` through the Worker's own operation code, bundled with esbuild, importing Genesis and Exodus from `bahtraku/id_tb1` at its release `1974` (a Resource Container Bible, E1, E17) into a New Testament Bible project the probe created first, `tc-admin-qa/id_tcai1633`, as the wizard creates one (`project.create.plan`, `project.create.apply`). DCS `28.1.0+423-gbb3a0efeb6`. The facts derived are E69 in `docs/evidence.md`.

| File | What it holds |
| --- | --- |
| `01` to `06` | the project's creation: the account, the free name (404), `POST /user/repos` (201), the first commit (201) at `64611358` |
| `07` to `14` | `import.plan`'s reads: the account, the project, the source repository, its release `1974` by tag, the project's branch head, its archive and tree at `64611358`, and the source's archive at `1974` (zip bodies replaced by a note) |
| `plan.json` | the plan: both books new, their sizes and md5s, the one `source` relationship, bound to `64611358` |
| `15` to `20` | `import.apply`: the account, the source's archive again at `1974`, the project, its branch head and tree (unchanged), and the one `POST /contents` on `master` (201; the request body replaced by a note) |
| `receipt.json` | the receipt: one commit `a1c91812`, the project report with coverage from the committed metadata |
| `21` | the same plan id applied again: the account read, nothing else, the stored receipt answered |
| `22-GET-commit.json` | the commit, re-read publicly: parent `64611358`, `ingredients/EXO.usfm` and `ingredients/GEN.usfm` added, `metadata.json` modified, author and committer `tc-admin-qa` |
| `23-GET-raw-metadata.json`, `metadata-after.json` | the committed `metadata.json`: the two books with the size and md5 of their bytes, `relationships` with the one `source` entry, `idAuthorities.dcs` |
| `24-GET-branches.json` | `master` only |
| `25-health-master.json` | the health check after the commit: `info`, the `release_needed` note only, answered on the first poll |
| `26-GET-catalog_entry_master.json` | the catalog entry: `is_valid: true`, `healthcheck_severity: info`, books `exo` and `gen` |
| `summary.json` | the run's summary |

Every `authorization` header is `token [redacted]` and every `email` is `[redacted]`. Nothing was written to `bahtraku/id_tb1`: every request to it is a `GET`.
