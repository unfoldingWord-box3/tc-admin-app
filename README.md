# tC Admin

tC Admin is a planned hosted web application for Bible translation team leaders and project managers. It will help managers oversee writable Door43 repositories, maintain valid Scripture Burrito metadata, understand repository health and coverage, upload files safely, and prepare selective releases without publishing unfinished work.

The project is currently in product-definition and prototyping.

## Start here

[AGENTS.md](AGENTS.md) is the entry point for anyone, human or agent, working in this repository: the document tower, the rules, how to work an issue.

## Product documentation

Read downward for why, upward for how.

- [Vision](docs/vision.md): why this exists
- [Product specification](docs/product-spec.md): what it must do, with acceptance scenarios S1 to S7
- [Domain model](docs/domain-model.md) and [glossary](CONTEXT.md): the concepts, their states, and their identifiers
- [Invariants](docs/invariants.md): what must never break, numbered and tested
- [Operation catalog](docs/operations.md): everything the system can do, with plan, apply, receipt, and typed errors
- [Architecture](docs/architecture.md): the layers and where code goes
- [Architecture decisions](docs/adr): why this way
- [Evidence register](docs/evidence.md): what is verified about Door43 and what is still open, with owners
- [Roadmap](docs/roadmap.md): milestones and epics
- [Traceability](docs/traceability.md): how every issue connects to the above

## Prototypes

- [`prototypes/tc-admin`](prototypes/tc-admin): read-only QA portfolio and Door43 OAuth prototype
- [`prototypes/door43-mcp`](prototypes/door43-mcp): prompt-first Door43 MCP field-kit proof of concept

Neither prototype is a production deployment. Follow each prototype's README for its local setup and limitations.

## External references

- [Door43 Content Service](https://git.door43.org/)
- [Scripture Burrito specification](https://docs.burrito.bible/)
- [Resource Container manifest specification](https://resource-container.readthedocs.io/en/latest/manifest.html)
- [Door43 release tooling reference](https://github.com/unfoldingWord-dev/release_uw_resources)
