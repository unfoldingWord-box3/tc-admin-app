// What every operation receives besides its input: the configured Door43 host,
// whether sign-in is configured, and the request id that its receipt or error
// carries (X2).

import { door43Host } from '../door43/host';
import type { Door43Host } from '../door43/host';

export interface OperationContext {
  host: Door43Host;
  /** A Door43 OAuth client id is configured for this host. */
  configured: boolean;
  requestId: string;
  now: () => Date;
}

export interface DeploymentConfig {
  door43Origin: string;
  door43ClientId?: string | undefined;
}

/** Throws when the deployment names a Door43 host other than QA or production. */
export function operationContext(config: DeploymentConfig, requestId: string): OperationContext {
  return { host: door43Host(config.door43Origin), configured: Boolean(config.door43ClientId), requestId, now: () => new Date() };
}
