// `owner.list` (#28): only the owners Door43 lets the account create a
// repository in are offered, read from the account's teams (E43), with the
// account itself last; an organization without that right is left out (A2).
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { ownerList } from '../../src/operations/owner-list';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const recorded = <T>(path: string): T => (JSON.parse(readFileSync(new URL(path, fixtures), 'utf8')) as { response: { json: T } }).response.json;
const user = recorded<{ id: number; login: string }>('2026-10-05/user/user.json');
const teams = recorded<unknown[]>('2026-10-05/user/user__teams.json');

const noPlans: KVNamespace = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
const NOW = new Date('2026-10-06T21:00:00.000Z');
let calls: string[] = [];
let pages: unknown[][] = [teams];
const door43: Fetch = async url => {
  const { pathname, searchParams } = new URL(url);
  calls.push(pathname);
  if (pathname === '/api/v1/user') return Response.json(user);
  if (pathname === '/api/v1/user/teams') return Response.json(pages[Number(searchParams.get('page') ?? '1') - 1] ?? []);
  return new Response('', { status: 404 });
};
const context = (token: string | null = 'door43-token'): OperationContext => {
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', token, noPlans);
  return { ...base, door43: base.door43 ? { ...base.door43, fetch: door43 } : null, now: () => NOW };
};
const team = (username: string, permission: string, canCreate: unknown, fullName = '') => ({ id: 1, organization: { username, name: username, full_name: fullName }, permission, can_create_org_repo: canCreate });
const list = async () => OPERATIONS['owner.list'].output.parse(await ownerList({}, context())).owners;

describe('owner.list', () => {
  test('A2: offers the organizations a team of the account may create in (E43), by name, then the account, live with its freshness', async () => {
    calls = [];
    pages = [teams];
    const output = OPERATIONS['owner.list'].output.parse(await ownerList({}, context()));
    expect(output.owners).toEqual([
      { login: 'tc-admin-qa-org', name: 'tc-admin-qa-org', kind: 'organization' },
      { login: 'tc-admin-qa', name: 'tc-admin-qa', kind: 'account' },
    ]);
    expect(output.freshness).toEqual({ read_at: '2026-10-06T21:00:00.000Z', source: 'live', age_seconds: 0 });
    // The teams are read to their empty last page, as the plan reads them.
    expect(calls).toEqual(['/api/v1/user', '/api/v1/user/teams', '/api/v1/user/teams']);
  });

  test('A2: an organization the account belongs to without the right is not offered, whatever the team order; a granting team on a later page grants', async () => {
    pages = [[team('read-only-org', 'read', false), team('writer-org', 'write', false), team('maker-org', 'write', true), team('read-only-org', 'owner', false), team('strange-org', 'owner', 'true')]];
    expect((await list()).map(owner => owner.login)).toEqual(['maker-org', 'read-only-org', 'strange-org', 'tc-admin-qa']);
    pages = [Array.from({ length: 50 }, (_, i) => ({ ...team('deny-org', 'write', false), id: i })), [team('late-org', 'owner', false)]];
    expect((await list()).map(owner => owner.login)).toEqual(['late-org', 'tc-admin-qa']);
    pages = [[team('writer-org', 'write', false)]];
    expect(await list()).toEqual([{ login: 'tc-admin-qa', name: 'tc-admin-qa', kind: 'account' }]);
    pages = [];
    expect(await list()).toEqual([{ login: 'tc-admin-qa', name: 'tc-admin-qa', kind: 'account' }]);
  });

  test('an organization is listed once with its display name, and never under the account\'s own login', async () => {
    pages = [[team('Big-Org', 'owner', true, 'The Big Organization'), team('big-org', 'write', true), team('tc-admin-qa', 'owner', true)]];
    expect(await list()).toEqual([
      { login: 'Big-Org', name: 'The Big Organization', kind: 'organization' },
      { login: 'tc-admin-qa', name: 'tc-admin-qa', kind: 'account' },
    ]);
  });

  test('session_expired without a session, and Door43 is not asked', async () => {
    calls = [];
    const failure = await ownerList({}, context(null)).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(CatalogError);
    expect((failure as CatalogError).code).toBe('session_expired');
    expect(calls).toEqual([]);
  });
});
