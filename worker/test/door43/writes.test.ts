// The Door43 writes (#30): sent once with the session's token and nothing
// else (A3, X1), mapped from the recorded QA responses of the write probe
// (E27), and no repository delete anywhere (W4).
import { readFileSync } from 'node:fs';
import { CatalogError } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { bytesToBase64, writeDoor43 } from '../../src/door43/api';
import type { Door43Client, Fetch } from '../../src/door43/api';
import { door43Host } from '../../src/door43/host';
import * as writes from '../../src/door43/writes';
import { commitFiles, createRepository, readRepositoryState } from '../../src/door43/writes';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/2026-09-22/probe-write/', import.meta.url);
const recorded = <T>(name: string): { request: { body?: string }; response: { status: number; json: T } } => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));
const createdRepo = recorded<{ id: number; full_name: string; html_url: string }>('03-create-repo.json');
const firstCommit = recorded<{ commit: { sha: string; html_url: string; author: { date: string } }; files: { path: string; sha: string }[] }>('04-first-commit.json');

const qa = door43Host('https://qa.door43.org');
const client = (fetch: Fetch): Door43Client => ({ host: qa, token: 'test-only', fetch });
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));

describe('one write', () => {
  test('A3: a write goes to the configured origin with the session token in the authorization header and a JSON body, once', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetch: Fetch = async (url, init) => {
      seen.push({ url, init });
      return json({ ok: true }, 201);
    };
    const outcome = await writeDoor43(client(fetch), 'POST', '/orgs/team/repos', { name: 'x' });
    expect(outcome).toEqual({ status: 201, body: { ok: true } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://qa.door43.org/api/v1/orgs/team/repos');
    const headers = new Headers(seen[0]!.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-only');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('cookie')).toBe(false);
    expect(seen[0]!.init?.method).toBe('POST');
    expect(seen[0]!.init?.redirect).toBe('manual');
    expect(String(seen[0]!.init?.body)).toBe('{"name":"x"}');
  });

  test('X1: a write that times out or fails on the network raises door43_unavailable after one request, never a second', async () => {
    let requests = 0;
    const failing: Fetch = async () => {
      requests += 1;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    expect((await failure(writeDoor43(client(failing), 'POST', '/orgs/team/repos', {})))!.code).toBe('door43_unavailable');
    expect(requests).toBe(1);
    expect((await failure(commitFiles(client(failing), 'team', 'r', { message: 'm', files: [{ path: 'a', content: 'b' }] })))!.code).toBe('door43_unavailable');
    expect(requests).toBe(2);
  });

  test('X1: a write whose status arrives but whose body breaks off raises door43_unavailable with the status, after one request', async () => {
    let requests = 0;
    const brokenBody: Fetch = async () => {
      requests += 1;
      return new Response(new ReadableStream({ start: controller => controller.error(new TypeError('terminated')) }), { status: 201 });
    };
    const error = (await failure(writeDoor43(client(brokenBody), 'POST', '/orgs/team/repos', {})))!;
    expect(error.code).toBe('door43_unavailable');
    expect(error.details).toMatchObject({ door43_status: 201, reason: 'unreadable response body' });
    expect(requests).toBe(1);
  });

  test('401 is session_expired and 403 permission_denied; other statuses are returned for the endpoint to map', async () => {
    const status = (code: number) => writeDoor43(client(async () => new Response('{"message":"no"}', { status: code })), 'POST', '/x', {});
    expect((await failure(status(401)))!.code).toBe('session_expired');
    expect((await failure(status(403)))!.code).toBe('permission_denied');
    expect(await status(409)).toEqual({ status: 409, body: { message: 'no' } });
    expect(await status(500)).toEqual({ status: 500, body: { message: 'no' } });
  });

  test('a body that is not JSON is kept as a message', async () => {
    expect(await writeDoor43(client(async () => new Response('Bad gateway', { status: 502 })), 'POST', '/x', {})).toEqual({ status: 502, body: { message: 'Bad gateway' } });
  });

  test('base64 round-trips bytes of any length, including past one chunk', () => {
    for (const length of [0, 1, 2, 3, 0x7fff, 0x8000, 0x8001, 100_003]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 7919) % 256);
      expect(Buffer.from(bytesToBase64(bytes), 'base64')).toEqual(Buffer.from(bytes));
    }
  });
});

describe('a created repository whose answer broke off', () => {
  test('X1, W4: Door43 said 201 and the body broke off: the repository is read back once instead of being lost', async () => {
    const urls: string[] = [];
    const fetch: Fetch = async (url, init) => {
      urls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      return (init?.method ?? 'GET') === 'POST'
        ? new Response(new ReadableStream({ start: controller => controller.error(new TypeError('terminated')) }), { status: 201 })
        : json(createdRepo.response.json, 200);
    };
    const repository = await createRepository(client(fetch), { login: 'tc-admin-qa-org', kind: 'organization' }, { name: 'tca-probe-20260922194921', description: '' });
    expect(repository.id).toBe(96475);
    expect(urls).toEqual(['POST /api/v1/orgs/tc-admin-qa-org/repos', 'GET /api/v1/repos/tc-admin-qa-org/tca-probe-20260922194921']);
  });

  test('X1: a refused commit is a failed outcome with its status; a created commit Door43 did not name is an unknown one', async () => {
    const refused = (await failure(commitFiles(client(async () => json({ message: 'no' }, 500)), 'o', 'r', { message: 'm', files: [] })))!;
    expect(refused.details).toMatchObject({ outcome: 'failed', door43_status: 500 });
    const unnamed = (await failure(commitFiles(client(async () => json({ files: [] }, 201)), 'o', 'r', { message: 'm', files: [] })))!;
    expect(unnamed.code).toBe('commit_failed');
    expect(unnamed.details).toMatchObject({ outcome: 'unknown', door43_status: 201 });
  });
});

describe('createRepository', () => {
  test('A3: sends CreateRepoOption to the organization route, public and not initialized, and maps the recorded 201 (E27)', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fetch: Fetch = async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return json(createdRepo.response.json, 201);
    };
    const repository = await createRepository(client(fetch), { login: 'tc-admin-qa-org', kind: 'organization' }, { name: 'tca-probe-20260922194921', description: 'tC Admin write probe' });
    expect(seen).toEqual([
      {
        url: 'https://qa.door43.org/api/v1/orgs/tc-admin-qa-org/repos',
        body: { name: 'tca-probe-20260922194921', description: 'tC Admin write probe', private: false, auto_init: false, default_branch: 'master' },
      },
    ]);
    expect(repository).toEqual({
      id: 96475,
      full_name: 'tc-admin-qa-org/tca-probe-20260922194921',
      url: 'https://qa.door43.org/tc-admin-qa-org/tca-probe-20260922194921',
      default_branch: 'master',
      permissions: { push: true, admin: true },
    });
  });

  test('the account itself is created under /user/repos (E26)', async () => {
    const urls: string[] = [];
    await createRepository(client(async url => (urls.push(url), json(createdRepo.response.json, 201))), { login: 'tc-admin-qa', kind: 'account' }, { name: 'id_x', description: '' });
    expect(urls).toEqual(['https://qa.door43.org/api/v1/user/repos']);
  });

  test('Door43 statuses become catalog codes: 409 name_taken with the catalog message, 422 validation_failed quoting Door43, 404 not_found, 500 door43_unavailable', async () => {
    const answer = (status: number, body: unknown) => createRepository(client(async () => json(body, status)), { login: 'team', kind: 'organization' }, { name: 'en_ult', description: '' });
    const taken = (await failure(answer(409, { message: 'The repository with the same name already exists.' })))!;
    expect(taken.code).toBe('name_taken');
    expect(taken.message).toBe('A repository named en_ult already exists in team. Change the abbreviation.');
    const invalid = (await failure(answer(422, { message: 'repo name is invalid' })))!;
    expect(invalid.code).toBe('validation_failed');
    expect(invalid.message).toBe('abbreviation: repo name is invalid');
    expect((await failure(answer(404, {})))!.code).toBe('not_found');
    expect((await failure(answer(500, {})))!.code).toBe('door43_unavailable');
    expect((await failure(answer(201, { name: 'no id' })))!.code).toBe('door43_unavailable');
  });
});

