# Door43 fixtures, qa.door43.org, 5 October 2026

Recorded read-only from public endpoints with no credentials (ADR 0012).

| File | Request |
| --- | --- |
| `search/flavor-and-subject-by-metadata-type.json` | `GET /api/v1/repos/search?limit=50&metadataType=<type>&page=<n>` for `sb` (every page, 22), `rc`, `ts`, and `tc` (ten pages each), tallied by `flavor_type`, `flavor`, and `subject` with Door43's `x-total-count`; and `metadataType=sb&subject=<Bible, Aligned Bible, Open Bible Stories>`, page 1 |

The fact derived from this recording is E42 in `docs/evidence.md`.
