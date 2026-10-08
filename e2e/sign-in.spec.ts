// A1 end to end (#10): signing in with Door43 QA as the test user lands on the
// portfolio, and the Door43 token never reaches the browser: not in storage,
// not in the address bar, not in any request the page makes after the sign-in,
// and not in a cookie a script can read. The session cookie is HttpOnly and
// SameSite, and holds an opaque id only (worker/src/http/session.ts). Nothing
// is written to Door43.

import { expect, test } from '@playwright/test';

const user = process.env.TEST_USER;
const password = process.env.TEST_PASSWORD;

/** A Door43 access token's look: Gitea issues 40 hexadecimal characters; an OAuth JWT is three base64url parts. */
const TOKEN_SHAPES = [/\b[0-9a-f]{40}\b/i, /\beyJ[\w-]+\.[\w-]+\.[\w-]+/];
const looksLikeToken = (text: string) => /access_token|refresh_token|bearer/i.test(text) || TOKEN_SHAPES.some(shape => shape.test(text));

test.skip(!user || !password, 'TEST_USER and TEST_PASSWORD are needed (E23); set them in the root .env');

test('A1: a sign-in on QA lands on the portfolio, and no token reaches storage, the address, a request URL, or a readable cookie', async ({ page, context, baseURL }) => {
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  await page.getByRole('link', { name: /Sign in with Door43 QA/ }).click();

  // Door43 may show its sign-in form, then its grant page (the first time the account authorizes the application), or return
  // straight away when it remembers both; whichever appears is answered. Door43 passes through /login/oauth/authorize first,
  // so the page is waited on, not its address.
  const username = page.getByRole('textbox', { name: /Username or Email/ });
  const authorize = page.getByRole('button', { name: /authorize application/i });
  const signedIn = page.getByRole('button', { name: 'Sign out' });
  await expect(username.or(authorize).or(signedIn)).toBeVisible({ timeout: 30_000 });
  if (await username.isVisible()) {
    await username.fill(user!);
    await page.getByRole('textbox', { name: 'Password' }).fill(password!);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(authorize.or(signedIn)).toBeVisible({ timeout: 30_000 });
  }
  if (await authorize.isVisible()) await authorize.click();

  // Back on tC Admin, signed in: the account's name and the portfolio.
  await page.waitForURL(url => url.origin === new URL(baseURL!).origin, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Read from Door43/)).toBeVisible({ timeout: 60_000 });

  // A1: the address bar holds no code, state, or token once the callback is done.
  const address = page.url();
  expect(address, address).not.toMatch(/[?&#](code|state|access_token|token)=/);

  // A1: nothing in either storage looks like a token.
  const storage = await page.evaluate(() => {
    const all: Record<string, string> = {};
    for (const area of [window.localStorage, window.sessionStorage]) for (let i = 0; i < area.length; i++) all[area.key(i)!] = area.getItem(area.key(i)!) ?? '';
    return all;
  });
  for (const [key, value] of Object.entries(storage)) expect(looksLikeToken(`${key}=${value}`), `storage ${key}`).toBe(false);

  // A1: a script can read no cookie at all; the session cookie is HttpOnly, SameSite, Secure on https, and opaque.
  expect(await page.evaluate(() => document.cookie)).toBe('');
  const session = (await context.cookies(baseURL!)).find(cookie => cookie.name === 'tca_session');
  expect(session, 'the session cookie').toBeDefined();
  expect(session!.httpOnly).toBe(true);
  expect(['Lax', 'Strict']).toContain(session!.sameSite);
  if (baseURL!.startsWith('https:')) expect(session!.secure).toBe(true);

  // A1: no request after the sign-in carries a token in its URL; the callback's one-time code is Door43's, not a token.
  const afterCallback = requested.slice(requested.findIndex(url => url.includes('/auth/callback')) + 1);
  for (const url of afterCallback) expect(looksLikeToken(url), url).toBe(false);
});
