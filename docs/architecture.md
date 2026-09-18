# tC Admin Architecture

Status: Accepted planning baseline

## 1. System shape

```text
Manager browser
    │  HTTPS, secure session cookie
    ▼
Hosted web frontend
    │  same-origin application API
    ▼
Cloudflare Worker (tC Admin backend-for-frontend)
    ├─ Door43 OAuth callback and session handling
    ├─ Project/repository adapter
    ├─ Metadata and file-operation workflows
    ├─ Scripture Burrito model fed by Door43 Scripture Burrito archives
    ├─ Health-check adapter
    ├─ Release snapshot orchestrator
    └─ Error/idempotency boundaries
             │
             ├─ Door43 Swagger v1 API
             └─ Door43 health-check service
```

The frontend is a hosted web application. The Worker is the trust boundary for Door43 credentials and all mutations. The implementation should follow the newer unfoldingWord application pattern: a web frontend plus a server-side Worker rather than browser-held DCS tokens.

## 2. Frontend responsibilities

The frontend owns:

- Portfolio layout, organization grouping, sorting, and filters.
- Project pills and accessible health indicators.
- Async loading and refresh states.
- Creation wizard and structured metadata form.
- Upload selection, overwrite warnings, diffs, and final summaries.
- Release stepper, candidate review, release-note editing, and promotion controls.
- Preservation of unsaved form state across re-authentication where safe.

The frontend must not:

- Store Door43 access tokens in local storage, IndexedDB, URLs, or JavaScript-visible state.
- Decide whether a user has Door43 write permission.
- Decide whether a health result is release-safe.
- Construct release contents without a server-confirmed candidate.

## 3. Worker responsibilities

### Authentication

1. Redirect the manager to Door43 OAuth.
2. Receive the authorization callback.
3. Exchange the code server-side.
4. Resolve the Door43 account and create a short-lived application session.
5. Use a secure HttpOnly session cookie for browser requests.
6. Remove the session and credential material on logout or expiry.

The DCS credential may be held only in a short-lived protected server session as required to call Door43. It must not be exposed to browser JavaScript or retained as a long-term application credential.

### Authorization

The Worker must treat Door43 as live authority:

- Discover organizations and repositories using the authenticated account.
- Filter the portfolio to repositories with write access.
- Re-check access before repository creation, file commits, metadata commits, branch changes, release creation, and promotion.
- Fail closed when permission status is ambiguous.

### Project adapter

Provide a narrow internal interface over the Door43 API for:

- Organization and writable-repository discovery
- Repository metadata and default branch
- File tree and raw file reads
- File create/update operations
- Commit and branch/ref reads
- Temporary branch creation and deletion
- Release and tag reads
- Release creation and promotion/editing
- Door43 compare and history links
- Scripture Burrito archive download for any ref (`/{owner}/{repo}/sb/{ref}.zip`, a web route with no API equivalent)

Keep the Swagger-generated/API-specific shapes at the adapter boundary. The product and domain layers should use tC Admin concepts such as `Project`, `ProjectMetadata`, `Ingredient`, `Book`, `Story`, `ReleaseSnapshot`, and `ProjectVersion`.

### Health adapter

Door43 runs the health check automatically on every branch push and tag; there is no trigger endpoint. The adapter reads `GET /repos/{owner}/{repo}/healthcheck?ref=` and polls after a push: every 5 seconds for up to 3 minutes, then returns a running state and lets the manager refresh.

The health adapter accepts a repository/ref target and returns:

- Running state
- Successful health result
- Authoritative findings and severities
- Door43 unavailable/error state
- Timestamp and target ref

The UI should receive normalized data, while the raw service response remains available for diagnostics. A health error is not equivalent to a healthy result.

### Snapshot orchestrator

The orchestrator must:

1. Read the latest full release tag and the current default branch head; bind preparation to the default-branch commit SHA.
2. Download the Scripture Burrito archive for the default branch and, when a release exists, for the latest full release tag. Door43 converts non-SB refs and rolls up SB refs.
3. Detect new, changed released, unchanged, administrative, and unknown files by comparing the two trees.
4. Create `temp-tca-release/<version>` from the latest full release tag, or from the default branch head for a first release (ADR 0010).
5. Assemble one commit: root files and administrative ingredients from the default branch archive, released books from the tag archive, selected books from the default branch archive, and `metadata.json` merged from the previous release's metadata with size and md5 recomputed for every file and scope set to the released books.
6. Push the commit with the multi-file contents endpoint.
7. Poll the health check for the temporary branch.
8. Re-check the default-branch SHA before release creation.
9. Create the tag and Door43 release targeting the snapshot commit.
10. Delete the temporary branch only after successful release creation.

