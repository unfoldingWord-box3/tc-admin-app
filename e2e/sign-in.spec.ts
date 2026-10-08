// A1 end to end (#10): signing in with Door43 QA as the test user lands on the
// portfolio, and the Door43 token never reaches the browser: not in storage,
// not in the address bar, not in the callback URL Door43 redirects to (its
// fragment included, which no network request carries) or any app address
// after it, not in any request from the callback on, and not in a cookie a
// script can read. The session cookie is HttpOnly and
// SameSite, and holds an opaque id only (worker/src/http/session.ts). Nothing
// is written to Door43.

import { expect, test } from '@playwright/test';
import { isCallbackUrl, looksLikeToken, urlCarriesToken } from './a1-oracle';
import { clearedOnFailure, fillSecret } from './secret';

const user = process.env.TEST_USER;
const password = process.env.TEST_PASSWORD;

/** The password is typed, and the grant given, only on this origin: the QA host, over https (bench, #144). */
const DOOR43_QA = 'https://qa.door43.org';

test.skip(!user || !password, 'TEST_USER and TEST_PASSWORD are needed (E23); set them in the root .env');

test('A1: a sign-in on QA lands on the portfolio, and no token reaches storage, the address, a request URL, or a readable cookie', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  // Where a fragment would be (bench round 3 on #144): a request's URL never carries one, and /auth/callback never becomes a
  // page (the Worker answers it with a redirect, so no document is committed there). Door43 sends the browser to the
  // callback by a redirect whose Location is the full callback URL, fragment and all, where an implicit or hybrid grant
  // would put a token; and a fragment the Worker's own redirect does not replace carries on to the next address. So every
  // redirect Location that points at the app, and every address the browser commits on the app, is kept to be read.
  const callbackTargets: string[] = [];
  const appAddresses: string[] = [];
  page.on('response', response => {
    const location = response.headers()['location'];
    if (!location) return;
    const target = new URL(location, response.url()).href;
    if (isCallbackUrl(target, origin)) callbackTargets.push(target);
    else if (new URL(target).origin === origin) appAddresses.push(target);
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && new URL(frame.url()).origin === origin) appAddresses.push(frame.url());
  });

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
    expect(new URL(page.url()).origin, 'the sign-in form is on Door43 QA, over https').toBe(DOOR43_QA);
    await username.fill(user!);
    // Never `fill` directly: a failed fill's error names the password, and the reporter prints it (bench round 2). And if
    // anything after the typing fails, the field is emptied first: a failed test's page snapshot shows what it holds (round 3).
    const passwordField = page.getByRole('textbox', { name: 'Password' });
    await fillSecret(passwordField, password!, 'the password');
    await clearedOnFailure(passwordField, async () => {
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(authorize.or(signedIn)).toBeVisible({ timeout: 30_000 });
    });
  }
  if (await authorize.isVisible()) {
    expect(new URL(page.url()).origin, 'the grant page is on Door43 QA, over https').toBe(DOOR43_QA);
    await authorize.click();
  }

  // Back on tC Admin, signed in: the account's name and the portfolio.
  await page.waitForURL(url => url.origin === new URL(baseURL!).origin, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Read from Door43/)).toBeVisible({ timeout: 60_000 });

  // A1: the address bar holds no code, state, or token once the callback is done. Every A1 assertion below compares a
  // boolean under a fixed message, so a failure never prints the URL, storage value, or cookie that carried the token.
  const address = page.url();
  expect(/[?&#](code|state)=/.test(address) || urlCarriesToken(address, false), 'the address holds a code, state, or token').toBe(false);

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

  // A1: the sign-in returned through tC Admin's /auth/callback. Its document URL, query and fragment, carries no token; its
  // one-time code and state are Door43's and pass there, and only there. No request URL from the callback on carries a token,
  // with code and state read like any parameter everywhere but the callback itself. No token exists before the callback.
  expect(callbackTargets.length, 'Door43 redirected the browser to /auth/callback').toBeGreaterThan(0);
  for (const target of callbackTargets) expect(urlCarriesToken(target, true), 'the callback URL Door43 sent carries a token').toBe(false);
  for (const address of appAddresses) expect(urlCarriesToken(address, false), 'an app address after the callback carries a token').toBe(false);
  const callbackAt = requested.findIndex(raw => isCallbackUrl(raw, origin));
  expect(callbackAt, 'a request to /auth/callback').toBeGreaterThanOrEqual(0);
  for (const url of requested.slice(callbackAt)) expect(urlCarriesToken(url, isCallbackUrl(url, origin)), 'a request URL carries a token').toBe(false);
});
