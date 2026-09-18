# Test against recorded Door43 fixtures; probe live Door43 only to produce evidence

Status: proposed, 18 September 2026; accepted when the pull request that adds it merges

Every Door43 response and archive that tC Admin's logic depends on is recorded once from a real host into `fixtures/door43/`, with its host, ref, date, and the DCS version when known. Unit and contract tests run against those recordings with no credentials and no network. Live probes are separate, explicit scripts that need credentials and a named host; each probe writes its result to the [evidence register](../evidence.md) as a fact with an identifier, and refreshes a fixture when the shape changed. Nothing in the design asserts a fact about Door43, Scripture Burrito, or the pilot repositories without an evidence identifier or an open question identifier.

QA Door43 is reset from production periodically, capacity is one part-time engineer with agent assistance, and the same question about Door43 tends to be asked more than once. Recorded fixtures make the suite deterministic and free to run, an evidence entry stops the next person or agent from probing again, and a recorded fixture is the concrete meaning of "verified" in this repository. The invariant tests in [invariants.md](../invariants.md) depend on fixtures that exercise real formats: the seed repositories in every metadata format are the first recordings.

Fixtures go stale; each carries its date and host, and the probe scripts re-record after a DCS release or a QA reset. The Playwright smoke test remains the one live check in the normal suite.

Consequences: the test harness issue ([#10](https://github.com/unfoldingWord-box3/tc-admin-app/issues/10)) includes the fixture layout and the first recordings; the seed script ([#3](https://github.com/unfoldingWord-box3/tc-admin-app/issues/3)) and every probe issue ([#4](https://github.com/unfoldingWord-box3/tc-admin-app/issues/4), [#5](https://github.com/unfoldingWord-box3/tc-admin-app/issues/5)) close by writing to the evidence register.
