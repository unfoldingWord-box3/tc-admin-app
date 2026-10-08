// What counts as a token in what the browser can see (A1, #10). Pure, so the
// classifier is tested offline, without QA or credentials (a1-oracle.spec.ts).

/** A Door43 access token's look: Gitea issues 40 hexadecimal characters; an OAuth JWT is three base64url parts. */
const TOKEN_SHAPES = [/\b[0-9a-f]{40}\b/i, /\beyJ[\w-]+\.[\w-]+\.[\w-]+/];

export const looksLikeToken = (text: string): boolean => /access_token|refresh_token|id_token|bearer/i.test(text) || TOKEN_SHAPES.some(shape => shape.test(text));

/**
 * Whether a URL's query or fragment carries a token (paths hold commit SHAs, so only parameters are read). On the
 * callback's own document URL, and only there, Door43's one-time `code` and `state` are expected and pass; anywhere
 * else they are read like any other parameter (bench round 3 on #144).
 */
export function urlCarriesToken(raw: string, isCallback: boolean): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return looksLikeToken(raw);
  }
  const params = [...url.searchParams, ...new URLSearchParams(url.hash.slice(1))];
  return params.some(([name, value]) => !(isCallback && ['code', 'state'].includes(name)) && looksLikeToken(`${name}=${value}`));
}

/** Whether a URL is the app's own `/auth/callback`. */
export function isCallbackUrl(raw: string, appOrigin: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === appOrigin && url.pathname === '/auth/callback';
  } catch {
    return false;
  }
}
