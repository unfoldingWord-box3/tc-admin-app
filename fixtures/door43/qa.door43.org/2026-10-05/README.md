# Door43 fixtures, qa.door43.org, 5 October 2026

Recorded read-only (ADR 0012): `search/` from public endpoints with no credentials; `user/` with the `tc-admin-qa` user's token (redacted in every file as `token [redacted]`; the account's email address is redacted too). DCS `1.27.3+dcs.13-g23ba3c3ef9`, after the Monday reset from production.

| File | Request |
| --- | --- |
| `search/flavor-and-subject-by-metadata-type.json` | `GET /api/v1/repos/search?limit=50&metadataType=<type>&page=<n>` for `sb` (every page, 22), `rc`, `ts`, and `tc` (ten pages each), tallied by `flavor_type`, `flavor`, and `subject` with Door43's `x-total-count`; and `metadataType=sb&subject=<Bible, Aligned Bible, Open Bible Stories>`, page 1 |
| `user/user.json` | `GET /api/v1/user`: the test user after the reset |
| `user/user__teams.json` | `GET /api/v1/user/teams`: the account's teams with `can_create_org_repo` and `permission`, the repository-creation check (E43) |
| `user/user__orgs.json` | `GET /api/v1/user/orgs`: the account's organizations |

The facts derived from these recordings are E42 and E43 in `docs/evidence.md`.
