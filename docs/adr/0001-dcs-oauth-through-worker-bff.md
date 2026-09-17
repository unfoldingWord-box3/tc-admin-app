# Use Door43 OAuth through a Worker backend-for-frontend

Status: accepted

tC Admin will use Door43 OAuth with the authorization-code exchange performed by a Cloudflare Worker. The browser receives only a short-lived secure application session; Door43 credentials are never exposed to JavaScript or browser storage. This follows the newer hosted unfoldingWord application pattern and keeps identity, credential handling, retries, and mutation boundaries in one server-side trust boundary rather than repeating them in browser code.
