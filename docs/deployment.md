# tC Admin Build, Check, and Deploy

Status: proposed 22 September 2026, revised the same day for Cloudflare's Git integration after reading its documentation (Workers Builds, Git integration, Version URLs, monorepo and environments pages, all dated September 2026). Dashboard paths are as documented there; verify when performing them.
Audience: Rich (Cloudflare account owner), the engineer, and the agent

## 1. Shape

One Wrangler configuration at the repository root with two environments, which Cloudflare sees as two Workers:

| Worker | Wrangler environment | Door43 host | URL | Deploys when |
| --- | --- | --- | --- | --- |
| `tc-admin-qa` | `qa` | `https://qa.door43.org` | `https://tc-admin-qa.unfoldingword.workers.dev` | a commit lands on `main` |
| `tc-admin` | `production` | `https://git.door43.org` | `https://tc-admin.unfoldingword.workers.dev`, later the custom domain (#53) | a commit lands on the protected `production` branch |

The account's `workers.dev` subdomain is `unfoldingword` (confirmed by Rich, 22 September 2026). The account already runs this shape for translationCore mobile: `tc-mobile-staging.unfoldingword.workers.dev` and `tc-mobile.unfoldingword.workers.dev`, both connected to `unfoldingWord/tc-mobile`; tC Admin mirrors it. The OAuth callback path is `/auth/callback` on each URL (#2).

Each Worker has its own KV namespaces (`SESSIONS`, `PLANS`) and its own runtime secrets (`DOOR43_CLIENT_ID`, `DOOR43_CLIENT_SECRET`, `SESSION_SIGNING_KEY`). The Door43 OAuth applications (#2) register each Worker's URL as a redirect URI.

## 2. How deployment works: Cloudflare's Git integration

Cloudflare's **Workers Builds** connects a Worker to a GitHub repository. On every push, Cloudflare clones the repository, runs a build command, then a deploy command, and records the result as a GitHub check run and, on pull requests, as a comment. Cloudflare generates and holds the API token it needs; nobody creates one and nothing goes into GitHub secrets. Deploying is therefore the same act as merging:

- **Pull request opened or updated** → the `tc-admin-qa` Worker runs a **preview build** (`npx wrangler preview --env qa`), which creates a Preview at a URL that is stable for that branch and posts it on the pull request. Previews do not touch the live QA deployment.
- **Merge to `main`** → the `tc-admin-qa` Worker runs its deploy command (`npx wrangler deploy --env qa`). QA is always the head of `main`.
- **Merge to `production`** → the `tc-admin` Worker runs `npx wrangler deploy --env production`. The `production` branch is protected: only a pull request from `main`, reviewed by Rich, can move it. That review is the production approval.

GitHub Actions (`.github/workflows/check.yml`) keeps running the tests and the document check on every pull request and stays the merge gate. Cloudflare only builds and deploys.

Two consequences to know about:

- **Door43 sign-in on a preview.** Door43 OAuth requires the exact redirect URI. Preview URLs differ per branch, so sign-in works on QA (`main`) and production, not on an arbitrary preview, unless that preview's URL is registered on the QA OAuth application. Previews are for reviewing the interface and anything that runs against fixtures; sign-in is verified on QA after merge. If a long-lived branch needs sign-in, register its preview URL once.
- **Worker names must match.** Cloudflare requires the Worker's name in the dashboard to equal the name in the Wrangler configuration in the chosen root directory, which is why the configuration lives at the repository root with `name = "tc-admin"` and Wrangler's environment naming produces `tc-admin-qa` for `--env qa`.

## 3. One-time setup, in order

Nothing here can happen before #7 merges a Wrangler configuration and a minimal Worker, because a connected repository with nothing to build fails on every push.

**Now (Rich, five minutes):**

1. **Find the subdomain.** Done: `unfoldingword`, recorded in section 1.
2. **Create four KV namespaces.** Storage & Databases → KV → Create: `tc-admin-qa-sessions`, `tc-admin-qa-plans`, `tc-admin-sessions`, `tc-admin-plans`. Each gets an id; send the four ids to the agent (they are identifiers, not secrets) for the Wrangler configuration in #7.

**After #7 merges (Rich, from a clone of the repository, once):**

3. **Create the two Workers with Wrangler.** Cloudflare's documented path for Wrangler environments is to deploy once with Wrangler so the environment Workers exist, then connect the repository to each:

   ```
   npm ci
   npx wrangler login
   npx wrangler deploy --env qa
   npx wrangler deploy --env production
   ```

   This creates `tc-admin-qa` and `tc-admin` in the dashboard.
4. **Connect the repository to each Worker.** Workers & Pages → the Worker → Settings → Builds → Connect → choose the GitHub account and `unfoldingWord-box3/tc-admin-app`. The first time, GitHub asks to install the "Cloudflare Workers and Pages" app; grant it access to this repository only. Then set, per Worker:

   | Setting | `tc-admin-qa` | `tc-admin` |
   | --- | --- | --- |
   | Production branch | `main` | `production` |
   | Root directory | repository root | repository root |
   | Build command | `npm ci && npm run build` | `npm ci && npm run build` |
   | Deploy command | `npx wrangler deploy --env qa` | `npx wrangler deploy --env production` |
   | Preview builds | enabled, `npx wrangler preview --env qa` | disabled |

5. **Runtime secrets, per Worker.** Workers & Pages → the Worker → Settings → Variables and Secrets → add `DOOR43_CLIENT_ID`, `DOOR43_CLIENT_SECRET` (from #2's OAuth applications, QA values on `tc-admin-qa`, production values on `tc-admin`), and `SESSION_SIGNING_KEY` (32 or more random bytes, base64; different per Worker). Secrets live only in Cloudflare.
6. **Protect the `production` branch on GitHub.** Repository → Settings → Branches → Add rule for `production`: require a pull request, require Rich's review. The agent creates the branch from `main` once the QA deployment is verified.

Never paste a secret into a chat with an agent. If a value must reach an agent session, it goes into the session environment's configuration as an environment variable.

## 4. Who does what

- The agent commits, pushes, opens pull requests, and, when asked, merges pull requests whose checks are green. Merging to `main` deploys QA; nobody deploys QA by hand.
- A production release is a pull request from `main` to `production`. Rich reviews and merges it; Cloudflare deploys.
- Rich merges anything that changes an ADR or an invariant, unless he says otherwise.
- Wrangler runs locally only for step 3 and for `wrangler dev`.

## 5. Local development

Copy `.env.example` (created by #7) to `.env` with the QA OAuth client, then `npm run dev` runs the Worker and the web app locally against QA. The QA test user's credentials (`TEST_ORG`, `TEST_USER`, `TEST_PASSWORD`, `TEST_TOKEN`, E23) are for probes and the Playwright smoke test, never for the application itself, which always acts as the signed-in manager (A3).

## Appendix: deploying from GitHub Actions instead

If the Git integration is ever unavailable, the alternative is a GitHub Actions workflow running Wrangler with an account-scoped API token (Cloudflare: My Profile → API Tokens → *Edit Cloudflare Workers* template plus Workers KV Storage: Edit) stored as the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, with a `production` GitHub environment requiring Rich's review. Previews would use `npx wrangler versions upload --env qa --preview-alias preview`, giving one fixed URL `preview-tc-admin-qa.<subdomain>.workers.dev` that the QA OAuth application can register. Everything else in this document stays the same.
