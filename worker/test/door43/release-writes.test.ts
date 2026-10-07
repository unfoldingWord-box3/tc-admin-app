// The release writes (#39, E21, E27): one POST creates the tag and the release
// on the snapshot commit; one PATCH of the pre-release flag alone promotes
// (R8); one DELETE removes the temporary branch and reports, never throws
// (R7). Each is sent once (X1); a refusal and a lost answer are told apart.
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import { deleteBranch } from '../../src/door43/branches';
import { door43Host } from '../../src/door43/host';
import { createRelease, promoteRelease, ReleaseWriteError } from '../../src/door43/releases';
import { recorded } from '../support/recorded';

const client = (fetch: Fetch) => ({ host: door43Host('https://qa.door43.org'), token: 'test-only', fetch });
const PROBE = { owner: 'tc-admin-qa-org', repo: 'tca-probe-20260922194921' };
const SHA = '1c1db84a847f000ca1da672081a8a1c951504b1a';
const prerelease = recorded<{ id: number; html_url: string }>('2026-09-22/probe-write/11-prerelease-v1.1.0.json');
const promoted = recorded<unknown>('2026-09-22/probe-write/13-promote.json');

function door43(answer: (method: string, path: string, body: unknown) => Response | Promise<Response>) {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    const request = { method: init?.method ?? 'GET', path: new URL(url).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    requests.push(request);
    return answer(request.method, request.path, request.body);
  };
  return { client: client(fetch), requests };
}
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

describe('createRelease (E21, E27)', () => {
  test('R3: one POST of the tag, the notes, the snapshot commit, and the flag; the recorded pre-release comes back in glossary terms', async () => {
    const { client, requests } = door43(() => Response.json(prerelease, { status: 201 }));
    const release = await createRelease(client, PROBE.owner, PROBE.repo, { tag: 'v1.1.0', notes: 'Probe pre-release', target_sha: SHA, prerelease: true });
    expect(requests).toEqual([{ method: 'POST', path: `/api/v1/repos/${PROBE.owner}/${PROBE.repo}/releases`, body: { tag_name: 'v1.1.0', name: 'v1.1.0', body: 'Probe pre-release', target_commitish: SHA, prerelease: true, draft: false } }]);
    expect(release).toMatchObject({ id: prerelease.id, tag: 'v1.1.0', url: prerelease.html_url, prerelease: true, target_sha: SHA });
  });

  test('R6, X1: a 409 is exists, another 4xx refusal is failed with Door43 message, and a lost, unreadable, 5xx, or timed-out answer is unknown; none is sent twice', async () => {
    const cases: [() => Response | Promise<Response>, string, string][] = [
      [() => Response.json({ message: 'Release is has no Tag' }, { status: 409 }), 'exists', 'Release is has no Tag'],
      [() => Response.json({ message: 'target_commitish is not a valid commit' }, { status: 422 }), 'failed', 'target_commitish is not a valid commit'],
      [() => Response.json({ message: 'internal error' }, { status: 500 }), 'unknown', 'internal error'],
      [() => new Response('', { status: 504 }), 'unknown', 'Door43 answered 504'],
      [() => new Response('', { status: 408 }), 'unknown', 'Door43 answered 408'],
      [() => Promise.reject(new TypeError('fetch failed')), 'unknown', 'Door43 did not answer'],
      [() => new Response('{"id": 1', { status: 201 }), 'unknown', 'unexpected release shape'],
    ];
    for (const [answer, kind, reason] of cases) {
      const { client, requests } = door43(answer);
      const error = await failure(createRelease(client, PROBE.owner, PROBE.repo, { tag: 'v1.1.0', notes: 'n', target_sha: SHA, prerelease: false }));
      expect(error).toBeInstanceOf(ReleaseWriteError);
      expect(error).toMatchObject({ kind, reason });
      expect(requests).toHaveLength(1);
    }
    const { client } = door43(() => Response.json({ message: 'token expired' }, { status: 401 }));
    expect(await failure(createRelease(client, PROBE.owner, PROBE.repo, { tag: 'v1.1.0', notes: 'n', target_sha: SHA, prerelease: false }))).toMatchObject({ code: 'session_expired' });
  });
});

describe('promoteRelease (E27)', () => {
  test('R8: the PATCH body is the pre-release flag and nothing else, and the recorded promotion comes back as a full release', async () => {
    const { client, requests } = door43(() => Response.json(promoted));
    const release = await promoteRelease(client, PROBE.owner, PROBE.repo, prerelease.id);
    expect(requests).toEqual([{ method: 'PATCH', path: `/api/v1/repos/${PROBE.owner}/${PROBE.repo}/releases/${prerelease.id}`, body: { prerelease: false } }]);
    expect(release).toMatchObject({ id: prerelease.id, tag: 'v1.1.0', prerelease: false, target_sha: SHA });
  });

  test('a release Door43 no longer has is not_found; another refusal is failed; no answer is unknown', async () => {
    expect(await failure(promoteRelease(door43(() => Response.json({ message: 'release not found' }, { status: 404 })).client, PROBE.owner, PROBE.repo, 1))).toMatchObject({ code: 'not_found' });
    expect(await failure(promoteRelease(door43(() => Response.json({ message: 'nope' }, { status: 500 })).client, PROBE.owner, PROBE.repo, 1))).toMatchObject({ kind: 'failed', reason: 'nope', status: 500 });
    expect(await failure(promoteRelease(door43(() => Promise.reject(new TypeError('fetch failed'))).client, PROBE.owner, PROBE.repo, 1))).toMatchObject({ kind: 'unknown' });
  });
});

describe('deleteBranch (E21, E27)', () => {
  test('R7: one DELETE of the branch; 204 and 404 are deleted, anything else is reported with the reason and never thrown', async () => {
    const { client, requests } = door43(() => new Response(null, { status: 204 }));
    expect(await deleteBranch(client, PROBE.owner, PROBE.repo, 'temp-tca-release/v1.1.0')).toEqual({ deleted: true });
    expect(requests).toEqual([{ method: 'DELETE', path: `/api/v1/repos/${PROBE.owner}/${PROBE.repo}/branches/temp-tca-release%2Fv1.1.0`, body: undefined }]);
    expect(await deleteBranch(door43(() => Response.json({ message: 'branch does not exist' }, { status: 404 })).client, PROBE.owner, PROBE.repo, 'b')).toEqual({ deleted: true });
    expect(await deleteBranch(door43(() => Response.json({ message: 'branch is protected' }, { status: 403 })).client, PROBE.owner, PROBE.repo, 'b')).toEqual({ deleted: false, reason: 'permission_denied' });
    expect(await deleteBranch(door43(() => Response.json({ message: 'cannot delete' }, { status: 500 })).client, PROBE.owner, PROBE.repo, 'b')).toEqual({ deleted: false, reason: 'cannot delete' });
    expect(await deleteBranch(door43(() => Promise.reject(new TypeError('fetch failed'))).client, PROBE.owner, PROBE.repo, 'b')).toMatchObject({ deleted: false });
  });
});
