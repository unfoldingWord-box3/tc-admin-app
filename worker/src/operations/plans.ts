// Plans live in Workers KV for their lifetime (architecture §3): a plan
// operation stores what its apply needs under the plan id, which is also the
// apply's idempotency key (operations.md §1 rule 6), and the apply reads it
// back, refuses it once expired or made by another account (`plan_expired`),
// and stores its receipt under the same id so a repeated apply answers the
// same receipt and writes nothing more.

import type { KVNamespace } from '../env';

/** A plan expires after thirty minutes (operations.md §2). */
export const PLAN_SECONDS = 30 * 60;
/** A receipt is kept a day, so a retried apply inside that time answers the same receipt. */
export const RECEIPT_SECONDS = 24 * 60 * 60;

/** What a plan operation stores: the plan as returned, the apply's payload, and who planned. */
export interface StoredPlan<Payload = unknown> {
  plan: { id: string; operation: string; expires_at: string };
  payload: Payload;
  account: string;
}

/** What an apply stores under its plan id: the receipt it answered, and who applied. */
export interface StoredReceipt<Receipt = unknown> {
  receipt: Receipt;
  account: string;
}

/** A preparation is kept while its temporary branch may exist: thirty days. */
export const PREPARATION_SECONDS = 30 * 24 * 60 * 60;

export interface PlanStore {
  getPlan<Payload = unknown>(id: string): Promise<StoredPlan<Payload> | null>;
  putPlan(stored: StoredPlan, ttlSeconds?: number): Promise<void>;
  getReceipt<Receipt = unknown>(planId: string): Promise<StoredReceipt<Receipt> | null>;
  putReceipt(planId: string, stored: StoredReceipt, ttlSeconds?: number): Promise<void>;
  /** The addressable preparation of a project (operations.md §2), by its id, the version it was created with. */
  getPreparation<Preparation = unknown>(owner: string, repo: string, id: string): Promise<Preparation | null>;
  putPreparation(owner: string, repo: string, id: string, preparation: unknown, ttlSeconds?: number): Promise<void>;
}

export const newPlanId = (): string => crypto.randomUUID();

const planKey = (id: string) => `plan:${id}`;
const receiptKey = (id: string) => `receipt:${id}`;
const preparationKey = (owner: string, repo: string, id: string) => `preparation:${owner.toLowerCase()}/${repo}/${id}`;

function parse<T>(stored: string | null): T | null {
  if (!stored) return null;
  try {
    return JSON.parse(stored) as T;
  } catch {
    return null;
  }
}

export function planStore(kv: KVNamespace): PlanStore {
  return {
    async getPlan(id) {
      return parse(await kv.get(planKey(id)));
    },
    async putPlan(stored, ttlSeconds = PLAN_SECONDS) {
      await kv.put(planKey(stored.plan.id), JSON.stringify(stored), { expirationTtl: ttlSeconds });
    },
    async getReceipt(planId) {
      return parse(await kv.get(receiptKey(planId)));
    },
    async putReceipt(planId, stored, ttlSeconds = RECEIPT_SECONDS) {
      await kv.put(receiptKey(planId), JSON.stringify(stored), { expirationTtl: ttlSeconds });
    },
    async getPreparation(owner, repo, id) {
      return parse(await kv.get(preparationKey(owner, repo, id)));
    },
    async putPreparation(owner, repo, id, preparation, ttlSeconds = PREPARATION_SECONDS) {
      await kv.put(preparationKey(owner, repo, id), JSON.stringify(preparation), { expirationTtl: ttlSeconds });
    },
  };
}
