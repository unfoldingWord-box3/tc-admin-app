# Door43 fixtures, qa.door43.org, 7 October 2026

Recorded read-only from public endpoints with no credentials (ADR 0012), for `release.plan` (#33) and the archive client (#18). DCS `1.27.3+dcs.13-g23ba3c3ef9`. The JSON recordings under `repos/` and `catalog/` are stored gzipped (`gunzip -c` reads one; the tests inflate them through `worker/test/support/recorded.ts`), since a catalog entry embeds the whole repository and the set crowded the review bench's packet.

| File | Request |
| --- | --- |
| `repos/<owner>__<repo>.json` | `GET /api/v1/repos/{owner}/{repo}`: the repository with its `catalog` stages (E14), for `bahtraku/Perjanjian-Baru-Pendau`, `bahtraku/id_tb1`, and `tc-admin-qa-org/ums_tcaw2030` (the project the wizard created, E51); anonymous, so `permissions` is `pull` only |
| `repos/<owner>__<repo>__git-trees__<ref>.json` | `GET /api/v1/repos/{owner}/{repo}/git/trees/{commit sha}?recursive=true&per_page=1000&page=1`, the tree at the commit the stage names, for `master` and the latest full release (`v1.2`, `1974`) |
| `repos/bahtraku__Perjanjian-Baru-Pendau__git-trees__master__per_page=10__page=2.json` | the same with `per_page=10&page=2`: a page that is not the last, `truncated: true` |
| `catalog/entry__<owner>__<repo>__<ref>.json` | `GET /api/v1/catalog/entry/{owner}/{repo}/{ref}` (E20), for the same refs by name |
| `sb-archives/birch__es-419_tit_text_reg__master.zip`, `birch__en_web_mrk_book__master.zip` | `GET /api/v1/repos/{owner}/{repo}/sb/master.zip` (E34): the translationStudio and translationCore archives of E1, with the file list (`unzip -Z1`) and `metadata.json` extracted beside each (E53) |

The facts derived are E52 and E53 in `docs/evidence.md`. Pendau's `master` and `v1.2` are the same commit, so a plan on it groups every book unchanged; a changed and added pair is synthetic in `worker/test/operations/release-plan.test.ts`.
