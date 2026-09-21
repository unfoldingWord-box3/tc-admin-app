# Door43 fixtures, qa.door43.org, 21 September 2026

Recorded read-only from public endpoints with no credentials (ADR 0012). DCS version `1.27.3+dcs.6-ga7ba9b25c1` (`GET /api/v1/version`). Production reported `1.27.3+dcs` the same day and identical catalog data for the Pendau repository.

| File | Request |
| --- | --- |
| `repos/<owner>__<repo>.json` | `GET /api/v1/repos/{owner}/{repo}` |
| `repos/bahtraku__id_tb1__git-trees__master.json` | `GET /api/v1/repos/bahtraku/id_tb1/git/trees/master?recursive=true&per_page=1000` |
| `releases/<owner>__<repo>.json` | `GET /api/v1/repos/{owner}/{repo}/releases?limit=50` |
| `releases/<owner>__<repo>__tags__<tag>.json` | `GET /api/v1/repos/{owner}/{repo}/releases/tags/{tag}` |
| `healthcheck/<owner>__<repo>__<ref>.json` | `GET /api/v1/repos/{owner}/{repo}/healthcheck?ref={ref}` |
| `catalog/metadata__<owner>__<repo>__<ref>.json` | `GET /api/v1/catalog/metadata/{owner}/{repo}/{ref}` |
| `catalog/entry__<owner>__<repo>__<ref>.json` | `GET /api/v1/catalog/entry/{owner}/{repo}/{ref}` |
| `catalog/list__metadata-types.json` | `GET /api/v1/catalog/list/metadata-types` |
| `sb-archives/<owner>__<repo>__<ref>.zip` | `GET /{owner}/{repo}/sb/{ref}.zip` (web route) |
| `sb-archives/*.files.txt`, `*.metadata.json` | file list and `metadata.json` extracted from the archive beside it |

Facts derived from these recordings are E13 to E22 in `docs/evidence.md`. Re-record after a QA reset or a DCS release; the layout is provisional until #10 fixes it.
