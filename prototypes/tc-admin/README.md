# tC Admin — development prototype

The prototype connects to the Door43 host named in the root `.env` file. QA (`https://qa.door43.org`) is the default and the normal development target; production (`https://git.door43.org`) is allowed for sign-in verification only. The Ocean title bar shows **QA · DEVELOPMENT** or **PROD · PRODUCTION** according to the host. There is no sample portfolio or mock account.

## Configure

Create `.env` at the repository root (it is ignored by Git):

```
DOOR43_ORIGIN=https://qa.door43.org
DOOR43_CLIENT_ID=<client id from the Door43 OAuth2 application>
DOOR43_CLIENT_SECRET=<client secret, only for a confidential client>
```

Keep a second file such as `.env.prod` with the production values and copy it over `.env` when you want to test against production. `npm start` loads `../../.env` with Node's `--env-file-if-exists`, so no extra dependency is needed. `DOOR43_QA_CLIENT_ID` and `qa-client.json` still work as fallbacks for the client id.

## Register the OAuth2 application on Door43

On the chosen host, open Settings → Applications (your account, an organization, or the site admin area) and create an OAuth2 application:

- Redirect URI: `http://127.0.0.1:4173/auth/callback` (exact match, including the port)
- Confidential Client: checked if you will set `DOOR43_CLIENT_SECRET`; unchecked for a public PKCE-only client
- Do not skip the authorization prompt

Door43 never calls this server; the browser carries the redirect, so a local address works without any hosting. Register every redirect URI you will use on the production application, since QA is overwritten from production on each reset.

## Run

```sh
npm start --prefix prototypes/tc-admin
```

Open http://127.0.0.1:4173 and choose **Sign in with Door43**. The startup line reports the host, whether a client id was found, and the exact redirect URI to register.

The authorization request uses only `read:user read:repository read:organization` and PKCE S256; the client secret, when present, is sent only in the server-side token exchange. Tokens remain in server memory. The browser receives an opaque HttpOnly, SameSite cookie named for the host. OAuth state expires after ten minutes, is single-use, and is bound to the initiating browser. Restarting the server clears sessions. A production deployment would need HTTPS Secure cookies and its own session storage.

## Portfolio

The server reads the signed-in QA account and its user-scoped repository search. All result pages are read, deduplicated, and restricted to non-archived repositories with explicitly returned push/admin permission. Missing permission does not grant visibility. Unknown health and missing coverage are not shown as healthy or complete. Coverage derives from recognized, existing content entries; an OBS container without individual story entries has unknown coverage.

The connection is read-only. Use **Open in Door43** to manage a project on QA. Creating repositories, uploading files, editing manifests, preparing releases, and triggering health checks are not connected in this build.

## Layouts and checks

`?variant=A` shows cards grouped by owner, `B` a compact registry, and `C` health lanes. Use the bottom arrows to switch.

Run `npm test --prefix prototypes/tc-admin` for origin isolation, PKCE/scopes, client-secret handling, expired sessions, pagination, coverage, and health normalization checks.

QA end-to-end verification has been completed with a test account across multiple writable organizations and repositories. The prototype opened a real project on `qa.door43.org`, displayed the QA indicator, and completed authenticated repository discovery. No project mutations were performed.

API references: https://qa.door43.org/swagger.v1.json and https://docs.gitea.com/development/oauth2-provider/ .
