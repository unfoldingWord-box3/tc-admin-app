// Coming back after a sign-in (#15): the address left for the sign-in is
// offered back once, within half an hour, to the same account or to a visitor
// who was not signed in, never another account's; the wizard's form is offered
// back only when that return lands on the wizard for the same account. Nothing
// but an app address and the form's fields is kept, and a store that refuses
// is the state lost, never a failure.
import { describe, expect, test } from 'vitest';
import { newForm } from '../src/create-project';
import type { Form } from '../src/create-project';
import { DRAFT_KEY, RESUME_MS, RETURN_KEY, clearDraft, endResume, rememberReturn, resumedDraft, saveDraft, takeReturn } from '../src/resume';
import type { Store } from '../src/resume';

function memory(): Store & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: key => void entries.delete(key),
  };
}
const T = Date.parse('2026-10-08T12:00:00.000Z');
const PREPARATION = '#/bahtraku/Perjanjian-Baru-Pendau/release/v1.3.0';
const form: Form = { ...newForm('tc-admin-qa-org'), title: 'Alkitab Pendau', abbreviation: 'APD', testament_scope: 'nt' };

describe('the address', () => {
  test('A1, #15: an open preparation\'s address left for the sign-in comes back once to the same account, in any case', () => {
    const store = memory();
    rememberReturn(PREPARATION, 'tc-admin-qa', T, store);
    expect(takeReturn('TC-Admin-QA', T + 60_000, store)).toBe(PREPARATION);
    expect(takeReturn('tc-admin-qa', T + 61_000, store)).toBeNull();
  });

  test('a visitor not yet signed in comes back to the address they opened, whoever signs in', () => {
    const store = memory();
    rememberReturn('#/bahtraku/id_tb1', null, T, store);
    expect(takeReturn('birch', T + 1000, store)).toBe('#/bahtraku/id_tb1');
  });

  test('another account, an address over half an hour old, or one from the future is not offered, and is forgotten', () => {
    const store = memory();
    rememberReturn(PREPARATION, 'tc-admin-qa', T, store);
    expect(takeReturn('birch', T + 1000, store)).toBeNull();
    expect(store.entries.has(RETURN_KEY)).toBe(false);
    rememberReturn(PREPARATION, 'tc-admin-qa', T, store);
    expect(takeReturn('tc-admin-qa', T + RESUME_MS + 1, store)).toBeNull();
    rememberReturn(PREPARATION, 'tc-admin-qa', T, store);
    expect(takeReturn('tc-admin-qa', T - 1, store)).toBeNull();
  });

  test('A1: only the app\'s own addresses are kept: never another fragment, never a long one; the portfolio itself is nothing to come back to', () => {
    const store = memory();
    for (const hash of ['', '#', '#access_token=abc', 'javascript:alert(1)', `#/${'a'.repeat(600)}`, '#/a b']) {
      rememberReturn(hash, 'tc-admin-qa', T, store);
      expect(store.entries.has(RETURN_KEY)).toBe(false);
    }
  });

  test('a store that refuses, or holds what is not JSON, loses the state and never throws', () => {
    const refusing: Store = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => rememberReturn(PREPARATION, 'tc-admin-qa', T, refusing)).not.toThrow();
    expect(takeReturn('tc-admin-qa', T, refusing)).toBeNull();
    expect(takeReturn('tc-admin-qa', T, null)).toBeNull();
    const store = memory();
    store.entries.set(RETURN_KEY, '{not json');
    expect(takeReturn('tc-admin-qa', T, store)).toBeNull();
    store.entries.set(RETURN_KEY, JSON.stringify({ hash: PREPARATION, account: 5, at: T }));
    expect(takeReturn('tc-admin-qa', T, store)).toBeNull();
  });

  test('#15: a sign-in that failed and is tried again from `/?sign_in=…` still comes back to the address the first attempt left', () => {
    const store = memory();
    rememberReturn(PREPARATION, 'tc-admin-qa', T, store);
    rememberReturn('', null, T + 1000, store);
    expect(takeReturn('tc-admin-qa', T + 2000, store)).toBe(PREPARATION);
  });
});

describe('the wizard\'s form', () => {
  test('#15: a return to the wizard as the same account offers its form back, as often as a render asks, until the wizard has opened', () => {
    const store = memory();
    saveDraft(form, T, store);
    rememberReturn('#/new', 'tc-admin-qa', T, store);
    expect(takeReturn('tc-admin-qa', T + 1000, store)).toBe('#/new');
    expect(resumedDraft(T + 2000, store)).toEqual(form);
    expect(resumedDraft(T + 2000, store)).toEqual(form);
    endResume(store);
    expect(resumedDraft(T + 3000, store)).toBeNull();
  });

  test('a wizard opened any other way, a return as another account or to another address, or an old form starts afresh', () => {
    const store = memory();
    saveDraft(form, T, store);
    expect(resumedDraft(T, store)).toBeNull();
    rememberReturn('#/new', 'tc-admin-qa', T, store);
    takeReturn('birch', T, store);
    expect(resumedDraft(T, store)).toBeNull();
    rememberReturn('#/new', null, T, store);
    takeReturn('tc-admin-qa', T, store);
    expect(resumedDraft(T, store)).toBeNull();
    rememberReturn('#/new', 'tc-admin-qa', T, store);
    takeReturn('tc-admin-qa', T + RESUME_MS + 1, store);
    expect(resumedDraft(T + RESUME_MS + 1, store)).toBeNull();
  });

  test('#15: a form offered back to one account and not yet opened is withdrawn when another account signs in', () => {
    const store = memory();
    saveDraft(form, T, store);
    rememberReturn('#/new', 'tc-admin-qa', T, store);
    takeReturn('tc-admin-qa', T, store);
    expect(takeReturn('birch', T + 1000, store)).toBeNull();
    expect(resumedDraft(T + 2000, store)).toBeNull();
  });

  test('a created project forgets the form', () => {
    const store = memory();
    saveDraft(form, T, store);
    clearDraft(store);
    expect(store.entries.has(DRAFT_KEY)).toBe(false);
  });
});
