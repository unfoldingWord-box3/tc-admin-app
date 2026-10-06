// An apply carries its plan id as the `Idempotency-Key` header as well as in
// its body (operations.md §7). The two must agree: a header that names another
// plan is a client defect and is refused before the operation runs, so an
// apply never acts on one plan while claiming another's key.

import { CatalogError, IDEMPOTENCY_HEADER } from '@tc-admin/shared/schema';
import type { Context } from 'hono';
import type { App } from './app';

export function checkIdempotencyKey(c: Context<App>, input: Record<string, unknown>): void {
  const key = c.req.header(IDEMPOTENCY_HEADER);
  if (key === undefined || typeof input.plan_id !== 'string') return;
  if (key !== input.plan_id) {
    throw new CatalogError('validation_failed', {
      message: 'plan_id: the Idempotency-Key header names another plan.',
      details: { fields: [{ path: 'plan_id', message: 'the Idempotency-Key header names another plan' }] },
    });
  }
}
