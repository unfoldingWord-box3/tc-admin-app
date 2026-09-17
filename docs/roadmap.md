# tC Admin Roadmap

Status: Accepted planning baseline

## Version one outcome

Deliver a trustworthy end-to-end loop for Bible and OBS repositories:

`sign in → discover → create/manage → upload/manifest → health check → prepare release → pre-release/full release → revise`

## Phase 0 — API and dependency verification

- Verify the Door43 Swagger v1 operations and OAuth configuration.
- Verify writable organization/repository discovery.
- Verify repository creation, file create/update, branch/ref, release create, release edit/promotion, and release lookup behavior.
- Verify the Door43 health-check request and response contract.
- Verify the Resource Container templates and Bible/OBS manifest rules.
- Determine Worker/API upload size limits.

## Phase 1 — Auth and portfolio

- Hosted frontend and Cloudflare Worker foundation.
- Door43 OAuth callback and secure session.
- Writable organization/repository discovery.
- Organization grouping, filters, configurable sorting, async analysis.
- Project pills, coverage counts, health states, refresh behavior.

## Phase 2 — Project creation and repository management

- Bible creation wizard.
- OBS creation wizard using shared flow with type-specific templates.
- Manifest form and validation.
- Optional initial upload.
- Upload batches, overwrite warnings, diffs, unknown files, and one-commit operations.
- Setup incomplete recovery.

## Phase 3 — Health and project detail

- Door43 health-check adapter.
- Dashboard-load and manual-refresh checks.
- Post-manifest-save checks.
- Health findings and error states.
- Coverage derived from recognized books/stories.

## Phase 4 — Release preparation and release

- Candidate detection and selection.
- Additive snapshot assembly.
- `temp-tca-release/<version>` lifecycle.
- Stale-source protection.
- Required release-note generation and editing.
- Calculated-but-editable project versions.
- Optional pre-release creation.
- Idempotent retry and release lookup.
- Pre-release promotion.

## Phase 5 — Hardening

- Accessibility verification against WCAG 2.2 AA target.
- Security review of OAuth, sessions, CSRF, upload paths, and diagnostics.
- Failure-mode and retry testing.
- Performance testing with portfolios above 100 repositories.
- Future-localization architecture review.
- Production deployment and operational runbook.

## Deferred scope

- Bible Passage Sets.
- Deeper file-content validation.
- Translation editing and suggestions.
- Assignment and issue management.
- Coordinated multi-repository/union releases.
- Pull requests and translation-content merge resolution.
- Rich historical progress metrics beyond book/story coverage.
- User-configurable progress definitions.

## Future extension seams

- Add project-type adapters for Passage Sets without changing the project portfolio model.
- Add content validators behind the existing health adapter.
- Add a work-management context referencing Projects and Books/Stories.
- Add coordinated release orchestration above the single-project release service.
- Add localized UI strings without changing domain terminology or Door43 data.
