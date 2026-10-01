import { defineConfig } from 'vite';

// `npm run dev --workspace web` serves the app with reloads and sends `/api/`
// to the Worker that `npx wrangler dev` runs on its default port.
export default defineConfig({
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