describe('commitFiles', () => {
  test('W5: one contents call carries every file as base64 create operations, no branch for a first commit, no author or committer, and maps the recorded 201 (E27)', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const fetch: Fetch = async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return json(firstCommit.response.json, 201);
    };
    const commit = await commitFiles(client(fetch), 'tc-admin-qa-org', 'tca-probe-20260922194921', {
      message: 'Probe: first commit',
      files: [
        { path: 'metadata.json', content: '{}\n' },
        { path: 'ingredients/license.md', content: new TextEncoder().encode('# License\n') },
      ],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://qa.door43.org/api/v1/repos/tc-admin-qa-org/tca-probe-20260922194921/contents');
    expect(seen[0]!.body).toEqual({
      message: 'Probe: first commit',
      files: [
        { operation: 'create', path: 'metadata.json', content: Buffer.from('{}\n').toString('base64') },
        { operation: 'create', path: 'ingredients/license.md', content: Buffer.from('# License\n').toString('base64') },
      ],
    });
    expect(Object.keys(seen[0]!.body)).not.toContain('author');
    expect(Object.keys(seen[0]!.body)).not.toContain('committer');
    expect(commit).toEqual({
      sha: '29837149cfb365960af59d033abd1ff5929bcffe',
      url: 'https://qa.door43.org/tc-admin-qa-org/tca-probe-20260922194921/commit/29837149cfb365960af59d033abd1ff5929bcffe',
      committed_at: '2026-09-22T19:49:22Z',
      files: firstCommit.response.json.files.map(file => ({ path: file.path, sha: file.sha })),
    });
  });

  test('a branch and an operation are sent when given', async () => {
    let body: Record<string, unknown> = {};
    await commitFiles(client(async (_url, init) => ((body = JSON.parse(String(init?.body))), json(firstCommit.response.json, 201))), 'o', 'r', {
      message: 'm',
      branch: 'temp-tca-release/v1.1.0',
      files: [{ path: 'metadata.json', content: '{}', operation: 'upload' }],
    });
    expect(body.branch).toBe('temp-tca-release/v1.1.0');
    expect((body.files as { operation: string }[])[0]!.operation).toBe('upload');
  });

  test('anything but a created commit is commit_failed quoting Door43', async () => {
    const error = (await failure(commitFiles(client(async () => json({ message: 'repository is empty' }, 422)), 'o', 'r', { message: 'm', files: [] })))!;
    expect(error.code).toBe('commit_failed');
    expect(error.message).toBe('Commit failed: repository is empty.');
    expect((await failure(commitFiles(client(async () => json({ files: [] }, 201)), 'o', 'r', { message: 'm', files: [] })))!.code).toBe('commit_failed');
  });
});

