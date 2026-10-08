// The application shell: the Ocean title bar with the host indicator, from
// `situation.read`, and sign-in: a link to the Worker's `/auth/login`, which
// returns here with `?sign_in=<code>` when it fails. A session Door43 no
// longer accepts is reported and the situation read again, so the sign-in
// link comes back. Signed in, it shows the portfolio (#23); the design system
// (#8) builds on it.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationOutput } from '@tc-admin/shared/schema';
import { ApiError, callOperation, failureMessage, signOut } from './api/client';
import { Portfolio } from './Portfolio';
import { clearDraft, endResume, rememberReturn, takeReturn } from './resume';
import { signInFailure } from './sign-in';

type Situation = OperationOutput<'situation.read'>;

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
    if (!(failure instanceof ApiError) || failure.error.code !== 'session_expired') return { error: failureMessage(failure) };
    try {
      return { situation: await callOperation('situation.read', {}), notice: failure.error.message };
    } catch (again) {
      return { error: failureMessage(again), notice: failure.error.message };
    }
  }
}

export function App() {
  const [situation, setSituation] = useState<Situation | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pure, so StrictMode's second call agrees with the first; the address is cleaned in the effect below.
  const [notice, setNotice] = useState<string | null>(() => signInFailure(window.location.href)?.message ?? null);

  // The account last signed in, so a sign-in after an expired session can come back to where it was (#15).
  const lastAccount = useRef<string | null>(null);

  const apply = useCallback((result: Reading) => {
    if (result.notice) setNotice(result.notice);
    const account = result.situation?.account?.login;
    if (account) {
      lastAccount.current = account;
      // Door43's sign-in returns to `/`: the address left for it is restored, before the portfolio reads it (#15).
      const back = takeReturn(account);
      if (back && (window.location.hash === '' || window.location.hash === '#')) window.history.replaceState(null, '', back);
      // The address already in the bar is kept, so the wizard's form is not offered to a later opening either.
      else if (back) endResume();
    }
    if (result.situation) setSituation(result.situation);
    setError(result.error ?? null);
  }, []);

  useEffect(() => {
    const failure = signInFailure(window.location.href);
    if (failure) window.history.replaceState(null, '', failure.cleaned);
    void readSituation().then(apply);
  }, [apply]);

  // A portfolio read Door43 refused for the session: the Worker ended it, so the situation is read again to offer sign-in.
  const portfolioFailed = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiError && failure.error.code === 'session_expired') {
        setNotice(failure.error.message);
        setSituation(null);
        void readSituation().then(apply);
      } else {
        setError(failureMessage(failure));
      }
    },
    [apply],
  );

  const endSession = async () => {
    // Signing out forgets the wizard's kept form, so the next account in this tab never sees it (bench round 2 on #140).
    clearDraft();
    try {
      await signOut();
      window.location.assign('/');
    } catch (failure) {
      setNotice(failureMessage(failure));
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
              <a className="button" href="/auth/login" onClick={() => rememberReturn(window.location.hash, lastAccount.current)}>
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
        {situation?.account && !error && <Portfolio account={situation.account} onFailure={portfolioFailed} />}
      </main>
    </>
  );
}
