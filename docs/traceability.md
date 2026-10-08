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
| [#7](https://github.com/unfoldingWord-box3/tc-admin-app/issues/7) Scaffold web/ worker/ shared/ | arch §1, §10; deployment | 0011, 0012 | — (creates the enforcement points; carries over the prototype's tests for H1, H3, P1, P2, A1, A3; X2, X3 at `http/errors`) | Q26, Q27 | all (schemas); `situation.read` without a session | every layer | — |
| [#8](https://github.com/unfoldingWord-box3/tc-admin-app/issues/8) Design system | §5 | — | H4 | — | — | web | — |
| [#9](https://github.com/unfoldingWord-box3/tc-admin-app/issues/9) Deploy to workers.dev | arch §9 | 0001 | A1 | — | — | worker/http, wrangler | — |
| [#10](https://github.com/unfoldingWord-box3/tc-admin-app/issues/10) Test harness and fixtures | arch §10 | 0012 | all (test naming) | E1–E5, E7 | — | test, fixtures | — |

### EPIC: Sign-in and session ([#16](https://github.com/unfoldingWord-box3/tc-admin-app/issues/16))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#12](https://github.com/unfoldingWord-box3/tc-admin-app/issues/12) Code exchange | §2; arch §3 | 0001 | A1, A3 | E8, Q10 | `situation.read` | door43/auth, operations/sign-in, http/session | — |
| [#13](https://github.com/unfoldingWord-box3/tc-admin-app/issues/13) CSRF and origin | arch §8 | — | A4 | — | every apply | http | — |
| [#14](https://github.com/unfoldingWord-box3/tc-admin-app/issues/14) Live permission re-check | §2; arch §3 | — | A2, P2 | E7 | every apply (precondition) | operations | — |
| [#15](https://github.com/unfoldingWord-box3/tc-admin-app/issues/15) Expired session | §11 `session_expired` | 0001 | A1, X2 | — | error catalog | http, web | — |

### EPIC: Project model ([#22](https://github.com/unfoldingWord-box3/tc-admin-app/issues/22))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#17](https://github.com/unfoldingWord-box3/tc-admin-app/issues/17) Scripture Burrito reader | §7; domain §8 | 0008 | W1, R10 | E2, E5, E17, E36, E53, Q4 | `release.prepare`, `import.plan` (the metadata they read) | model/burrito-reader | — |
| [#18](https://github.com/unfoldingWord-box3/tc-admin-app/issues/18) Archive client | arch §3 | 0008, 0010 | R3, R10 | E1–E5, E17, E30, E34, E53, Q12, Q22 | `release.prepare`, `import.plan` | door43/archive | — |
| [#19](https://github.com/unfoldingWord-box3/tc-admin-app/issues/19) Type and coverage | §5; domain §3 | 0013 | H3, H5 | E7, E12, E14, E32, E33, E42, Q11, Q16, Q17, Q23 | `project.read` | model/project, model/books, door43/catalog, shared/schema | — |
| [#20](https://github.com/unfoldingWord-box3/tc-admin-app/issues/20) Unknown and administrative files | §8; domain §4 | — | R1 | E17, E36, Q22 | `release.plan`, `release.prepare` (the unknown and administrative files they list and carry; wired by #34) | model/classify | S5 |
| [#21](https://github.com/unfoldingWord-box3/tc-admin-app/issues/21) Unsupported projects with a reason | §2; domain §3 | 0013, 0014 | P1, W2 | E10, E42, Q11, Q25 | `portfolio.list`, `project.read` | model/project | — |

### EPIC: Portfolio and health ([#27](https://github.com/unfoldingWord-box3/tc-admin-app/issues/27))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#23](https://github.com/unfoldingWord-box3/tc-admin-app/issues/23) Writable discovery | §2, §5 | 0002, 0014 | P1, P2 | E7, E40, E41, E42 | `portfolio.list` | door43/api, operations | — |
| [#24](https://github.com/unfoldingWord-box3/tc-admin-app/issues/24) Grouping, filters, async analysis | §5 | — | H3, H5 | Q17 | `portfolio.list` | operations, web | — |
| [#25](https://github.com/unfoldingWord-box3/tc-admin-app/issues/25) Health states | §5, §9; domain §5 | 0007 | H1, H3, H4 | E7, E15, E28, Q2, Q21 | `project.read`, `preparation.read` | model/health, web | — |
| [#26](https://github.com/unfoldingWord-box3/tc-admin-app/issues/26) Refresh and freshness | §9; arch §4 | 0002 | P3, H1, H3, A2 | E10, E15, E27, E63, Q17 | `project.read`, `project.refresh`, `portfolio.list` | operations/project-read, web (freshness, ProjectView, Portfolio) | — |
| [#124](https://github.com/unfoldingWord-box3/tc-admin-app/issues/124) Health findings display | §9, §10 | — | H1, H2, H4 | E16, E60, E65 | `preparation.read` (display only) | web/HealthFindings, web/health-findings, web/door43-text, web/ReleaseStepper | S6 |

### EPIC: Create a project ([#32](https://github.com/unfoldingWord-box3/tc-admin-app/issues/32))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#28](https://github.com/unfoldingWord-box3/tc-admin-app/issues/28) Creation wizard | §6 | 0006, 0013 | W3, A2, X2 | E25, E37, E43, E44, E50, E51, Q4, Q20, Q25, Q28, Q30 | `project.create.plan`, `project.create.apply`, `language.list`, `owner.list` | web, operations, door43/languages, door43/repos, model/language | S1 |
| [#29](https://github.com/unfoldingWord-box3/tc-admin-app/issues/29) Generate metadata.json | §6, §7; domain §8 | 0008, 0011 | W1, R10, A2 | E17, E24, E25, E37, E43, E44, Q4, Q20, Q28 | `project.create.plan` | model/burrito, operations | S1 |
| [#30](https://github.com/unfoldingWord-box3/tc-admin-app/issues/30) Create repository and first commit | §6 | 0004, 0011 | A2, A3, W4, W5, X1 | E21, E26, E27, E28, E43, E45, E48, Q3, Q4, Q10, Q28, Q29 | `project.create.apply` | door43/writes, operations | S1 |
| [#31](https://github.com/unfoldingWord-box3/tc-admin-app/issues/31) Setup incomplete | §6; §11 `setup_incomplete` | — | W4, X1, X2, A2 | E19, E45, E63, Q29 | `project.create.retry` | operations, door43/writes, model/git-blob, web | — |

### EPIC: Selective release ([#41](https://github.com/unfoldingWord-box3/tc-admin-app/issues/41))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#33](https://github.com/unfoldingWord-box3/tc-admin-app/issues/33) Candidate detection and selection states | §10; domain §4 | 0005, 0010, 0013 | R1, R2, R4, R5, A2, W2 | E14, E18, E19, E20, E36, E47, E52, Q24, E54, E56 | `release.plan` | model/candidates, door43/trees, door43/catalog, operations/release-plan, web/ReleaseStepper | S3, S4, S5, S8 |
| [#34](https://github.com/unfoldingWord-box3/tc-admin-app/issues/34) Snapshot assembly | §10; arch §3 | 0003, 0010, 0013 | R1, R2, R3, R4, R5, R7, R9, R10, W2, W5, A2, X1 | E4, E17, E19, E21, E27, E28, E30, E34, Q3, Q12, Q13, Q22, Q24, E54, E56 | `release.prepare` | operations/release-prepare, model/snapshot, door43/branches, web/ReleaseStepper | S3, S8 |
| [#35](https://github.com/unfoldingWord-box3/tc-admin-app/issues/35) Metadata merge | §7, §10 | 0008, 0010, 0013 | R2, R10, W1 | E5, E16, E17, E46, Q1, Q7, Q8, Q24 | `release.prepare` (the metadata it writes; wired by #34) | model/burrito, model/burrito-reader | S3, S4, S8 |
| [#36](https://github.com/unfoldingWord-box3/tc-admin-app/issues/36) Health poll | §9; arch §3 | 0007 | H1, H2, H3, R5 | E15, E28, Q2, Q6, E54, E56 | `preparation.read` | door43/health, model/health, operations/preparation-read, web/ReleaseStepper | S6 |
| [#37](https://github.com/unfoldingWord-box3/tc-admin-app/issues/37) Version calculation | §10; domain §7 | 0013 | R9 | E9, Q19, Q24, E56 | `release.plan` (the proposal, built with #33), `release.create` (the edit) | model/version, web/ReleaseStepper | S8 |
| [#38](https://github.com/unfoldingWord-box3/tc-admin-app/issues/38) Release notes | §10 | 0013 | R2 | Q24, E56 | `release.plan` (the draft, built with #33), `release.create` (the confirmed notes) | model/notes, operations, web, web/ReleaseStepper | S4, S5, S8 |
| [#39](https://github.com/unfoldingWord-box3/tc-admin-app/issues/39) Create, pre-release, promote | §10 | 0003 | R3, R5, R6, R7, R8, R9, H2, A2, X1 | E21, E27, E29, Q3, Q5, Q6, E54, E56 | `release.create`, `release.promote` | door43/releases, door43/branches, operations/release-create, operations/release-promote, web/ReleaseStepper | S7 |
| [#40](https://github.com/unfoldingWord-box3/tc-admin-app/issues/40) Stale source and lost response | §10, §11; arch §6 | — | R5, R6, X1, X2 | E20, E21, E27, E29, E54 | `release.lookup`, `preparation.read`, `release.create`, error catalog | operations/release-lookup, operations/preparation-read, operations/release-create, door43/releases | S6 |
| [#58](https://github.com/unfoldingWord-box3/tc-admin-app/issues/58) Discard a preparation | §10 | 0003 | R7, A2 | E21, E27, Q14, E54, E56 | `preparation.discard` | operations/preparation-discard, door43/branches, web/ReleaseStepper | — |
| [#125](https://github.com/unfoldingWord-box3/tc-admin-app/issues/125) Reopen a release preparation after the page is closed or reloaded | §10, §11 | 0011 | R7, X2, A2 | E56, E57, E59, E66 | `preparation.list`, `preparation.read`, `preparation.discard` | operations/preparation-list, operations/plans, operations/release-prepare, web/ReleaseStepper, web/preparations, web/ProjectView | S6, S7 |

### EPIC: Add books: upload and import ([#45](https://github.com/unfoldingWord-box3/tc-admin-app/issues/45), [#47](https://github.com/unfoldingWord-box3/tc-admin-app/issues/47))

Moved into Milestone 1 on 1 October 2026 (Q25); #47 re-scoped from conversion to import. Child issues created 5 October 2026 at Rich's direction.

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#45](https://github.com/unfoldingWord-box3/tc-admin-app/issues/45) Uploads with book and story identification | §8 | 0004, 0013 | W2, W5, W6, A2, R10 | E36, Q15, Q25 | `upload.plan`, `upload.apply` | operations/upload, model/classify | S2 |
| [#72](https://github.com/unfoldingWord-box3/tc-admin-app/issues/72) Identify a book or story | §8 | 0008, 0013 | W1, W6 | E36, E37 | `upload.plan`, `upload.apply`, `import.plan` | model/upload, model/books, model/burrito | S2, S5 |
| [#73](https://github.com/unfoldingWord-box3/tc-admin-app/issues/73) Upload path safety and limits | §8 | 0013 | W6 | E30, E31, Q15, Q22 | `upload.plan` | model/upload-paths, operations/upload | S2 |
| [#74](https://github.com/unfoldingWord-box3/tc-admin-app/issues/74) `upload.plan` | §8 | 0004, 0011, 0013 | W1, W2, W5, W6, R5, R10, A2 | E17, E19, E34, E36, E37, E63, E64, Q15, Q33 | `upload.plan` | operations/upload-plan, model/burrito, model/text-diff, model/upload, model/upload-paths, door43/branches, door43/trees, door43/archive, http/multipart, shared/schema | S2, S5 |
| [#75](https://github.com/unfoldingWord-box3/tc-admin-app/issues/75) `upload.apply` | §8 | 0004, 0011, 0013 | W2, W5, W6, A2, A3, R5, R10, X1 | E19, E21, E27, E31, E63, E64, E68, Q33 | `upload.apply` | operations/upload-apply, model/git-blob, door43/writes, door43/branches, door43/trees, door43/releases, door43/repos, http/multipart, shared/schema | S2, S5 |
| [#76](https://github.com/unfoldingWord-box3/tc-admin-app/issues/76) Upload screen | §8 | 0011, 0013 | W6, X2 | E36, E64, Q33 | `upload.plan`, `upload.apply` | web/UploadScreen, web/upload, web/api/client, web/ProjectView, web/CreateProject | S2, S5 |
| [#47](https://github.com/unfoldingWord-box3/tc-admin-app/issues/47) Import from an existing repository | §8 | 0008, 0013 | W1, W2, W5, A2, R10 | E1, E17, E24, E34, E35, E36, Q25 | `owner.search`, `source.search`, `import.plan`, `import.apply` | door43/catalog, door43/archive, operations/import | S9 |
| [#77](https://github.com/unfoldingWord-box3/tc-admin-app/issues/77) `owner.search` | §8 | 0013 | P3 | E35 | `owner.search` | door43/owners, operations/owner-search | S9 |
| [#78](https://github.com/unfoldingWord-box3/tc-admin-app/issues/78) `source.search` | §8 | 0013 | H3, P3 | E20, E35, E36, Q23, Q25 | `source.search` | door43/catalog-search, model/project, operations/source-search | S9 |
| [#79](https://github.com/unfoldingWord-box3/tc-admin-app/issues/79) `import.plan` | §8 | 0008, 0013 | W1, W2, R5, R10 | E1, E17, E18, E24, E30, E34, E36, Q12, Q34 | `import.plan` | door43/archive, model/burrito, operations/import-plan | S9 |
| [#80](https://github.com/unfoldingWord-box3/tc-admin-app/issues/80) `import.apply` | §8 | 0004, 0011, 0013 | W1, W2, W5, A2, A3, R5, X1 | E21, E24, E27, E31, E63, Q33 | `import.apply` | operations/import-apply, operations/planned-commit, door43/writes | S9 |
| [#81](https://github.com/unfoldingWord-box3/tc-admin-app/issues/81) Import screen | §8 | 0013 | X1, X2 | E35, E36, E69 | `owner.search`, `source.search`, `import.plan`, `import.apply` | web (ImportScreen, import) | S9 |

### EPIC: Open Bible Stories ([#48](https://github.com/unfoldingWord-box3/tc-admin-app/issues/48))

Moved into Milestone 1 on 1 October 2026 (Q25). Child issues created 5 October 2026 at Rich's direction.

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#48](https://github.com/unfoldingWord-box3/tc-admin-app/issues/48) Open Bible Stories | §5, §6, §8, §10 | 0008, 0013 | H5, W1, R10 | E36, E37, Q4, Q24 | every project operation with `obs`; `release.plan` with no selection | model, operations, web | S1, S9 |
| [#82](https://github.com/unfoldingWord-box3/tc-admin-app/issues/82) Create an Open Bible Stories project | §6 | 0006, 0013 | W1, W3, H5 | E36, E37, E44, E46, E47, Q4, Q25 | `project.create.plan`, `project.create.apply` | model/burrito, operations | S1 |
| [#83](https://github.com/unfoldingWord-box3/tc-admin-app/issues/83) Stories in uploads, imports, archives | §5, §8 | 0013 | H3, H5, W1 | E35, E36 | `upload.plan`, `import.plan`, `project.read` | model/books, model/upload, door43/archive | S2, S9 |
| [#84](https://github.com/unfoldingWord-box3/tc-admin-app/issues/84) Release Open Bible Stories whole | §10 | 0003, 0005, 0010, 0013 | R1, R2, R3, R4, R10, H1, H2, H5 | E36, E59, E60, Q24, Q32 | `release.plan`, `release.prepare`, `release.create` | operations/release, web | S3 |

### EPIC: Demo readiness ([#44](https://github.com/unfoldingWord-box3/tc-admin-app/issues/44))

| Issue | Spec | ADR | Invariants | Evidence / questions | Operations | Layer | Scenarios |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#42](https://github.com/unfoldingWord-box3/tc-admin-app/issues/42) Demo script | §13; [demo-script.md](demo-script.md) | — | R3, R7, R9, H2, A2 | E9, E16, E28, E38, E54, E56, Q6 | the Milestone 1 catalog, one per step | docs/demo-script.md | S1, S3, S7, S8 |
| [#43](https://github.com/unfoldingWord-box3/tc-admin-app/issues/43) Rehearsals | §13; [demo-script.md](demo-script.md) | — | R1, R3, R5, R7, R9, R10, H2 | E58, Q31 | the Milestone 1 catalog | docs/demo-script.md, fixtures | S1, S3, S7, S8, S9 |

## Milestone 2 — Manage

| Epic | Spec | ADR | Invariants | Evidence / questions | Operations | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| [#46](https://github.com/unfoldingWord-box3/tc-admin-app/issues/46) Metadata editing | §7 | 0004, 0006, 0013 | W1, W2, W3, W5, W7 | Q4 | `metadata.plan`, `metadata.apply` | — |
| [#49](https://github.com/unfoldingWord-box3/tc-admin-app/issues/49) Setup-incomplete recovery | §6, §11 | — | W4 | E10 | `project.create.resume` | — |

Uploads (#45), import (#47), and Open Bible Stories (#48) moved to Milestone 1 on 1 October 2026 and appear above.

## Milestone 3 — Pilot

| Epic | Spec | ADR | Invariants | Evidence / questions | Operations | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| [#50](https://github.com/unfoldingWord-box3/tc-admin-app/issues/50) Accessibility | §5; arch §9 | — | H4 | — | — | — |
| [#51](https://github.com/unfoldingWord-box3/tc-admin-app/issues/51) Security review | arch §8 | 0001 | A1, A2, A4, W6, X3 | — | every apply | — |
| [#52](https://github.com/unfoldingWord-box3/tc-admin-app/issues/52) Performance | arch §9 | — | P1, P3 | Q12, Q17 | `portfolio.list`, `release.plan` | — |
| [#53](https://github.com/unfoldingWord-box3/tc-admin-app/issues/53) Operations | arch §9 | 0002 | X3 | Q9 | — | — |
| [#54](https://github.com/unfoldingWord-box3/tc-admin-app/issues/54) Bahtraku pilot | §12, §13 | — | all | E9, E11 | the whole catalog | all |

## Coverage check

Every invariant in [invariants.md](invariants.md) appears in at least one Milestone 1 or Milestone 2 row above except W7, which is Milestone 2 only. Every Milestone 1 operation in [operations.md](operations.md) §3 appears in at least one row. Every question in [evidence.md](evidence.md) appears in at least one row except Q18, closed as not needed when Q11 was re-recorded. Closed questions stay cited where they were decided, so a row still shows what its issue rests on.
