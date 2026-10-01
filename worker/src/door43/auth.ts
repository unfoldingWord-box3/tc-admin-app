// Door43 OAuth, carried over from the prototype and moved to Web Crypto: the
// authorization request with PKCE S256 and the server-side code exchange
// (ADR 0001). The client secret, when the application is confidential, is
// sent only in the exchange. Sessions that hold the token are #12.

import { CatalogError } from '@tc-admin/shared/schema';
import { door43Request } from './api';
import type { Fetch } from './api';
import type { Door43Host } from './host';

/** The token permissions every Milestone 1 operation needs (Q10, E26, E27). */
export const SCOPES = 'read:user write:repository write:organization';

/** The longest a Door43 token is held, whatever Door43 grants: eight hours. */
const MAX_TOKEN_SECONDS = 28_800;

export interface OAuthClient {
  host: Door43Host;
  clientId: string;
  /** Present for a confidential client; never sent to the browser. */
  clientSecret?: string;
}

export interface PendingLogin {
  state: string;
  verifier: string;
  redirectUri: string;
  /** The Door43 authorization URL to send the browser to. */
  url: string;
  createdAt: number;
}

export interface Door43Token {
  token: string;
  expiresAt: number;
}

/** 32 random bytes, base64url. */
export function nonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export async function beginLogin(client: OAuthClient, redirectUri: string, now = Date.now()): Promise<PendingLogin> {
  const verifier = nonce();
  const state = nonce();
  const url = new URL('/login/oauth/authorize', client.host.origin);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: redirectUri,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
    scope: SCOPES,
    state,
  }).toString();
  return { state, verifier, redirectUri, url: url.href, createdAt: now };
}

/** Exchanges the authorization code server-side. A refusal or a missing token means signing in again. */
export async function exchangeCode(client: OAuthClient, pending: PendingLogin, code: string, fetcher?: Fetch, now = Date.now()): Promise<Door43Token> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: client.clientId,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  const response = await door43Request(
    client.host,
    new URL('/login/oauth/access_token', client.host.origin).href,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body },
    fetcher,
  );
  if (!response.ok) throw new CatalogError('session_expired', { details: { door43_status: response.status } });
  const token = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof token.access_token !== 'string' || !token.access_token) throw new CatalogError('session_expired');
  const seconds = Math.min(Number(token.expires_in) || 3600, MAX_TOKEN_SECONDS);
  return { token: token.access_token, expiresAt: now + seconds * 1000 };
}
