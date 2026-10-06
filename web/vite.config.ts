import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// `npm run dev --workspace web` serves the app with reloads and sends `/api/`
// and `/auth/` to the Worker that `npx wrangler dev` runs on its default port.
// `wrangler dev` gives the Worker its own address whatever the Host header,
// so sign-in returns to `http://127.0.0.1:8787/auth/callback` (registered,
// E38) and ends on that page; the session cookie is for 127.0.0.1 on every
// port, so this page is signed in too. The Worker refuses a mutation whose
// Origin is not its own address (A4), so the dev server presents the
// Worker's origin in place of this page's on everything it forwards, which
// is what the Worker sees when it serves the page itself. It is done on the
// incoming request, ahead of the proxy: Vite 8's proxy (http-proxy-3) copies
// the headers when it creates the outgoing request and emits `proxyReq` only
// once that request has a socket, after Node has serialized them, so a
// `setHeader` in that hook reports success and changes nothing on the wire
// (observed with wrangler dev, 6 October 2026).
const worker = 'http://127.0.0.1:8787';
const forwarded = /^\/(api|auth)(\/|\?|$)/;

const workerOrigin = (): Plugin => ({
  name: 'tc-admin-worker-origin',
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (forwarded.test(request.url ?? '') && request.headers.origin !== undefined) request.headers.origin = worker;
      next();
    });
  },
});

export default defineConfig({
  plugins: [workerOrigin()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': worker, '/auth': worker } },
});
