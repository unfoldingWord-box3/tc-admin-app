# tC Admin — QA development build

The local development build connects directly to **https://qa.door43.org**. Login, account reads, repository discovery, and repository links are QA-only. The Ocean title bar displays a persistent gold **QA · DEVELOPMENT** indicator (compact **QA** at narrow widths). There is no production fallback, sample portfolio, or mock account.

## Run

```sh
npm start --prefix prototypes/tc-admin
```

Open http://127.0.0.1:4173. The previous Python static server cannot support login.

## One-time QA OAuth setup

Sign in to https://qa.door43.org/user/settings/applications and register:

- Application name: `tC Admin QA Development`
- Redirect URI: `http://127.0.0.1:4173/auth/callback`
- Public client (Confidential Client unchecked)
- Do not skip the authorization prompt.

Store the public client ID in `prototypes/tc-admin/qa-client.json` as `{"clientId":"YOUR_PUBLIC_CLIENT_ID"}`, or set `DOOR43_QA_CLIENT_ID` when starting the server. The file is ignored by Git and is not served to browsers. No client secret is needed; the login uses PKCE S256. The server rereads the ID when starting login, so a new ID does not require a restart. Refresh the app after setup, then choose **Sign in with Door43 QA**.

The authorization request uses only `read:user read:repository read:organization`. Tokens remain in server memory. The browser receives an opaque HttpOnly, SameSite cookie; QA cookies are named separately from the earlier production prototype. OAuth state expires after ten minutes, is single-use, and is bound to the initiating browser. Restarting the server clears sessions. A production deployment would need HTTPS Secure cookies and its own environment configuration and session storage.

QA is reset from production periodically; the OAuth registration may need to be recreated after a reset. This build requests no production credentials and does not reuse production tokens.

## Portfolio

The server reads the signed-in QA account and its user-scoped repository search. All result pages are read, deduplicated, and restricted to non-archived repositories with explicitly returned push/admin permission. Missing permission does not grant visibility. Unknown health and missing coverage are not shown as healthy or complete. Coverage derives from recognized, existing content entries; an OBS container without individual story entries has unknown coverage.

The connection is read-only. Use **Open in Door43** to manage a project on QA. Creating repositories, uploading files, editing manifests, preparing releases, and triggering health checks are not connected in this build.

## Layouts and checks

`?variant=A` shows cards grouped by owner, `B` a compact registry, and `C` health lanes. Use the bottom arrows to switch.

Run `npm test --prefix prototypes/tc-admin` for QA-origin isolation, PKCE/scopes, expired sessions, pagination, coverage, and health normalization checks.

QA end-to-end verification has been completed with a test account across multiple writable organizations and repositories. The prototype opened a real project on `qa.door43.org`, displayed the QA indicator, and completed authenticated repository discovery. No project mutations were performed.

API references: https://qa.door43.org/swagger.v1.json and https://docs.gitea.com/development/oauth2-provider/ .
