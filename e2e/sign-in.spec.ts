// A1 end to end (#10): signing in with Door43 QA as the test user lands on the
// portfolio, and the Door43 token never reaches the browser: not in storage,
// not in the address bar, not in any request the page makes after the sign-in,
// and not in a cookie a script can read. The session cookie is HttpOnly and
// SameSite, and holds an opaque id only (worker/src/http/session.ts). Nothing
// is written to Door43.

import { expect, test } from '@playwright/test';
import { fillSecret } from './secret';

const user = process.env.TEST_USER;
const password = process.env.TEST_PASSWORD;

/** A Door43 access token's look: Gitea issues 40 hexadecimal characters; an OAuth JWT is three base64url parts. */
const TOKEN_SHAPES = [/\b[0-9a-f]{40}\b/i, /\beyJ[\w-]+\.[\w-]+\.[\w-]+/];
const looksLikeToken = (text: string) => /access_token|refresh_token|bearer/i.test(text) || TOKEN_SHAPES.some(shape => shape.test(text));
/** A URL's query and hash parameters, every one but the callback's one-time `code` and `state`, through the token shapes (paths hold commit SHAs). */
const urlCarriesToken = (raw: string) => {
  const url = new URL(raw);
  const params = [...url.searchParams, ...new URLSearchParams(url.hash.slice(1))];
  return params.some(([name, value]) => !['code', 'state'].includes(name) && looksLikeToken(`${name}=${value}`));
};
/** The password is typed, and the grant given, only on this host. */
const DOOR43_QA = 'qa.door43.org';

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
  // Door43 QA's bot check (Anubis) answers a browser it refuses with "Oh noes!" (E70): that is said plainly, not left to a timeout.
  const denied = page.getByRole('heading', { name: /Oh noes/i });
  await expect(username.or(authorize).or(signedIn).or(denied)).toBeVisible({ timeout: 30_000 });
  expect(await denied.isVisible(), "Door43 QA's bot check (Anubis) denied this browser; run headed (E70)").toBe(false);
  if (await username.isVisible()) {
    expect(new URL(page.url()).host, 'the sign-in form is on Door43 QA').toBe(DOOR43_QA);
    await username.fill(user!);
    // Never `fill` directly: a failed fill's error names the password, and the reporter prints it (bench round 2).
    await fillSecret(page.getByRole('textbox', { name: 'Password' }), password!, 'the password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(authorize.or(signedIn)).toBeVisible({ timeout: 30_000 });
  }
  if (await authorize.isVisible()) {
    expect(new URL(page.url()).host, 'the grant page is on Door43 QA').toBe(DOOR43_QA);
    await authorize.click();
  }

  // Back on tC Admin, signed in: the account's name and the portfolio.
  await page.waitForURL(url => url.origin === new URL(baseURL!).origin, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Read from Door43/)).toBeVisible({ timeout: 60_000 });

  // A1: the address bar holds no code, state, or token once the callback is done. Every A1 assertion below compares a
  // boolean under a fixed message, so a failure never prints the URL, storage value, or cookie that carried the token.
  const address = page.url();
  expect(/[?&#](code|state)=/.test(address) || urlCarriesToken(address), 'the address holds a code, state, or token').toBe(false);

  // A1: nothing in either storage looks like a token; each area's entries are read separately, so no key hides another.
  const stored = await page.evaluate(() => [window.localStorage, window.sessionStorage].flatMap(area => Object.keys(area).map(key => `${key}=${area.getItem(key) ?? ''}`)));
  for (const entry of stored) expect(looksLikeToken(entry), 'a storage entry looks like a token').toBe(false);

  // A1: a script can read no cookie at all; the session cookie is HttpOnly, SameSite, Secure on https, and opaque.
  expect(await page.evaluate(() => document.cookie === ''), 'a script can read a cookie').toBe(true);
  const session = (await context.cookies(baseURL!)).find(cookie => cookie.name === 'tca_session');
  expect(session, 'the session cookie').toBeDefined();
  expect(session!.httpOnly).toBe(true);
  expect(['Lax', 'Strict']).toContain(session!.sameSite);
  if (baseURL!.startsWith('https:')) expect(session!.secure).toBe(true);
  expect(looksLikeToken(session!.value), 'the session cookie value looks like a token').toBe(false);

  // A1: the sign-in returned through tC Admin's /auth/callback, and no request URL from that one on (the callback included)
  // carries a token; the callback's one-time code and state are Door43's, not a token. No token exists before the callback.
  const origin = new URL(baseURL!).origin;
  const callbackAt = requested.findIndex(raw => new URL(raw).origin === origin && new URL(raw).pathname === '/auth/callback');
  expect(callbackAt, 'a request to /auth/callback').toBeGreaterThanOrEqual(0);
  for (const url of requested.slice(callbackAt)) expect(urlCarriesToken(url), 'a request URL carries a token').toBe(false);
});
