# Door43 fixtures, git.door43.org, 5 October 2026

Recorded read-only from a public raw-file route with no credentials (ADR 0012). Production was read, not written.

| File | Request |
| --- | --- |
| `raw/MyOrg__en_obs__main__metadata.json` | `GET https://git.door43.org/MyOrg/en_obs/raw/branch/main/metadata.json`: the `metadata.json` Gateway Admin's conversion wrote to the `main` branch of a new Open Bible Stories repository (`go-rc2sb v0.5.0`), with no story yet and the full Open Bible Stories `currentScope`; the repository's default branch `master` is Resource Container |

The fact derived is E46 in `docs/evidence.md`: the scope tC Admin writes for every Open Bible Stories project (`worker/src/model/obs-scope.ts`) is this one. Nothing else of the file is reused; tC Admin's own generator and version go into what it writes.
