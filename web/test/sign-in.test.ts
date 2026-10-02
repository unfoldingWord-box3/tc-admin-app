// Reading a sign-in failure back from the address, and signing out.
import { ERROR_CATALOG } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { ApiError, signOut } from '../src/api/client';
import type { Fetch } from '../src/api/client';
import { signInFailure } from '../src/sign-in';

describe('sign-in failures', () => {
  test('no sign_in parameter is no failure', () => {
    expect(signInFailure('http://127.0.0.1:8787/?tab=x')).toBeNull();
  });

  test('X2: a catalog code shows its catalog message, and the address loses the parameter', () => {
    expect(signInFailure('http://127.0.0.1:8787/?sign_in=session_expired&tab=x')).toEqual({ message: ERROR_CATALOG.session_expired.message, cleaned: '/?tab=x' });
    expect(signInFailure('http://127.0.0.1:8787/?sign_in=door43_unavailable')?.message).toBe(ERROR_CATALOG.door43_unavailable.message);
  });

  test('X2: unexpected quotes the reference, and the address loses both parameters', () => {
    const failure = signInFailure('http://127.0.0.1:8787/?sign_in=unexpected&reference=5c4f6422-9f5e-48d2-be3a-6d685bf60962');
    expect(failure).toEqual({ message: 'Something went wrong. Reference 5c4f6422-9f5e-48d2-be3a-6d685bf60962.', cleaned: '/' });
  });

  test('a code not in the catalog is reported as unexpected, never as an expired session', () => {
    expect(signInFailure('http://127.0.0.1:8787/?sign_in=nonsense')?.message).toBe('Something went wrong. Reference unknown.');
  });

  test('reading the cleaned address again finds nothing, so a repeated read (StrictMode) changes nothing', () => {
    const first = signInFailure('http://127.0.0.1:8787/?sign_in=session_expired')!;
    expect(signInFailure(`http://127.0.0.1:8787${first.cleaned}`)).toBeNull();
  });
});

describe('sign out', () => {
  test('posts to /auth/logout with the session cookie', async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null;
    const fetcher: Fetch = async (url, init) => {
      seen = { url, init };
      return new Response(null, { status: 204 });
    };
    await signOut(fetcher);
    expect(seen).toMatchObject({ url: '/auth/logout', init: { method: 'POST', credentials: 'same-origin' } });
  });

  test('X2: a refused sign-out is an ApiError with the catalog shape, not a silent success', async () => {
    const body = { code: 'unexpected', message: 'Something went wrong. Reference r1.', retryable: false, next_action: 'report with the request id', request_id: 'r1', details: {}, invariant: 'X2' };
    await expect(signOut(async () => Response.json(body, { status: 500 }))).rejects.toMatchObject({ error: { code: 'unexpected', request_id: 'r1' } });
    await expect(signOut(async () => new Response('down', { status: 502, headers: { 'x-request-id': 'r2' } }))).rejects.toBeInstanceOf(ApiError);
  });

  test('a network failure rejects instead of being swallowed', async () => {
    await expect(
      signOut(async () => {
        throw new TypeError('network');
      }),
    ).rejects.toThrow('network');
  });
});
