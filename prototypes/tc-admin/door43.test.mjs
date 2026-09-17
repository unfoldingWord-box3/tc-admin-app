import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFromRepository } from './door43.mjs';
const base = { id: 1, owner: { login: 'team' }, name: 'sw_ult', title: 'Swahili Bible', subject: 'Bible', language: 'sw' };
test('missing health and coverage remain unknown', () => {
  const p = projectFromRepository(base);
  assert.equal(p.health, 'never_checked'); assert.equal(p.count, null);
});
test('coverage counts only recognized, existing, distinct books', () => {
  const p = projectFromRepository({ ...base, ingredients: [{identifier:'rut',exists:true},{identifier:'rut',exists:true},{identifier:'jon',exists:false},{identifier:'notes',exists:true}], healthcheck_severity:'warning' });
  assert.equal(p.count,1); assert.equal(p.health,'warning');
});
test('health errors and unsupported resources cannot appear healthy', () => {
  assert.equal(projectFromRepository({...base,healthcheck_severity:'error'}).health,'failing');
  assert.equal(projectFromRepository({...base,subject:'Translation Notes',healthcheck_severity:'success'}).health,'unsupported');
});
test('OBS counts existing story identifiers within 01–50', () => {
  assert.equal(projectFromRepository({...base,subject:'Open Bible Stories',ingredients:[{identifier:'01',exists:true},{identifier:'50',exists:true},{identifier:'51',exists:true},{identifier:'02',exists:false}]}).count,2);
});

test('an OBS container entry does not mean zero stories', () => {
  assert.equal(projectFromRepository({...base,subject:'Open Bible Stories',ingredients:[{identifier:'obs',exists:true,path:'./content'}]}).count,null);
});

test('QA API reads target QA only and keep tokens in server headers', async () => {
  const { readDoor43 } = await import('./door43.mjs');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin,'https://qa.door43.org');
    assert.equal(new URL(url).pathname,'/api/v1/user');
    assert.equal(options.headers.authorization,'Bearer test-only');
    assert.equal(options.redirect,'error');
    return new Response(JSON.stringify({id:1,login:'tester'}),{headers:{'content-type':'application/json'}});
  };
  try { assert.equal((await readDoor43({token:'test-only'},'/user')).login,'tester'); }
  finally { globalThis.fetch = originalFetch; }
});
test('QA account expiration requires a new login', async () => {
  const { readDoor43 } = await import('./door43.mjs');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('',{status:401});
  try { await assert.rejects(readDoor43({token:'test-only'},'/user'),error=>error.status===401); }
  finally { globalThis.fetch = originalFetch; }
});
test('pagination rejects repeated pages rather than loading forever', async () => {
  const { readPages } = await import('./door43.mjs');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({data:[{id:1}]}));
  try { await assert.rejects(readPages({token:'test-only'},'/repos/search'),/repeated/); }
  finally { globalThis.fetch = originalFetch; }
});
test('OAuth sends granular read scopes and PKCE only to QA', async () => {
  const { beginLogin } = await import('./door43.mjs');
  const old = process.env.DOOR43_QA_CLIENT_ID;
  process.env.DOOR43_QA_CLIENT_ID = 'test-public-client';
  try {
    const flow=await beginLogin('http://127.0.0.1:4173/auth/callback'), url=new URL(flow.url);
    assert.equal(url.origin,'https://qa.door43.org');
    assert.equal(url.searchParams.get('scope'),'read:user read:repository read:organization');
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    assert.ok(flow.verifier.length>=43);
  } finally { if(old===undefined) delete process.env.DOOR43_QA_CLIENT_ID; else process.env.DOOR43_QA_CLIENT_ID=old; }
});
