// Typing a secret without letting it reach a report (bench round 2 on #144). Playwright's own error for a failed
// action names the value it was typing, and the list reporter and error-context.md print that error; a failure to
// type the password is caught here and replaced with a fixed message, so the password is never printed or saved.

import type { Locator } from '@playwright/test';

export async function fillSecret(field: Locator, secret: string, what: string): Promise<void> {
  try {
    await field.fill(secret, { timeout: 15_000 });
  } catch {
    // The caught error is dropped whole: its message and call log carry the secret.
    throw new Error(`${what} could not be filled`);
  }
}
