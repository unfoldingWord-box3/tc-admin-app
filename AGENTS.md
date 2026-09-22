# Working in tc-admin-app

This file is the entry point for anyone, human or agent, working in this repository. Read it first, then only what your task needs.

## What this is

tC Admin is a planned hosted web application that lets Bible translation managers see, create, and selectively release their Door43 repositories as Scripture Burrito. The repository holds the product design, the decisions, the plan, and two prototypes. There is no application code yet; the first application issue is [#7](https://github.com/unfoldingWord-box3/tc-admin-app/issues/7). Milestone 1 is due 16 October 2026 and its scope does not grow ([roadmap](docs/roadmap.md)).

## The tower

Each document answers one question. Read downward for "why", upward for "how".

| Question | Document |
| --- | --- |
| Why does this exist? | [docs/vision.md](docs/vision.md) |
| What must it do, and for whom? | [docs/product-spec.md](docs/product-spec.md) |
| What are the concepts and their states? | [docs/domain-model.md](docs/domain-model.md), [CONTEXT.md](CONTEXT.md) (glossary and identifiers) |
| What must never break? | [docs/invariants.md](docs/invariants.md) |
| What can the system do, exactly? | [docs/operations.md](docs/operations.md) |
| How is it shaped and where does code go? | [docs/architecture.md](docs/architecture.md) |
| Why this way and not another? | [docs/adr](docs/adr) |
| What have we verified, and what is still unknown? | [docs/evidence.md](docs/evidence.md) |
| In what order, and how do we know it is done? | [docs/roadmap.md](docs/roadmap.md), GitHub milestones and `EPIC:` issues |
| How does an issue connect to all of the above? | [docs/traceability.md](docs/traceability.md) |
| How is it built, checked, and deployed? | [docs/deployment.md](docs/deployment.md), `.github/workflows/` |

## Orient by task

| Task | Read | Then |
| --- | --- | --- |
| Implement an issue | the issue's Traceability section, the operations it names, the invariants it cites | build in the layer the module map names, add tests named with the invariant ids |
| Change a rule or a state | CONTEXT.md, domain-model.md, invariants.md | write or amend an ADR; update identifiers everywhere they appear |
| Ask "how does Door43 behave" | evidence.md | cite an `E` id; if absent, add a `Q` and probe only with credentials and a named host |
| Change the plan | roadmap.md, the epic issue | keep Milestone 1 scope fixed; record why |
| Touch the UI | product-spec.md §5–§10, the design system rules in #8 | glossary wording only; health never color alone |

## Five rules

1. **One vocabulary.** Use the terms in CONTEXT.md in prose and UI copy, and the identifiers in its "Identifiers" section in code, API, tests, and logs. Never introduce a synonym; the glossary lists the words to avoid.
2. **Invariants are named and tested.** A change that touches an enforcement point in invariants.md keeps or adds a test whose title starts with the invariant id. Weakening an invariant needs an ADR.
3. **Evidence before assertion.** State what is verified with its `E` id, what is inferred, and what is unknown with its `Q` id. Never fill a gap with invention. A live probe records its result in evidence.md.
4. **Plan before apply.** Every mutation the system performs is a plan the manager reviews and an apply that writes only what the plan listed. Build operations, not screens.
5. **Open questions belong to their owner.** Do not decide a `Q`. Build behind the current text, record a labeled proposal, and ask the owner named in evidence.md.

## Working an issue

1. Read the issue and its Traceability section. Confirm the `Q`s it depends on are closed or state the assumption you are building behind.
2. Implement in the layer the architecture's module map names. Keep Door43 shapes in the adapter; keep glossary identifiers everywhere else.
3. Add tests: unit tests for the model, contract tests against `fixtures/door43/` for operations, an invariant test for every invariant the issue cites.
4. Update the documents the change affects: identifiers in CONTEXT.md, the operation entry, the evidence register, the ADR if a decision changed.
5. Run the checks (below). Open the pull request with the template; fill the invariants and evidence sections truthfully.
6. Done means: acceptance criteria met, tests green, documents updated, evidence recorded. Not "code pushed".

## Checks

Two checks run today, locally and in CI on every pull request (`.github/workflows/check.yml`):

```
node scripts/check-docs.mjs          # relative links; every R/H/A/W/P/X, E/Q, and S id referenced is defined
npm test --prefix prototypes/tc-admin
```

The live Door43 write probe is `node --env-file=.env scripts/probe/qa-write-probe.mjs`; it needs a `TEST_TOKEN` issued by the QA host and refuses production. It prints the server's message on any failing step. Planned once `web/` and `worker/` exist (#7, #10): `npm run check` (typecheck, lint, unit and contract tests) and `npm run e2e` (one Playwright sign-in on QA).

## Hosts and credentials

- QA Door43 (`https://qa.door43.org`) is the development target. Production (`https://git.door43.org`) is for sign-in verification, the Milestone 1 demo, and the pilot. Never mutate a production repository outside the demo and pilot plans.
- Configuration comes from a root `.env` (ignored by Git); see the prototype README. The QA test user's credentials are `TEST_ORG`, `TEST_USER`, `TEST_PASSWORD`, and `TEST_TOKEN` (E23); an agent session has them only when the environment is configured with them. Never commit a client id, secret, or token. Never print one in a log, a test, a fixture, or a chat message.
- Seed repositories and their formats are listed in evidence.md (E9). The `tc-admin-qa-org` organization on production is copied to QA at each reset (#1); until then QA probes use the `tc-admin-qa` user's own namespace.
- The translationCore 4 design system lives in https://github.com/unfoldingWord/translationCore4 (#8).

## Conventions

- Commits: imperative subject under 70 characters, a body that says why. One concern per commit.
- Branches: `claude/<name>` for agent sessions; a pull request per issue or per coherent document change.
- Copy: sentence case, verbs with objects on buttons, middle-dot separators, no emoji (the translationCore 4 design system rules, #8). "unfoldingWord" is always camelCase.
- Code (planned): TypeScript strict in `web/`, `worker/`, and `shared/`; no `any` at a layer boundary; the shared schema is the only source of API types.
- Errors: only codes from the operation catalog's error catalog; the message text the specification fixes is quoted, not paraphrased.

## Accretion

Each kind of work leaves the system more legible than it found it:

| Work | Leaves behind |
| --- | --- |
| A live probe | an `E` entry with host and date, and a fixture |
| A bug fix | an invariant test, or a new invariant if the bug crossed a line no invariant named |
| A decision | an ADR, updated identifiers, a closed `Q` |
| A new operation | a catalog entry, a schema, a contract test, a traceability row |
| A closed issue | its Traceability section verified, its evidence recorded |

## Do not

- Grow Milestone 1 scope, or move its date, without the roadmap saying so.
- Hide a writable repository, show unknown health as healthy, or show unknown coverage as complete or zero.
- Reinterpret a Door43 health result.
- Write to a default branch as part of a release, or write any format but Scripture Burrito.
- Retry a write whose outcome is unknown.
- Put a Door43 token anywhere the browser, a URL, or a log can see it.
- Resolve an open question by choosing an answer and building it.
