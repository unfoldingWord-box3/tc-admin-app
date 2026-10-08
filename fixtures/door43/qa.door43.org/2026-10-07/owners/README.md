# The owner reads `owner.search` makes, 7 October 2026

Reads on QA with `TEST_TOKEN` (the `tc-admin-qa` account), recorded for `owner.search` (#77, E61). Every `email` is redacted; the catalog's long answer is reduced to the fields the adapter reads.

| File | Request | Answer |
| --- | --- | --- |
| `user-orgs__page1.json` | `GET /user/orgs?page=1&limit=50` | 200, `x-total-count: 2`: `bahtraku` (Yayasan BahtraKu) and `tc-admin-qa-org` |
| `user-orgs__page2.json` | `GET /user/orgs?page=2&limit=50` | 200, `[]`, `x-total-count: 2` |
| `list-owners__nomatch.json` | `GET /catalog/list/owners?owner=zzqxnomatch&partialMatch=1&stage=latest&limit=50` | 200, `{ "ok": true, "data": null }`, `x-total-count: 0` |
| `list-owners__a__partialMatch__login-fullname.json.gz` | `GET /catalog/list/owners?owner=a&partialMatch=1&stage=latest`, with `limit=10`, `limit=50`, and `limit=10&page=2` | 200, the same 1,656 owners each time, `x-total-count: 1656`; kept as `{ ok, data: [{ login, full_name }] }` |
