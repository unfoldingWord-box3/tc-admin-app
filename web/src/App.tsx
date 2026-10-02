// The application shell: the Ocean title bar with the host indicator, from
// `situation.read`, and sign-in: a link to the Worker's `/auth/login`, which
// returns here with `?sign_in=<code>` when it fails. The portfolio (#23, #24)
// and the design system (#8) build on it.

import { useEffect, useState } from 'react';
import { ErrorCodeSchema, catalogMessage } from '@tc-admin/shared/schema';
import type { OperationOutput } from '@tc-admin/shared/schema';
import { ApiError, callOperation } from './api/client';

type Situation = OperationOutput<'situation.read'>;

/** The catalog message for a failed sign-in, and the address bar without the code. */
function signInFailure(): string | null {
  const url = new URL(window.location.href);
  const code = ErrorCodeSchema.safeParse(url.searchParams.get('sign_in'));
  if (!url.searchParams.has('sign_in')) return null;
  url.searchParams.delete('sign_in');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return catalogMessage(code.success ? code.data : 'session_expired');
}

export function App() {
  const [situation, setSituation] = useState<Situation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure] = useState(signInFailure);

  useEffect(() => {
    callOperation('situation.read', {}).then(setSituation, (failure: unknown) =>
      setError(failure instanceof ApiError ? failure.error.message : 'Door43 is unavailable currently. Please refresh later.'),
    );
  }, []);

  const host = situation?.host;
  return (
    <>
      <header>
        <strong>tC Admin</strong>
        {host && (
          <span className="environment-badge" title={host.origin}>
            {host.name === 'QA' ? 'QA' : 'PROD'} · {host.development ? 'DEVELOPMENT' : 'PRODUCTION'}
          </span>
        )}
        {situation?.account && (
          <span>
            {situation.account.name} ·{' '}
            <button type="button" onClick={() => void fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(() => window.location.assign('/'))}>
              Sign out
            </button>
          </span>
        )}
      </header>
      <main>
        <h1>Your projects</h1>
        {failure && <p role="alert">{failure}</p>}
        {error && <p role="alert">{error}</p>}
        {!situation && !error && <p>Connecting to Door43…</p>}
        {situation && host && !situation.account && (
          <>
            <p>Sign in with Door43 {host.name} to see the projects you can manage.</p>
            {situation.configured ? (
              <a className="button" href="/auth/login">
                Sign in with Door43 {host.name}
              </a>
            ) : (
              <>
                <button type="button" disabled>
                  Sign in with Door43 {host.name}
                </button>
                <p>{host.name} sign-in is being configured.</p>
              </>
            )}
          </>
        )}
        {situation?.account && <p>Signed in to Door43 {host?.name} as {situation.account.login}.</p>}
      </main>
    </>
  );
}
