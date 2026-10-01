// The prototype's OAuth tests, carried over (#7) with the Milestone 1 scopes (Q10).
import { describe, expect, test } from 'vitest';
import { SCOPES, beginLogin, exchangeCode } from '../../src/door43/auth';
import type { Fetch } from '../../src/door43/api';
import { door43Host } from '../../src/door43/host';

const host = door43Host('https://qa.door43.org');
const redirectUri = 'https://tc-admin-qa.unfoldingword.workers.dev/auth/callback';

describe('sign-in', () => {
  test('OAuth sends the Milestone 1 scopes and PKCE S256 to the configured origin', async () => {
    const flow = await beginLogin({ host, clientId: 'test-client' }, redirectUri);
    const url = new URL(flow.url);
    expect(url.origin).toBe('https://qa.door43.org');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('read:user write:repository write:organization');
    expect(SCOPES).toBe(url.searchParams.get('scope'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(flow.state);
    expect(url.searchParams.get('code_challenge')).not.toBe(flow.verifier);
    expect(flow.verifier.length).toBeGreaterThanOrEqual(43);
  });

  test('the code challenge is the base64url SHA-256 of the verifier', async () => {
    const flow = await beginLogin({ host, clientId: 'c' }, redirectUri);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(flow.verifier)));
    const expected = Buffer.from(digest).toString('base64url');
    expect(new URL(flow.url).searchParams.get('code_challenge')).toBe(expected);
  });

  test('A1: token exchange sends the client secret only when configured, and only to Door43', async () => {
    let body = new URLSearchParams();
    const fetch: Fetch = async (url, init) => {
      expect(new URL(url).href).toBe('https://qa.door43.org/login/oauth/access_token');
      body = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({ access_token: 't', expires_in: 60 }));
    };
    const pending = { state: 's', verifier: 'v', redirectUri, url: '', createdAt: 0 };
    await exchangeCode({ host, clientId: 'c' }, pending, 'code', fetch);
    expect(body.has('client_secret')).toBe(false);
    await exchangeCode({ host, clientId: 'c', clientSecret: 's3cret' }, pending, 'code', fetch);
    expect(body.get('client_secret')).toBe('s3cret');
    expect(body.get('code_verifier')).toBe('v');
  });

  test('A1: a token is held for at most eight hours, and a refused exchange means signing in again', async () => {
    const pending = { state: 's', verifier: 'v', redirectUri, url: '', createdAt: 0 };
    const long: Fetch = async () => new Response(JSON.stringify({ access_token: 't', expires_in: 999_999 }));
    expect((await exchangeCode({ host, clientId: 'c' }, pending, 'code', long, 0)).expiresAt).toBe(28_800_000);
    const refused: Fetch = async () => new Response('', { status: 400 });
    await expect(exchangeCode({ host, clientId: 'c' }, pending, 'code', refused)).rejects.toMatchObject({ code: 'session_expired' });
  });
});
