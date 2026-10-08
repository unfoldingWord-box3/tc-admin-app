// The one end-to-end test (#10): a real sign-in on QA Door43 as the test user,
// through the deployed QA Worker by default. It needs the network and the
// test user's credentials, so it is not part of `npm run check`; run it with
// `npm run e2e`. Credentials come from the root `.env` (TEST_USER,
// TEST_PASSWORD, E23); without them the test is skipped, never failed.

import { defineConfig, devices } from '@playwright/test';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  // No .env: the test skips itself. Any other failure to read it is said, never turned into a skip.
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    // The QA Worker, whose callback Door43 QA registers (E38); a local `wrangler dev` is http://127.0.0.1:8787.
    baseURL: process.env.E2E_BASE_URL ?? 'https://tc-admin-qa.unfoldingword.workers.dev',
    // Door43 QA sits behind Anubis, which denies a headless browser outright ("Access Denied", observed 8 October 2026,
    // Anubis v1.26.2) and admits a real browser window. The test runs headed, a genuine browser; it never disguises one.
    // E2E_HEADLESS=1 runs headless, for a host that admits it.
    headless: process.env.E2E_HEADLESS === '1',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
