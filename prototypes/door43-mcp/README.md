# Door43 Field Kit POC

A dependency-free proof of concept for `https://door43.klappy.dev/mcp`.

The primary experience is prompt-first: pick a plain-language canned prompt such as “Find the latest English resources” or “What can this Door43 server do?” and the matching MCP call is filled in and completed for you. Answers render as readable cards, lists, and tables. Technical requests and raw responses stay collapsed unless you explicitly open them. Advanced forms remain available when you need to change a repo, ref, path, projection, continuation token, pin, or query.

The app exposes the server's complete v1 surface in one small UI:

- `docs`: map, recipe index, and raw path lookup
- `execute`: all six recipes plus a raw GET/HEAD form, dry runs, projections, continuation tokens, and pinned reads
- `telemetry`: a safe one-`SELECT` form for the server's own numbers

The local Node bridge handles OAuth discovery, dynamic client registration, PKCE, token exchange, and MCP Streamable HTTP session setup. Access tokens stay in the local server process; the browser never receives a pasted token.

## Run

```bash
npm run dev
```

Open [http://localhost:8787](http://localhost:8787), choose **Connect Door43**, and complete the normal Door43 login. The POC uses the local callback `http://localhost:8787/auth/callback`.

This is intentionally a POC: sessions are in memory, there is no production cookie signing, and the bridge is scoped to the three read-only MCP tools.
