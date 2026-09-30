# Door43 fixtures, qa.door43.org, 30 September 2026

Recorded read-only from public endpoints with no credentials (ADR 0012). DCS version `1.27.3+dcs.13-g23ba3c3ef9` (`version.json`, `GET /api/v1/version`), newer than the `dcs.6` build the 21 September fixtures came from.

| File | Request |
| --- | --- |
| `search/bahtraku__Perjanjian-Baru-Pendau.json` | `GET /api/v1/repos/search?owner=bahtraku&q=Perjanjian-Baru-Pendau&limit=50` |
| `search/bahtraku__id_tb1.json` | `GET /api/v1/repos/search?owner=bahtraku&q=id_tb1&limit=50` |
| `catalog/list__subjects.json` | `GET /api/v1/catalog/list/subjects` |
| `version.json` | `GET /api/v1/version` |

Facts derived from these recordings are E32 and E33 in `docs/evidence.md`. The search items are read by `worker/test/contract/project-catalog.test.ts`.
