# QA write probe, 22 September 2026

Recorded by `scripts/probe/qa-write-probe.mjs` run by Rich against qa.door43.org with the `tc-admin-qa` token (redacted in every file as `token [redacted]`). Repository created: `tc-admin-qa-org/tca-probe-20260922194921`, kept for inspection.

Each `NN-<step>.json` holds the request (headers redacted, large bodies elided) and the response; the `health-*` files also hold the full poll `sequence` with timings. `02-create-repo.json` is the earlier run's 403 (`write:user` needed for the user namespace, E26); `02-org-lookup.json` onward is the successful run. `19-size-commit.json` failed for a probe bug (`create` on existing files), not for size; Q13 is rerun with `--size-only`.

Facts derived: E26, E27, E28, E29 in `docs/evidence.md`.
