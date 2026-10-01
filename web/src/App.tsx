// The application shell: the Ocean title bar with the host indicator, from
// `situation.read`. Sign-in (#12), the portfolio (#23, #24), and the design
// system (#8) build on it.

import { useEffect, useState } from 'react';
import type { OperationOutput } from '@tc-admin/shared/schema';
import { ApiError, callOperation } from './api/client';

type Situation = OperationOutput<'situation.read'>;

export function App() {
  const [situation, setSituation] = useState<Situation | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      </header>
      <main>
        <h1>Your projects</h1>
        {error && <p role="alert">{error}</p>}
        {!situation && !error && <p>Connecting to Door43…</p>}
        {situation && host && (
          <>
            <p>Sign in with Door43 {host.name} to see the projects you can manage.</p>
            <button type="button" disabled>
              Sign in with Door43 {host.name}
            </button>
            <p>{situation.configured ? 'Sign-in is not available in this build yet.' : `${host.name} sign-in is being configured.`}</p>
          </>
        )}
      </main>
    </>
  );
}
