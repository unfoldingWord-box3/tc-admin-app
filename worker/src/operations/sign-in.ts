// Sign-in for the HTTP projection (ADR 0001, architecture §3 Authentication):
// not catalog operations, because the browser follows them, but the only path
// from `http/session.ts` to Door43's OAuth endpoints. Starting returns the
// pending login to keep server-side and the Door43 URL to send the browser to;
// completing exchanges the code and resolves the account, and returns what the
// session holds. The session's token reaches Door43 through `operationContext`.

import { beginLogin, exchangeCode, nonce, readAccount } from '../door43/auth';
import type { OAuthClient, PendingLogin } from '../door43/auth';
import { door43Host } from '../door43/host';

export interface SignInConfig {
  door43Origin: string;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

export type PendingSignIn = PendingLogin;

/** What a session holds. Read only by the Worker; never serialized into a response (A1). */
export interface SessionRecord {
  token: string;
  expiresAt: number;
  account: { login: string; name: string };
  userId: number;
  /** The session's CSRF token, which every browser mutation must carry (A4); issued to the browser in a response header only. */
  csrf: string;
}

function oauthClient(config: SignInConfig): OAuthClient | null {
  if (!config.clientId) return null;
  const client: OAuthClient = { host: door43Host(config.door43Origin), clientId: config.clientId };
  if (config.clientSecret) client.clientSecret = config.clientSecret;
  return client;
}

/** `null` when this deployment has no Door43 OAuth client id. */
export async function beginSignIn(config: SignInConfig, redirectUri: string): Promise<PendingSignIn | null> {
  const client = oauthClient(config);
  return client ? beginLogin(client, redirectUri) : null;
}

/** Exchanges the code server-side and reads `/user` with the new token. */
export async function completeSignIn(config: SignInConfig, pending: PendingSignIn, code: string): Promise<SessionRecord> {
  const client = oauthClient(config);
  if (!client) throw new Error('sign-in is not configured');
  const token = await exchangeCode(client, pending, code);
  const { account, userId } = await readAccount({ host: client.host, token: token.token });
  return { token: token.token, expiresAt: token.expiresAt, account, userId, csrf: nonce() };
}

/** An opaque session id: 32 random bytes, base64url. */
export const newSessionId = nonce;