If the source SHA changes, the orchestrator must stop and return a restart-required result. It must never silently merge the new project state into an already reviewed candidate.

## 4. Data ownership and storage

### Door43-owned

- Users and OAuth authorization
- Organization and repository permissions
- Repository files and commits
- Branches, tags, releases, and release notes
- Repository health service results as the authoritative source

### tC Admin-owned

- Session state needed to operate the hosted application
- User display preferences such as sorting and filters
- Temporary workflow state needed to render an active wizard
- Normalized transient health/repository metadata where caching improves the experience

tC Admin must not become a content database or a second release-history database. Cached metadata must have freshness and invalidation rules, and stale data must be labeled.

## 5. File and metadata safety

- Normalize and validate repository-relative paths.
- Reject absolute paths, traversal, symlinks, and unsupported unsafe file types.
- Enforce Worker and Door43 size limits before mutation.
- Build an upload operation plan before writing any file.
- Require explicit confirmation for overwrites and unknown-file inclusion.
- Commit accepted file changes together.
- Generate ingredient-entry proposals from recognized filenames; require manager confirmation.
- Never write to the default branch of a release-only project; a release touches only the temporary branch, the tag, and the Door43 release.
- Never provide a Scripture/OBS text editor in version one.

## 6. Release safety and idempotency

### Stale source protection

Every release preparation stores the source default-branch commit SHA. Before snapshot creation and again before release creation, the Worker verifies that the source has not moved.

### Duplicate release protection

When release creation returns an ambiguous network result, the Worker queries Door43 for the expected tag/release. If it exists, tC Admin displays it and does not create another release.

### Branch lifecycle

- Create branch: preparation begins.
- Retain branch: health failure, commit failure, or release failure.
- Delete branch: only after release creation succeeds.
- Promotion: acts on the existing Door43 release/tag and does not rebuild contents.

## 7. Failure model

All mutations should return normalized, user-actionable errors with an internal request ID. Never silently retry a mutation whose outcome is unknown.

Required user-visible behaviors:

- Door43 unavailable: `Door43 is unavailable currently. Please refresh later.`
- Commit failure: `Commit failed: <error message>.`
- Concurrent change: `Project has been edited. The release process will need to restart.`
- Promotion failure: `Pre-release promotion failed. <error message>.`

Diagnostics may include request ID, project, commit SHA, version, target ref, health status, and Door43 response status. They must exclude file contents, OAuth tokens, and secrets.

## 8. Security requirements

- OAuth authorization-code flow with server-side code exchange.
- Secure, HttpOnly, SameSite session cookie.
- CSRF protection on browser mutations.
- No token in URL, local storage, IndexedDB, or client logs.
- Least-privilege Door43 scopes.
- Live permission checks at mutation boundaries.
- Path traversal and symlink defenses for uploads.
- No automatic repository deletion.
- Redacted operational diagnostics.
- Accessible UI that does not use color as the only health signal.

## 9. Non-functional targets

- Hosted web app, desktop-first and responsive on smaller screens.
- WCAG 2.2 AA target.
- Support typical portfolios of 1–50 repositories and remain usable beyond 100.
- Dashboard load and refresh must show asynchronous progress rather than blocking the whole portfolio on one repository.
- Production Door43 is the normal deployment target; QA hosts are deployment configuration for testing.
- Architect for future interface localization; English is the initial interface language.

## 10. External implementation references

- [Door43 API Swagger](https://git.door43.org/swagger.v1.json)
- [Scripture Burrito specification](https://docs.burrito.bible/)
- [Resource Container manifest specification](https://resource-container.readthedocs.io/en/latest/manifest.html) (read-only mapping)
- [Door43 RC-to-SB converter](https://github.com/unfoldingWord/go-rc2sb), used by Door43's Scripture Burrito archive
- [Door43 health-check service](https://github.com/unfoldingWord/dcs/tree/release/dcs/v1.27/services/door43healthcheck)
- [Reference release tooling](https://github.com/unfoldingWord-dev/release_uw_resources)
- [Newer unfoldingWord application pattern](https://github.com/unfoldingWord/bible-editor)
