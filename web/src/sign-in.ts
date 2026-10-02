// What the app reads back from a sign-in: the Worker's `/auth/callback`
// returns to `/?sign_in=<code>`, with `&reference=<request id>` for
// `unexpected` (worker/src/http/session.ts). Pure, so it can be tested
// without a browser and called more than once (React StrictMode).

import { ErrorCodeSchema, catalogMessage } from '@tc-admin/shared/schema';

export interface SignInFailure {
  /** The catalog message for the code. */
  message: string;
  /** The address without the sign-in parameters, for `history.replaceState`. */
  cleaned: string;
}

export function signInFailure(href: string): SignInFailure | null {
  const url = new URL(href);
  if (!url.searchParams.has('sign_in')) return null;
  const code = ErrorCodeSchema.safeParse(url.searchParams.get('sign_in'));
  const reference = url.searchParams.get('reference') ?? 'unknown';
  url.searchParams.delete('sign_in');
  url.searchParams.delete('reference');
  // A code that is not in the catalog is reported as what it is: something went wrong.
  const message = code.success && code.data !== 'unexpected' ? catalogMessage(code.data) : catalogMessage('unexpected', undefined, { request_id: reference });
  return { message, cleaned: url.pathname + url.search + url.hash };
}
