# tC Admin Build, Check, and Deploy

Status: proposed 22 September 2026; the Cloudflare steps are for Rich to perform once, the rest is what the workflows will do. Dashboard paths are as documented by Cloudflare in 2025 and are to be verified when performed.
Audience: Rich (account owner), the engineer, and the agent

## 1. Shape

One Cloudflare Worker, `tc-admin`, with two Wrangler environments:

| Environment | Door43 host | URL | Deployed by |
| --- | --- | --- | --- |
| `qa` | `https://qa.door43.org` | `tc-admin-qa.<subdomain>.workers.dev` | every merge to `main` |
| `production` | `https://git.door43.org` | `tc-admin.<subdomain>.workers.dev`, later the custom domain (#53) | manual, approved run |

`<subdomain>` is the account's `workers.dev` subdomain, chosen once per account (section 2, step 1). A URL of exactly `tc-admin.workers.dev` would require the account's subdomain itself to be `tc-admin`; the Worker's URL is always `<worker-name>.<subdomain>.workers.dev`.

Each environment has its own Workers KV namespaces (`SESSIONS`, `PLANS`) and its own secrets (`DOOR43_CLIENT_ID`, `DOOR43_CLIENT_SECRET`, `SESSION_SIGNING_KEY`). The Door43 OAuth applications (#2) register the environment URLs as redirect URIs, so the subdomain decision comes before #2.

## 2. One-time Cloudflare setup (Rich)

1. **Choose the `workers.dev` subdomain.** Workers & Pages → Overview → "Your subdomain" (right-hand panel). If the account already has one, keep it. Record it in section 1 above.
2. **Note the Account ID.** Same Overview page, right-hand panel.
3. **Create an API token for deployments.** My Profile → API Tokens → Create Token → start from the *Edit Cloudflare Workers* template. Keep its account scope to this account only. Confirm the token carries at least: Account → Workers Scripts → Edit; Account → Workers KV Storage → Edit; Account → Account Settings → Read; User → User Details → Read (Wrangler uses it for `whoami`). Copy the token once; Cloudflare does not show it again.
4. **Add the GitHub repository secrets.** Repository → Settings → Secrets and variables → Actions → New repository secret: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
5. **Create a `production` GitHub environment with a required reviewer.** Repository → Settings → Environments → New environment `production` → Required reviewers: you. The production deploy job runs only after that approval.
6. **KV namespaces.** Either run these once locally with `CLOUDFLARE_API_TOKEN` in your shell, or tell me and I run them from a one-off workflow once the secrets exist:

   ```
   npx wrangler kv namespace create SESSIONS --env qa
   npx wrangler kv namespace create PLANS --env qa
   npx wrangler kv namespace create SESSIONS --env production
   npx wrangler kv namespace create PLANS --env production
   ```

   Each command prints an `id`; they go into `wrangler.toml` under the matching environment (#7).
7. **Worker secrets, per environment.** After #2 registers the OAuth applications:

   ```
   npx wrangler secret put DOOR43_CLIENT_ID --env qa
   npx wrangler secret put DOOR43_CLIENT_SECRET --env qa
   npx wrangler secret put SESSION_SIGNING_KEY --env qa      # any 32+ random bytes, base64
   ```

   and the same with `--env production`. Secrets never go into GitHub secrets or the repository; they live only in Cloudflare.

Never paste any of these values into a chat with an agent. If a value must reach an agent session, it goes into the session environment's configuration as an environment variable.

## 3. What the workflows do

**`check` (exists): every pull request and every push to `main`.** Runs the document tower check (`scripts/check-docs.mjs`) and the prototype tests. When #7 lands it also runs typecheck, lint, unit tests, and the contract tests against `fixtures/door43/`. A red check blocks merge.

**`preview` (planned with #9): every pull request.** Builds `web/`, then `wrangler versions upload --env qa --preview-alias preview`, which publishes the pull request's code at `preview-tc-admin-qa.<subdomain>.workers.dev` without changing the live QA deployment, and posts that URL as a comment on the pull request. The preview shares the QA environment's KV and secrets. Door43 OAuth needs an exact redirect URI, so the QA OAuth application registers the `preview-…` URL once; one alias means one preview at a time and the newest pull request wins. If we later want one preview per pull request, each alias URL has to be registered as a redirect URI, which is why a single fixed alias is the recommendation.

**`deploy-qa` (planned with #9): every push to `main`.** `wrangler deploy --env qa`. QA is always the head of `main`.

**`deploy-production` (planned with #9): manual.** `workflow_dispatch` on a chosen tag or commit, gated by the `production` environment's required reviewer, then `wrangler deploy --env production`. The Milestone 1 demo and the pilot run on this.

## 4. Who does what

- The agent commits, pushes, opens pull requests, and, when asked, merges pull requests whose checks are green. Rich merges anything that changes an ADR or an invariant, unless he says otherwise.
- Merging to `main` deploys QA automatically. Nobody deploys QA by hand.
- Production deploys are started by a person and approved by Rich.
- Wrangler runs locally only for the one-time setup and for `wrangler dev`.

## 5. Local development

Copy `.env.example` (created by #7) to `.env` with the QA OAuth client, then `npm run dev` runs the Worker and the web app locally against QA. The QA test user's credentials (`TEST_ORG`, `TEST_USER`, `TEST_PASSWORD`, `TEST_TOKEN`, E23) are for probes and the Playwright smoke test, never for the application itself, which always acts as the signed-in manager (A3).
