# The portfolio lists supported projects by default; showing all is one choice away

Status: accepted by Rich, 2 October 2026. Amends ADR 0013 decision 1 on where unsupported repositories appear, and invariant P1.

## Decision

1. **By default the portfolio lists the projects tC Admin manages**: writable Scripture Burrito repositories with the `textTranslation` or `textStories` flavor. Door43 filters them in the repository search (`metadataType=sb&flavor=textTranslation&flavor=textStories`, E41), so tC Admin never reads the rest.
2. **"Show all projects" lists every writable repository**, as before: each unsupported one with its reason, and for a Bible or Open Bible Stories repository in another format, the offer to import it into a new project. The choice is the `show` input of `portfolio.list` (`supported`, the default, or `all`).

## Why

A manager who belongs to many organizations can write hundreds or thousands of repositories, nearly all of them in formats or of types tC Admin does not manage. Reading and classifying all of them on every visit made the portfolio too slow to use (reported by Rich on QA, 2 October 2026), and the unsupported ones offer nothing to do except import, which starts from the import flow rather than from the portfolio. Asking Door43 for only the two flavors keeps the default view fast and relevant. Keeping the full list behind one checkbox keeps the promise P1 protects: a manager can still see every repository they can write and why tC Admin does not manage it.

## Consequences

- P1 becomes "Nothing writable is hidden from show all": with `show: all`, every non-archived repository with push or admin appears; with the default, every such Scripture Burrito Bible or Open Bible Stories repository does.
- A Bible or Open Bible Stories repository in another format no longer appears in the default portfolio; its import offer is seen with "Show all projects" or from the import flow (#47).
- The `portfolio_too_large` read limit applies to whichever list was asked for, so the default view reaches it far later.
