import { defineConfig } from 'vite';

// `npm run dev --workspace web` serves the app with reloads and sends `/api/`
// and `/auth/` to the Worker that `npx wrangler dev` runs on its default port.
// `wrangler dev` gives the Worker its own address whatever the Host header,
// so sign-in returns to `http://127.0.0.1:8787/auth/callback` (registered,
// E38) and ends on that page; the session cookie is for 127.0.0.1 on every
// port, so this page is signed in too.
export default defineConfig({
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8787', '/auth': 'http://127.0.0.1:8787' } },
});
