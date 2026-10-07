# The catalog reads `source.search` makes, 7 October 2026

Public reads on QA for `source.search` (#78, E62), each answer reduced to the fields that bear on it: a search answer to `{ ok, data: [{ repo, branch_or_tag_name, ref_type, stage, commit_sha, released, flavor, metadata_type, ingredients }] }` (`ingredients` its count), a catalog entry to its ref, commit, and `ingredients[]` (`identifier`, `path`, `exists`).

| File | Request (all with `flavor=textTranslation&flavor=textStories`) | Answer |
| --- | --- | --- |
| `search__uw__nostage.json` | `/catalog/search?owner=unfoldingWord&limit=50` | 10 releases, `x-total-count: 10` |
| `search__uw__prod.json` | the same with `stage=prod` | the same 10, each at the same tag and commit |
| `search__uw__prod_l3_p1.json`, `_p2.json` | `stage=prod&limit=3&page=1`, `page=2` | three repositories each, different ones, `x-total-count: 10` |
| `search__uw__prod_p2.json` | `stage=prod&limit=50&page=2` | `{ "ok": true, "data": [] }` |
| `search__none__latest.json` | `owner=zzqxnoowner&stage=latest&limit=50` | `{ "ok": true, "data": [] }`, `x-total-count: 0` |
| `entry__bahtraku__id_gst__gst_master.json`, `__gst_release.json` | `/catalog/entry/bahtraku/id_gst/master`, `/v16` | commits `1609d62c` and `70003541`; the same nine ingredients |
