// The Worker's bindings and variables (wrangler.jsonc, docs/deployment.md §1).
// Only the members tC Admin calls are declared.

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The static-assets binding: the built `web/` app. */
export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  SESSIONS: KVNamespace;
  PLANS: KVNamespace;
  /** `https://qa.door43.org` or `https://git.door43.org`. */
  DOOR43_ORIGIN: string;
  /** Runtime secrets, set per Worker in the Cloudflare dashboard (deployment.md §3). */
  DOOR43_CLIENT_ID?: string;
  DOOR43_CLIENT_SECRET?: string;
  SESSION_SIGNING_KEY?: string;
}