describe('the adapter surface', () => {
  test('W4: there is no repository delete', () => {
    expect(Object.keys(writes).filter(name => /delete|remove/i.test(name))).toEqual([]);
  });
});

describe('a commit that deletes a file (E55)', () => {
  test('R2: Door43 lists the deleted file as null in its answer; the commit is read with the files it left, and the null is skipped', async () => {
    const deleting = JSON.parse(readFileSync(new URL('../../2026-10-07/contents-delete/POST-contents-delete-MRK.json', fixtures), 'utf8')) as { response: { status: number; json: unknown } };
    const commit = await commitFiles(client(async () => Response.json(deleting.response.json, { status: deleting.response.status })), 'tc-admin-qa', 'id_tcar1546', {
      message: 'm',
      branch: 'temp-tca-release/v2.0.0',
      files: [
        { path: 'ingredients/MRK.usfm', operation: 'delete', sha: '0000000000000000000000000000000000000000' },
        { path: 'metadata.json', content: new Uint8Array([123, 125]), operation: 'upload' },
      ],
    });
    expect(commit.sha).toBe('ad7c29a9ea1ba6e6fc4da6f67fbbdf84da2b5fb7');
    expect(commit.files).toEqual([{ path: 'metadata.json', sha: '91baa09de40914344e92dccbacf85d60877d2932' }]);
  });
});

describe('the state of a created repository (#31)', () => {
  const created = new URL('../../2026-10-05/project-create/tc-admin-qa-org/', fixtures);
  const answer = (name: string) => (JSON.parse(readFileSync(new URL(name, created), 'utf8')) as { response: { json: unknown } }).response.json;

  test('W4: Door43 says a repository created without a commit is empty, with its owner and creation time to the second (E45)', async () => {
    const state = await readRepositoryState(client(async () => json(answer('07-POST-orgs_tc-admin-qa-org_repos.json'), 200)), 'tc-admin-qa-org', 'id_tcap1856');
    expect(state).toMatchObject({ owner: 'tc-admin-qa-org', empty: true, created_at: '2026-10-05T18:56:41Z' });
    expect(state.repository).toMatchObject({ full_name: 'tc-admin-qa-org/id_tcap1856', default_branch: 'master', permissions: { push: true, admin: true } });
  });

  test('X1: and no longer empty once its first commit is made (E45)', async () => {
    const state = await readRepositoryState(client(async () => json(answer('10-GET-repos_catalog-view.json'), 200)), 'tc-admin-qa-org', 'id_tcap1856');
    expect(state.empty).toBe(false);
  });

  test('X1: an answer that does not say whether it is empty says nothing, and a missing repository is not_found', async () => {
    const body = { ...(answer('07-POST-orgs_tc-admin-qa-org_repos.json') as Record<string, unknown>), empty: 'yes' };
    expect((await readRepositoryState(client(async () => json(body, 200)), 'o', 'r')).empty).toBeNull();
    expect((await failure(readRepositoryState(client(async () => json({ message: 'not found' }, 404)), 'o', 'r')))!.code).toBe('not_found');
  });
});
