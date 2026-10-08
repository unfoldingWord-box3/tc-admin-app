// Coming back after a sign-in (#15, product spec §2 "expired-session handling
// that preserves unsaved form state where safe"). Door43's sign-in always
// returns to `/` (worker/src/http/session.ts), so the address the manager was
// on, and with it an open preparation's (`#/<owner>/<repo>/release/<version>`,
// which `preparation.read` re-reads by id, #125), would be lost; so would the
// creation wizard's form. Both are kept in this tab's `sessionStorage` when the
// sign-in link is followed and restored when the same account is signed in
// again within half an hour. What is kept is safe to keep: an address, and the
// wizard's fields (owner, type, title, abbreviation, language, scope,
// translation details). Never a token (A1, A3), never a file's bytes, never a
// plan: a plan is planned again. Every read and write is guarded, so a browser
// that refuses storage simply loses the state, as before.

import type { Form } from './create-project';

/** How long a remembered address or form is offered back: a sign-in is ten minutes at most (the login record's lifetime), with margin. */
export const RESUME_MS = 30 * 60 * 1000;
export const RETURN_KEY = 'tca:return';
export const DRAFT_KEY = 'tca:wizard-draft';
const RESUME_DRAFT_KEY = 'tca:wizard-resume';

/** The storage these functions use; the tab's `sessionStorage` unless given, `null` when the browser refuses it. */
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function tabStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function read<T>(store: Store | null, key: string): T | null {
  if (!store) return null;
  try {
    const text = store.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function write(store: Store | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // A full or refused store loses the state, as before this existed.
  }
}

function remove(store: Store | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** The addresses worth coming back to: the app's own views (`#/…`), never anything else a URL fragment could carry. */
const resumable = (hash: string): boolean => /^#\/[^\s]*$/.test(hash) && hash.length <= 512;

interface ReturnRecord {
  hash: string;
  /** The account signed in when the address was remembered; `null` for a visitor not yet signed in. */
  account: string | null;
  at: number;
}

/**
 * Remembers the address being left for the sign-in, with the account that was signed in, if any. An address that is not
 * one of the app's views is not remembered, and leaves one already remembered in place: a sign-in that failed returns to
 * `/?sign_in=…`, and trying again from there still comes back to where the first attempt left.
 */
export function rememberReturn(hash: string, account: string | null, now = Date.now(), store: Store | null = tabStore()): void {
  if (!resumable(hash)) return;
  write(store, RETURN_KEY, { hash, account, at: now } satisfies ReturnRecord);
}

/**
 * The address to come back to after a sign-in as `account`, taken once: the one remembered within `RESUME_MS`, and only
 * when it was remembered for the same account or for no account. Coming back to the wizard (`#/new`) as the same account
 * also offers the wizard its remembered form, once.
 */
export function takeReturn(account: string, now = Date.now(), store: Store | null = tabStore()): string | null {
  // A form offered back to another account is withdrawn: another account's sign-in never opens it (#15).
  const pending = read<{ account?: unknown }>(store, RESUME_DRAFT_KEY);
  if (pending && pending.account !== account.toLowerCase()) remove(store, RESUME_DRAFT_KEY);
  const record = read<ReturnRecord>(store, RETURN_KEY);
  remove(store, RETURN_KEY);
  if (!record || typeof record.hash !== 'string' || typeof record.at !== 'number' || !resumable(record.hash)) return null;
  if (now - record.at > RESUME_MS || now < record.at) return null;
  const sameAccount = typeof record.account === 'string' && record.account.toLowerCase() === account.toLowerCase();
  if (record.account !== null && !sameAccount) return null;
  if (sameAccount && record.hash === '#/new') write(store, RESUME_DRAFT_KEY, { account: account.toLowerCase(), at: now });
  return record.hash;
}

interface DraftRecord {
  form: Form;
  at: number;
}

/** Keeps the wizard's form as the manager fills it, so a sign-in in the middle loses nothing. */
export function saveDraft(form: Form, now = Date.now(), store: Store | null = tabStore()): void {
  write(store, DRAFT_KEY, { form, at: now } satisfies DraftRecord);
}

/** Forgets the wizard's form: once a project is created, or when the wizard opens afresh. */
export function clearDraft(store: Store | null = tabStore()): void {
  remove(store, DRAFT_KEY);
  remove(store, RESUME_DRAFT_KEY);
}

/**
 * The wizard's form to restore as it opens: only right after a sign-in brought the same account back to the wizard
 * (`takeReturn`), and only a form kept within `RESUME_MS`. It only reads, so a render that runs twice gets the same
 * answer; the wizard calls `endResume` once it has opened, and from then on keeps its own form with `saveDraft`, so an
 * abandoned form never comes back by surprise.
 */
export function resumedDraft(now = Date.now(), store: Store | null = tabStore()): Form | null {
  const resume = read<{ at: number }>(store, RESUME_DRAFT_KEY);
  const draft = read<DraftRecord>(store, DRAFT_KEY);
  if (!resume || !draft || typeof draft.at !== 'number' || typeof resume.at !== 'number') return null;
  if (now - draft.at > RESUME_MS || now - resume.at > RESUME_MS) return null;
  const form = draft.form;
  if (!form || typeof form !== 'object' || typeof form.owner !== 'string' || (form.project_type !== 'bible' && form.project_type !== 'obs')) return null;
  return form;
}

/** The wizard has opened: the offer to restore its form is used up. */
export function endResume(store: Store | null = tabStore()): void {
  remove(store, RESUME_DRAFT_KEY);
}
