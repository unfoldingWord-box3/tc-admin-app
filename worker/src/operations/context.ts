// What every operation receives besides its input: the configured Door43 host,
// whether sign-in is configured, the signed-in session's Door43 client, the
// plan store, the application's name and version for the metadata it writes
// (`meta.generator`, W1), and the request id that its receipt or error
// carries (X2).

import { CatalogError } from '@tc-admin/shared/schema';
import pkg from '../../../package.json' with { type: 'json' };
import type { Door43Client } from '../door43/api';
import { door43Host } from '../door43/host';
import type { Door43Host } from '../door43/host';
import type { KVNamespace } from '../env';
import { planStore } from './plans';
import type { PlanStore } from './plans';

/** tC Admin as the generator of the metadata it writes: the name, and the version from the root package.json. */
export const APPLICATION = { name: 'tC Admin', version: pkg.version } as const;

export interface OperationContext {
  host: Door43Host;
  /** A Door43 OAuth client id is configured for this host. */
  configured: boolean;
  /** The session's Door43 client, carrying its token only (A3); `null` when no one is signed in. */
  door43: Door43Client | null;
  plans: PlanStore;
  application: { name: string; version: string };
  requestId: string;
  now: () => Date;
}

export interface DeploymentConfig {
  door43Origin: string;
  door43ClientId?: string | undefined;
}

/**
 * The context of one request. Throws when the deployment names a Door43 host other
 * than QA or production. `token` is the signed-in session's Door43 token; its client
 * carries that token and no other credential (A3).
 */
export function operationContext(config: DeploymentConfig, requestId: string, token: string | null, plans: KVNamespace): OperationContext {
  const host = door43Host(config.door43Origin);
  return {
    host,
    configured: Boolean(config.door43ClientId),
    door43: token ? { host, token } : null,
    plans: planStore(plans),
    application: APPLICATION,
    requestId,
    now: () => new Date(),
  };
}

/** The session's Door43 client, for an operation that needs a signed-in manager. */
export function signedIn(context: OperationContext): Door43Client {
  if (!context.door43) throw new CatalogError('session_expired');
  return context.door43;
}
