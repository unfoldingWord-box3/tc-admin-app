// Plans live in Workers KV for their lifetime (architecture §3): a plan
// operation stores what its apply needs under the plan id, which is also the
// apply's idempotency key (operations.md §1 rule 6), and the apply reads it
// back, refuses it once expired or made by another account (`plan_expired`),
// and stores its receipt under the same id so a repeated apply answers the
// same receipt and writes nothing more. A creation records its attempt in a
// key of its own before it creates the repository, and the retry of its first
// commit stores its receipt in another (Q29, #31).

import type { KVNamespace } from '../env';

/** A plan expires after thirty minutes (operations.md §2). */
export const PLAN_SECONDS = 30 * 60;
/** A receipt is kept a day, so a retried apply inside that time answers the same receipt. */
export const RECEIPT_SECONDS = 24 * 60 * 60;
/** Workers KV takes at most one write a second to the same key; a faster second write is refused (429). */
export const SAME_KEY_WRITE_MS = 1000;

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

/**
 * What `project.create.apply` records under its plan id just before it asks Door43
 * to create the repository, in a key of its own (decided 6 October 2026 by Rich,
 * Q29): the plan as it stood and when the attempt began, so the retry (#31) can
 * tell a repository this attempt created from one someone else did.
 */
export interface StoredAttempt<Payload = unknown> {
  stored: StoredPlan<Payload>;
  attempted_at: string;
}

/** A preparation is kept while its temporary branch may exist: thirty days. */
export const PREPARATION_SECONDS = 30 * 24 * 60 * 60;

export interface PlanStore {
  getPlan<Payload = unknown>(id: string): Promise<StoredPlan<Payload> | null>;
  putPlan(stored: StoredPlan, ttlSeconds?: number): Promise<void>;
  getReceipt<Receipt = unknown>(planId: string): Promise<StoredReceipt<Receipt> | null>;
  putReceipt(planId: string, stored: StoredReceipt, ttlSeconds?: number): Promise<void>;
  /** The creation attempt of a plan (Q29), kept a day like the receipt. */
  getAttempt<Payload = unknown>(planId: string): Promise<StoredAttempt<Payload> | null>;
  putAttempt(planId: string, attempt: StoredAttempt, ttlSeconds?: number): Promise<void>;
  /** The receipt of `project.create.retry` for a plan, so a repeated retry answers it and writes nothing (§1 rule 6). */
  getRetryReceipt<Receipt = unknown>(planId: string): Promise<StoredReceipt<Receipt> | null>;
  putRetryReceipt(planId: string, stored: StoredReceipt, ttlSeconds?: number): Promise<void>;
  /** The addressable preparation of a project (operations.md §2), by its id, the version it was created with. */
  getPreparation<Preparation = unknown>(owner: string, repo: string, id: string): Promise<Preparation | null>;
  putPreparation(owner: string, repo: string, id: string, preparation: unknown, ttlSeconds?: number): Promise<void>;
  /**
   * Every preparation stored for a project, as stored, read through every page of the
   * key listing (#125). Workers KV lists eventually: one stored a moment ago may be missing.
   * A record that no longer parses as JSON is left out.
   */
  listPreparations(owner: string, repo: string): Promise<unknown[]>;
}

export const newPlanId = (): string => crypto.randomUUID();

const planKey = (id: string) => `plan:${id}`;
const receiptKey = (id: string) => `receipt:${id}`;
const attemptKey = (id: string) => `attempt:${id}`;
const retryReceiptKey = (id: string) => `retry-receipt:${id}`;
/** The key prefix of one project's preparations; the closing `/` keeps `id_tb` from listing `id_tb1`'s. */
export const preparationPrefix = (owner: string, repo: string) => `preparation:${owner.toLowerCase()}/${repo}/`;
const preparationKey = (owner: string, repo: string, id: string) => `${preparationPrefix(owner, repo)}${id}`;

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
    async getAttempt(planId) {
      return parse(await kv.get(attemptKey(planId)));
    },
    async putAttempt(planId, attempt, ttlSeconds = RECEIPT_SECONDS) {
      await kv.put(attemptKey(planId), JSON.stringify(attempt), { expirationTtl: ttlSeconds });
    },
    async getRetryReceipt(planId) {
      return parse(await kv.get(retryReceiptKey(planId)));
    },
    async putRetryReceipt(planId, stored, ttlSeconds = RECEIPT_SECONDS) {
      await kv.put(retryReceiptKey(planId), JSON.stringify(stored), { expirationTtl: ttlSeconds });
    },
    async getPreparation(owner, repo, id) {
      return parse(await kv.get(preparationKey(owner, repo, id)));
    },
    async putPreparation(owner, repo, id, preparation, ttlSeconds = PREPARATION_SECONDS) {
      await kv.put(preparationKey(owner, repo, id), JSON.stringify(preparation), { expirationTtl: ttlSeconds });
    },
    async listPreparations(owner, repo) {
      const prefix = preparationPrefix(owner, repo);
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await kv.list(cursor === undefined ? { prefix } : { prefix, cursor });
        // A key under the prefix whose id holds another `/` is not one this store wrote.
        names.push(...page.keys.map(key => key.name).filter(name => name.startsWith(prefix) && !name.slice(prefix.length).includes('/')));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      const found: unknown[] = [];
      for (const name of names) {
        const stored = parse<unknown>(await kv.get(name));
        if (stored !== null) found.push(stored);
      }
      return found;
    },
  };
}
