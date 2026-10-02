// The application shell: the Ocean title bar with the host indicator, from
// `situation.read`, and sign-in: a link to the Worker's `/auth/login`, which
// returns here with `?sign_in=<code>` when it fails. A session Door43 no
// longer accepts is reported and the situation read again, so the sign-in
// link comes back. The portfolio (#23, #24) and the design system (#8) build
// on it.

import { useCallback, useEffect, useState } from 'react';
import type { OperationOutput } from '@tc-admin/shared/schema';
import { ApiError, callOperation, signOut } from './api/client';
import { signInFailure } from './sign-in';

type Situation = OperationOutput<'situation.read'>;

const UNREACHABLE = 'Door43 is unavailable currently. Please refresh later.';
const messageOf = (failure: unknown) => (failure instanceof ApiError ? failure.error.message : UNREACHABLE);

interface Reading {
  situation?: Situation;
  error?: string;
  notice?: string;
}

/** `situation.read`; a session Door43 no longer accepts has been ended by the Worker, so it is read once more to offer sign-in. */
async function readSituation(): Promise<Reading> {
  try {
    return { situation: await callOperation('situation.read', {}) };
  } catch (failure) {
    if (!(failure instanceof ApiError) || failure.error.code !== 'session_expired') return { error: messageOf(failure) };
    try {
      return { situation: await callOperation('situation.read', {}), notice: failure.error.message };
    } catch (again) {
      return { error: messageOf(again), notice: failure.error.message };
    }
  }
}

export function App() {
  const [situation, setSituation] = useState<Situation | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pure, so StrictMode's second call agrees with the first; the address is cleaned in the effect below.
  const [notice, setNotice] = useState<string | null>(() => signInFailure(window.location.href)?.message ?? null);

  const apply = useCallback((result: Reading) => {
    if (result.notice) setNotice(result.notice);
    if (result.situation) setSituation(result.situation);
    setError(result.error ?? null);
  }, []);

  useEffect(() => {
    const failure = signInFailure(window.location.href);
    if (failure) window.history.replaceState(null, '', failure.cleaned);
    void readSituation().then(apply);
  }, [apply]);

  const endSession = async () => {
    try {
      await signOut();
      window.location.assign('/');
    } catch (failure) {
      setNotice(messageOf(failure));
    }
  };

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
            <button type="button" onClick={() => void endSession()}>
              Sign out
            </button>
          </span>
        )}
      </header>
      <main>
        <h1>Your projects</h1>
        {notice && <p role="alert">{notice}</p>}
        {error && (
          <>
            <p role="alert">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                void readSituation().then(apply);
              }}
            >
              Try again
            </button>{' '}
            <button type="button" onClick={() => void endSession()}>
              Sign out
            </button>
          </>
        )}
        {!situation && !error && <p>Connecting to Door43…</p>}
        {situation && host && !situation.account && !error && (
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
        {situation?.account && !error && <p>Signed in to Door43 {host?.name} as {situation.account.login}.</p>}
      </main>
    </>
  );
}
