# tC Admin Traceability

Status: living document; started 18 September 2026
Audience: anyone picking up an issue or reviewing a pull request

One row per issue, linking it to the specification section it satisfies, the decisions it depends on, the invariants it must uphold, the evidence and open questions it rests on, the operations it implements, and the layer it lives in. Scenario ids are the acceptance scenarios in [product-spec.md](product-spec.md) §13. Layer names are the module map in [architecture.md](architecture.md) §10.

Keep this file current: an issue's Traceability section and its row here say the same thing. When they differ, the issue is wrong.

## Milestone 1 — Release

### EPIC: Environments and Door43 setup ([#6](https://github.com/unfoldingWord-box3/tc-admin-app/issues/6))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#1](https://github.com/unfoldingWord-box3/tc-admin-app/issues/1) tc-admin-qa organization | roadmap M1 | — | — | E9 | — | environment | — |
| [#2](https://github.com/unfoldingWord-box3/tc-admin-app/issues/2) OAuth applications | §2 | 0001 | A1 | Q9, Q10 | `situation.read` | door43/auth | — |
| [#3](https://github.com/unfoldingWord-box3/tc-admin-app/issues/3) QA seed script | roadmap M1 | 0012 | — | E1, E9 | — | scripts | — |
| [#4](https://github.com/unfoldingWord-box3/tc-admin-app/issues/4) OAuth survives reset | §2 | 0001 | A1 | Q9 | — | runbook | — |
| [#5](https://github.com/unfoldingWord-box3/tc-admin-app/issues/5) Health latency | §9 | 0007 | H2 | Q2 | `preparation.read` | door43/health | — |

### EPIC: Application foundation ([#11](https://github.com/unfoldingWord-box3/tc-admin-app/issues/11))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#7](https://github.com/unfoldingWord-box3/tc-admin-app/issues/7) Scaffold web/ worker/ shared/ | arch §1, §10 | 0011, 0012 | — | — | all (schemas) | every layer | — |
| [#8](https://github.com/unfoldingWord-box3/tc-admin-app/issues/8) Design system | §5 | — | H4 | — | — | web | — |
| [#9](https://github.com/unfoldingWord-box3/tc-admin-app/issues/9) Deploy to workers.dev | arch §9 | 0001 | A1 | — | — | worker/http, wrangler | — |
| [#10](https://github.com/unfoldingWord-box3/tc-admin-app/issues/10) Test harness and fixtures | arch §10 | 0012 | all (test naming) | E1–E5, E7 | — | test, fixtures | — |

### EPIC: Sign-in and session ([#16](https://github.com/unfoldingWord-box3/tc-admin-app/issues/16))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#12](https://github.com/unfoldingWord-box3/tc-admin-app/issues/12) Code exchange | §2; arch §3 | 0001 | A1, A3 | E8, Q10 | `situation.read` | door43/auth, http/session | — |
| [#13](https://github.com/unfoldingWord-box3/tc-admin-app/issues/13) CSRF and origin | arch §8 | — | A4 | — | every apply | http | — |
| [#14](https://github.com/unfoldingWord-box3/tc-admin-app/issues/14) Live permission re-check | §2; arch §3 | — | A2, P2 | E7 | every apply (precondition) | operations | — |
| [#15](https://github.com/unfoldingWord-box3/tc-admin-app/issues/15) Expired session | §11 `session_expired` | 0001 | A1, X2 | — | error catalog | http, web | — |

### EPIC: Project model ([#22](https://github.com/unfoldingWord-box3/tc-admin-app/issues/22))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#17](https://github.com/unfoldingWord-box3/tc-admin-app/issues/17) Scripture Burrito reader | §7; domain §8 | 0008 | W1, R10 | E2, Q4 | `project.read` | model/burrito | — |
| [#18](https://github.com/unfoldingWord-box3/tc-admin-app/issues/18) Archive client | arch §3 | 0008, 0010 | R3, R10 | E1–E5, Q12 | `release.plan` | door43/archive | — |
| [#19](https://github.com/unfoldingWord-box3/tc-admin-app/issues/19) Type and coverage | §5; domain §3 | 0009 | H3, H5 | E7, Q11, Q16, Q17 | `project.read` | model/project | — |
| [#20](https://github.com/unfoldingWord-box3/tc-admin-app/issues/20) Unknown and administrative files | §8; domain §4 | — | R1 | — | `release.plan` | model/classify | S5 |
| [#21](https://github.com/unfoldingWord-box3/tc-admin-app/issues/21) Release-only and unsupported | §2; domain §3 | 0009 | P1, W2 | E10, Q11 | `portfolio.list`, `project.read` | model/project | — |

### EPIC: Portfolio and health ([#27](https://github.com/unfoldingWord-box3/tc-admin-app/issues/27))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#23](https://github.com/unfoldingWord-box3/tc-admin-app/issues/23) Writable discovery | §2, §5 | 0002 | P1, P2 | E7 | `portfolio.list` | door43/api, operations | — |
| [#24](https://github.com/unfoldingWord-box3/tc-admin-app/issues/24) Grouping, filters, async analysis | §5 | — | H3, H5 | Q17 | `portfolio.list` | operations, web | — |
| [#25](https://github.com/unfoldingWord-box3/tc-admin-app/issues/25) Health states | §5, §9; domain §5 | 0007 | H1, H3, H4 | E7, Q2 | `project.read` | model/health, web | — |
| [#26](https://github.com/unfoldingWord-box3/tc-admin-app/issues/26) Refresh and freshness | §9; arch §4 | 0002 | P3 | — | `project.refresh` | operations, web | — |

### EPIC: Create a Bible project ([#32](https://github.com/unfoldingWord-box3/tc-admin-app/issues/32))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#28](https://github.com/unfoldingWord-box3/tc-admin-app/issues/28) Creation wizard | §6 | 0006 | W3, A2 | — | `project.create.plan` | web, operations | S1 |
| [#29](https://github.com/unfoldingWord-box3/tc-admin-app/issues/29) Generate metadata.json | §6, §7; domain §8 | 0008 | W1, R10 | Q4 | `project.create.plan` | model/burrito | S1 |
| [#30](https://github.com/unfoldingWord-box3/tc-admin-app/issues/30) Create repository and first commit | §6 | 0004 | A2, A3, W5 | Q3, Q10 | `project.create.apply` | door43/api, operations | S1 |
| [#31](https://github.com/unfoldingWord-box3/tc-admin-app/issues/31) Setup incomplete | §6; §11 `setup_incomplete` | — | W4, X2 | — | `project.create.retry` | operations, web | — |

### EPIC: Selective release ([#41](https://github.com/unfoldingWord-box3/tc-admin-app/issues/41))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#33](https://github.com/unfoldingWord-box3/tc-admin-app/issues/33) Candidate detection | §10; domain §4 | 0005, 0010 | R1, R2, R4 | E1–E4 | `release.plan` | model/candidates | S3, S4, S5 |
| [#34](https://github.com/unfoldingWord-box3/tc-admin-app/issues/34) Snapshot assembly | §10; arch §3 | 0003, 0010 | R1, R3, R5, R7, W5 | E4, Q3, Q12, Q13 | `release.prepare` | operations/release-prepare | S3 |
| [#35](https://github.com/unfoldingWord-box3/tc-admin-app/issues/35) Metadata merge | §7, §10 | 0008, 0010 | R2, R10 | E5, Q1, Q7, Q8 | `release.prepare` | model/burrito | S3, S4 |
| [#36](https://github.com/unfoldingWord-box3/tc-admin-app/issues/36) Health poll | §9; arch §3 | 0007 | H1, H2 | Q2, Q6 | `preparation.read` | door43/health, operations | S6 |
| [#37](https://github.com/unfoldingWord-box3/tc-admin-app/issues/37) Version calculation | §10; domain §7 | — | R9 | E9 | `release.plan`, `release.create` | model/version | — |
| [#38](https://github.com/unfoldingWord-box3/tc-admin-app/issues/38) Release notes | §10 | — | — | — | `release.plan`, `release.create` | operations, web | S4, S5 |
| [#39](https://github.com/unfoldingWord-box3/tc-admin-app/issues/39) Create, pre-release, promote | §10 | 0003 | R3, R7, R8, A2 | Q3, Q5 | `release.create`, `release.promote` | door43/api, operations | S7 |
| [#40](https://github.com/unfoldingWord-box3/tc-admin-app/issues/40) Stale source and lost response | §10, §11; arch §6 | — | R5, R6, X1, X2 | — | `release.lookup`, error catalog | operations | S6 |

### EPIC: Demo readiness ([#44](https://github.com/unfoldingWord-box3/tc-admin-app/issues/44))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#42](https://github.com/unfoldingWord-box3/tc-admin-app/issues/42) Demo script | §13 | — | — | E9 | the Milestone 1 catalog | — | S1, S3, S7 |
| [#43](https://github.com/unfoldingWord-box3/tc-admin-app/issues/43) Rehearsals | §13 | — | — | — | the Milestone 1 catalog | — | S1, S3, S7 |

## Milestone 2 — Manage

| Epic | Spec | ADR | Invariants | Evidence / questions | Operations | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| [#45](https://github.com/unfoldingWord-box3/tc-admin-app/issues/45) Uploads | §8 | 0004, 0009 | W2, W5, W6, A2 | Q15 | `upload.plan`, `upload.apply` | S2 |
| [#46](https://github.com/unfoldingWord-box3/tc-admin-app/issues/46) Metadata editing | §7 | 0004, 0006, 0009 | W1, W2, W3, W5, W7 | Q4 | `metadata.plan`, `metadata.apply` | — |
| [#47](https://github.com/unfoldingWord-box3/tc-admin-app/issues/47) Convert to Scripture Burrito | §7 | 0008, 0009 | W1, W5 | E2, E3 | `convert.plan`, `convert.apply` | — |
| [#48](https://github.com/unfoldingWord-box3/tc-admin-app/issues/48) Open Bible Stories | §5, §6, §10 | 0008 | H5, W1 | Q4 | every Bible operation with `obs` | S1, S3 |
| [#49](https://github.com/unfoldingWord-box3/tc-admin-app/issues/49) Setup-incomplete recovery | §6, §11 | — | W4 | E10 | `project.create.resume` | — |

## Milestone 3 — Pilot

| Epic | Spec | ADR | Invariants | Evidence / questions | Operations | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| [#50](https://github.com/unfoldingWord-box3/tc-admin-app/issues/50) Accessibility | §5; arch §9 | — | H4 | — | — | — |
| [#51](https://github.com/unfoldingWord-box3/tc-admin-app/issues/51) Security review | arch §8 | 0001 | A1, A2, A4, W6, X3 | — | every apply | — |
| [#52](https://github.com/unfoldingWord-box3/tc-admin-app/issues/52) Performance | arch §9 | — | P1, P3 | Q12, Q17 | `portfolio.list`, `release.plan` | — |
| [#53](https://github.com/unfoldingWord-box3/tc-admin-app/issues/53) Operations | arch §9 | 0002 | X3 | Q9 | — | — |
| [#54](https://github.com/unfoldingWord-box3/tc-admin-app/issues/54) Bahtraku pilot | §12, §13 | — | all | E9, E11 | the whole catalog | all |

## Coverage check

Every invariant in [invariants.md](invariants.md) appears in at least one Milestone 1 or Milestone 2 row above except W6 and W7, which are Milestone 2 only. Every Milestone 1 operation in [operations.md](operations.md) §3 appears in at least one row except `preparation.discard`, which waits on Q14. Every question in [evidence.md](evidence.md) appears in at least one row except Q14 and Q18. Closed questions (Q6, Q7, Q11, Q17) stay cited where they were decided, so a row still shows what its issue rests on.
