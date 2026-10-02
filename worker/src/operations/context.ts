// What every operation receives besides its input: the configured Door43 host,
// whether sign-in is configured, the signed-in session's Door43 client, and
// the request id that its receipt or error carries (X2).

import { CatalogError } from '@tc-admin/shared/schema';
import type { Door43Client } from '../door43/api';
import { door43Host } from '../door43/host';
import type { Door43Host } from '../door43/host';

export interface OperationContext {
  host: Door43Host;
  /** A Door43 OAuth client id is configured for this host. */
  configured: boolean;
  /** The session's Door43 client, carrying its token only (A3); `null` when no one is signed in. */
  door43: Door43Client | null;
  requestId: string;
  now: () => Date;
}

export interface DeploymentConfig {
  door43Origin: string;
  door43ClientId?: string | undefined;
}

/** Throws when the deployment names a Door43 host other than QA or production. */
/** `token` is the signed-in session's Door43 token; its client carries that token and no other credential (A3). */
export function operationContext(config: DeploymentConfig, requestId: string, token: string | null = null): OperationContext {
  const host = door43Host(config.door43Origin);
  return { host, configured: Boolean(config.door43ClientId), door43: token ? { host, token } : null, requestId, now: () => new Date() };
}

/** The session's Door43 client, for an operation that needs a signed-in manager. */
export function signedIn(context: OperationContext): Door43Client {
  if (!context.door43) throw new CatalogError('session_expired');
  return context.door43;
}
