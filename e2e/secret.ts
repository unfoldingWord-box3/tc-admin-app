// Typing a secret without letting it reach a report (bench rounds 2 and 3 on #144). Playwright's own error for a
// failed action names the value it was typing, and a failed test's page snapshot (error-context.md) shows what a
// password field holds; both are printed or saved. A failure to type the password is caught and replaced with a fixed
// message, and a failure after it was typed clears the field before Playwright takes its snapshot.

import type { Locator } from '@playwright/test';

export async function fillSecret(field: Locator, secret: string, what: string): Promise<void> {
  try {
    await field.fill(secret, { timeout: 15_000 });
  } catch {
    // The caught error is dropped whole: its message and call log carry the secret.
    throw new Error(`${what} could not be filled`);
  }
}

/** Runs what follows the typing; if it fails, the field is emptied first, so the failure's page snapshot does not show the secret. */
export async function clearedOnFailure<T>(field: Locator, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    // The page may have moved on and the field be gone: then there is nothing to clear.
    await field.fill('', { timeout: 2_000 }).catch(() => undefined);
    throw error;
  }
}
