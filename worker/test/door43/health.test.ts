// The Door43 health-check reader (#36, E15, E28): one GET per read for the
// ref, the recorded answers in tC Admin's words, the 422 before a check has
// run as pending, and a Door43 that cannot answer as unavailable, never as a
// result.
import { CatalogError } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import { readHealth } from '../../src/door43/health';
import { door43Host } from '../../src/door43/host';
import { recorded } from '../support/recorded';

const client = (fetch: Fetch) => ({ host: door43Host('https://qa.door43.org'), token: 'test-only', fetch });
const answer = (path: string) => recorded<unknown>(path);
const fetchJson = (body: unknown, status = 200): Fetch => async () => Response.json(body, { status });

describe('the health-check read (E15, E28)', () => {
  test('one GET of /repos/{owner}/{repo}/healthcheck?ref= with the session token, and the branch result of E28 is a success with no issues', async () => {
    const requests: string[] = [];
    const fetch: Fetch = async (url, init) => {
      requests.push(url);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-only');
      return Response.json(answer('2026-09-22/probe-write/10-health-branch.json'));
    };
    expect(await readHealth(client(fetch), 'tc-admin-qa-org', 'tca-probe-20260922194921', 'temp-tca-release/v1.1.0')).toEqual({ kind: 'result', severity: 'success', issues: [] });
    expect(requests).toEqual(['https://qa.door43.org/api/v1/repos/tc-admin-qa-org/tca-probe-20260922194921/healthcheck?ref=temp-tca-release%2Fv1.1.0']);
  });

  test('H1: an info result carries its one note, and a warning result its issue, as Door43 wrote them (E28)', async () => {
    const info = await readHealth(client(fetchJson(answer('2026-09-22/probe-write/05-health-master.json'))), 'o', 'r', 'master');
    expect(info).toMatchObject({ kind: 'result', severity: 'info' });
    expect((info as { issues: unknown[] }).issues).toEqual([
      expect.objectContaining({ code: 'release_needed', rule: null, severity: 'info', title: 'An error-free release needs to be published for the resource' }),
    ]);
    const warning = await readHealth(client(fetchJson(answer('2026-09-22/probe-write/12-health-tag-v1.1.0.json'))), 'o', 'r', 'v1.1.0');
    expect(warning).toMatchObject({ kind: 'result', severity: 'warning', issues: [{ code: 'sb_ingredient_mismatch', rule: 'META-015', severity: 'warning' }] });
    expect((warning as { issues: { details: string }[] }).issues[0]!.details).toContain('ingredients/EXO.usfm');
  });

  test('the 422 "no metadata found" before a check has run is pending, not an error (E15, E28)', async () => {
    const body = { ok: false, error: 'no metadata found for repo [tc-admin-qa-org/tca-probe-20260922194921] and ref [master]' };
    expect(await readHealth(client(fetchJson(body, 422)), 'o', 'r', 'master')).toEqual({ kind: 'pending' });
  });

  test('H3: an answer that is no result is unavailable or an error, never a result, and a 401 is session_expired', async () => {
    const down: Fetch = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await readHealth(client(down), 'o', 'r', 'master')).toMatchObject({ kind: 'unavailable' });
    expect(await readHealth(client(fetchJson({ message: 'bad gateway' }, 502)), 'o', 'r', 'master')).toEqual({ kind: 'unavailable', reason: 'Door43 answered 502' });
    expect(await readHealth(client(fetchJson({ ok: false, error: 'something else' }, 422)), 'o', 'r', 'master')).toEqual({ kind: 'error', reason: 'something else', status: 422 });
    expect(await readHealth(client(fetchJson({ ok: true, data: { issues: {} } })), 'o', 'r', 'master')).toEqual({ kind: 'error', reason: 'the health check answer named no severity', status: 200 });
    expect(await readHealth(client(async () => new Response('<html>', { status: 200 })), 'o', 'r', 'master')).toEqual({ kind: 'error', reason: 'the health check answer was not JSON', status: 200 });
    expect(await readHealth(client(fetchJson({ ok: false }, 404)), 'o', 'r', 'master')).toMatchObject({ kind: 'error', status: 404 });
    await expect(readHealth(client(fetchJson({ message: 'token expired' }, 401)), 'o', 'r', 'master')).rejects.toMatchObject({ code: 'session_expired' });
    expect(new CatalogError('session_expired').code).toBe('session_expired');
  });
});
