# Door43 fixtures, qa.door43.org, 1 October 2026

Recorded read-only from public endpoints with no credentials (ADR 0012). DCS version `1.27.3+dcs+13-g23ba3c3ef9` (from the swagger `info.version`).

| File | Request |
| --- | --- |
| `swagger/paths__sb-archive__catalog-search__owners.json` | the `info` block and four paths excerpted from `GET /swagger.v1.json`: `/repos/{owner}/{repo}/sb/{archive}`, `/repos/{owner}/{repo}/archive/{archive}`, `/catalog/list/owners`, `/catalog/search` |
| `catalog/list__owners__unfold__partialMatch.json` | `GET /api/v1/catalog/list/owners?stage=latest&limit=50&owner=unfold&partialMatch=1` |
| `catalog/search__owner=unfoldingWord__flavor=textTranslation,textStories.json` | `GET /api/v1/catalog/search?owner=unfoldingWord&flavor=textTranslation&flavor=textStories&limit=50` |
| `catalog/search__owner=bahtraku__flavor=textTranslation,textStories__stage=latest.json` | `GET /api/v1/catalog/search?owner=bahtraku&flavor=textTranslation&flavor=textStories&stage=latest&limit=50` |
| `catalog/metadata__unfoldingWord__en_obs__v9.json` | `GET /api/v1/catalog/metadata/unfoldingWord/en_obs/v9` (returns the Resource Container manifest, E20) |
| `sb-archives/unfoldingWord__en_obs__v9.zip`, `.files.txt`, `.metadata.json` | `GET /unfoldingWord/en_obs/sb/v9.zip` (web route; the API route is E34), its file list, and its `metadata.json` |

Facts derived from these recordings are E34, E35, and E36 in `docs/evidence.md`; the E20 caveat comes from the catalog metadata file.
