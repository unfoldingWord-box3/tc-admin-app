import { defineConfig } from 'vite';

// `npm run dev --workspace web` serves the app with reloads and sends `/api/`
// and `/auth/` to the Worker that `npx wrangler dev` runs on its default port.
// `wrangler dev` gives the Worker its own address whatever the Host header,
// so sign-in returns to `http://127.0.0.1:8787/auth/callback` (registered,
// E38) and ends on that page; the session cookie is for 127.0.0.1 on every
// port, so this page is signed in too. The Worker refuses a mutation whose
// Origin is not its own address (A4), so the proxy presents the Worker's
// origin in place of this page's, which is what the Worker sees when it
// serves the page itself.
const worker = 'http://127.0.0.1:8787';
interface ProxiedRequest {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string): unknown;
}
const toWorker = {
  target: worker,
  configure: (proxy: { on: (event: 'proxyReq', listener: (request: ProxiedRequest) => void) => void }) => {
    proxy.on('proxyReq', request => {
      if (request.getHeader('origin') !== undefined) request.setHeader('origin', worker);
    });
  },
};

export default defineConfig({
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': toWorker, '/auth': toWorker } },
});
