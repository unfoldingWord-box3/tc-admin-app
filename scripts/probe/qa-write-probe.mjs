#!/usr/bin/env node
// Live Door43 write probe for the Milestone 1 release operations (ADR 0012).
// Closes Q1 (md5 verification), Q2 (health latency, API-created branches, 422 sequence),
// Q3 (each write with a token, target_commitish as a commit SHA, `upload` without blob sha),
// Q5 (release readable after branch deletion), Q13 (66-book commit size) in docs/evidence.md.
//
// Usage:  node --env-file=.env scripts/probe/qa-write-probe.mjs [--plan] [--skip-size] [--cleanup]
//         node --env-file=.env scripts/probe/qa-write-probe.mjs --size-only tc-admin-qa-org/tca-probe-…   (Q13 only, on an existing probe repo)
//         (or TEST_TOKEN=… node scripts/probe/qa-write-probe.mjs). The token must be issued by the
//         DOOR43_ORIGIN host. On QA the tc-admin-qa-org organization may not exist yet; the probe then
//         creates the repository under the token's user, which needs "may create repositories" on QA.
// Env:    DOOR43_ORIGIN (default https://qa.door43.org; production is refused),
//         TEST_TOKEN (required), TEST_ORG (default tc-admin-qa-org; used when it exists on the host,
//         needs write:organization), TEST_USER. Falling back to the user namespace needs write:user (E26).
// Output: fixtures/door43/<host>/<date>/probe-write/NN-<step>.json (Authorization redacted)
//         and a summary.json; nothing secret is written.
// Effect: creates one public repository named tca-probe-<timestamp> under the org or the
//         token's user, with two releases and, unless --skip-size, one large branch.
//         The repository is left in place for inspection unless --cleanup is given.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const ORIGIN = (process.env.DOOR43_ORIGIN || 'https://qa.door43.org').replace(/\/+$/, '');
if (new URL(ORIGIN).host === 'git.door43.org') { console.error('Refusing to run against production: releases are never created there outside the demo and pilot plans.'); process.exit(2); }
const TOKEN = process.env.TEST_TOKEN;
const HOST = new URL(ORIGIN).host;
const today = new Date().toISOString().slice(0, 10);
const outDir = resolve(new URL('../..', import.meta.url).pathname, 'fixtures/door43', HOST, today, 'probe-write');
const fixtureDir = resolve(new URL('../..', import.meta.url).pathname, 'fixtures/door43/qa.door43.org/2026-09-21');
const POLL_MS = 5000, POLL_MAX_MS = 5 * 60 * 1000;

const plan = [
  '01 GET /user: token identity and host',
  '02 GET /orgs/{TEST_ORG}: use the org when it exists on this host, else the user namespace',
  '03 POST /orgs/{org}/repos or /user/repos: create tca-probe-<ts>, public, no auto-init',
  '04 POST /repos/{o}/{r}/contents: first commit, small Scripture Burrito (GEN + LICENSE), correct size and md5',
  '05 poll GET /healthcheck?ref=master every 5 s: record status sequence and latency (Q2)',
  '06 POST /releases v1.0.0 with target_commitish = commit SHA (Q3)',
  '07 poll GET /healthcheck?ref=v1.0.0: latency on a tag',
  '08 POST /branches temp-tca-release/v1.1.0 from old_ref_name v1.0.0 (Q3)',
  '09 POST /contents on the branch: add EXO, metadata with correct size but WRONG md5 for EXO; try operation "upload" for metadata.json without sha, fall back to "update" with sha (Q1, Q3)',
  '10 poll GET /healthcheck?ref=temp-tca-release/v1.1.0, then again after 8 s: does an API-created branch get checked; is md5 reported on a branch (Q1, Q2)',
  '11 POST /releases v1.1.0 prerelease=true with target_commitish = branch commit SHA; poll tag health',
  '12 PATCH /releases/{id} prerelease=false; GET /releases/tags/v1.1.0',
  '13 DELETE /branches/temp-tca-release/v1.1.0; GET /releases/tags/v1.1.0; GET /sb/v1.1.0.zip (Q5)',
  '14 unless --skip-size: POST /branches probe-size from master; one POST /contents with all 66 id_tb1 books (Q13)',
  '15 with --cleanup: DELETE /repos/{o}/{r}',
];
if (args.has('--plan')) { console.log(plan.join('\n')); process.exit(0); }
const sizeOnlyIndex = process.argv.indexOf('--size-only');
const sizeOnlyRepo = sizeOnlyIndex > -1 ? process.argv[sizeOnlyIndex + 1] : null;
if (!TOKEN) { console.error('TEST_TOKEN is required (see docs/evidence.md E23). Use --plan to print the steps.'); process.exit(2); }

mkdirSync(outDir, { recursive: true });
let step = 0;
const summary = { host: HOST, date: new Date().toISOString(), steps: [] };
function record(name, req, res, extra = {}) {
  step += 1;
  const file = join(outDir, `${String(step).padStart(2, '0')}-${name}.json`);
  const safeReq = { ...req, headers: { ...(req.headers || {}), authorization: req.headers?.authorization ? 'token [redacted]' : undefined } };
  if (safeReq.body && safeReq.body.length > 4000) safeReq.body = `[${safeReq.body.length} bytes omitted]`;
  writeFileSync(file, JSON.stringify({ request: safeReq, response: res, ...extra }, null, 2));
  summary.steps.push({ step, name, status: res.status, ms: res.ms, ...extra });
  const detail = typeof res.status === 'number' && res.status >= 400 && res.json ? `  ← ${res.json.message || res.json.error || JSON.stringify(res.json).slice(0, 300)}` : '';
  console.log(`${String(step).padStart(2, '0')} ${name}: ${res.status} (${res.ms} ms)${detail}`);
}
async function call(method, path, body, { raw = false, auth = true } = {}) {
  const url = path.startsWith('http') ? path : `${ORIGIN}/api/v1${path}`;
  const headers = { accept: raw ? '*/*' : 'application/json' };
  if (auth) headers.authorization = `token ${TOKEN}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const started = Date.now();
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const ms = Date.now() - started;
  const text = raw ? '' : await response.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { unparsed: text.slice(0, 2000) }; }
  const res = { status: response.status, ms, json, bytes: raw ? Number(response.headers.get('content-length')) : text.length };
  return { req: { method, url, headers, body: body === undefined ? undefined : JSON.stringify(body) }, res };
}
async function pollHealth(owner, repo, ref, name) {
  const started = Date.now(); const sequence = [];
  while (Date.now() - started < POLL_MAX_MS) {
    const { res } = await call('GET', `/repos/${owner}/${repo}/healthcheck?ref=${encodeURIComponent(ref)}`, undefined, { auth: false });
    const level = res.json?.data?.overall_severity_level ?? null;
    sequence.push({ t_ms: Date.now() - started, status: res.status, level, error: res.json?.error ?? null, issues: res.json?.data ? Object.fromEntries(Object.entries(res.json.data.issues || {}).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])) : null });
    if (res.status === 200 && level) { record(name, { method: 'GET', url: `healthcheck?ref=${ref}` }, { status: 200, ms: Date.now() - started, json: res.json }, { sequence, latency_ms: Date.now() - started }); return res.json; }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  record(name, { method: 'GET', url: `healthcheck?ref=${ref}` }, { status: 'timeout', ms: POLL_MAX_MS, json: null }, { sequence });
  return null;
}
const md5 = b => createHash('md5').update(b).digest('hex');
const b64 = b => Buffer.from(b).toString('base64');
async function rawFile(owner, repo, path) {
  const r = await fetch(`${ORIGIN}/${owner}/${repo}/raw/branch/master/${path}`); if (!r.ok) throw new Error(`raw ${path}: ${r.status}`); return Buffer.from(await r.arrayBuffer());
}
function metadataFor(base, owner, repo, ingredients, books) {
  const m = structuredClone(base);
  m.meta.generator = { softwareName: 'tC Admin probe', softwareVersion: '0.0.0', userName: '' };
  m.meta.dateCreated = new Date().toISOString();
  m.identification = { name: { en: 'tC Admin probe' }, abbreviation: { en: 'TCAP' }, primary: { dcs: { [`${owner}/${repo}`]: { revision: 'probe', timestamp: new Date().toISOString() } } } };
  m.type.flavorType.currentScope = Object.fromEntries(books.map(b => [b, []]));
  m.localizedNames = Object.fromEntries(Object.entries(base.localizedNames || {}).filter(([k]) => books.some(b => k.toLowerCase().endsWith(b.toLowerCase()))));
  m.ingredients = ingredients;
  return m;
}

async function sizeTest(owner, repo, baseMeta) {
  const branch = `probe-size-${Date.now()}`;
  let r = await call('POST', `/repos/${owner}/${repo}/branches`, { new_branch_name: branch, old_ref_name: 'master' }); record('branch-size', r.req, r.res);
  const books = Object.keys(baseMeta.ingredients || {}).filter(k => k.endsWith('.usfm'));
  const tree = await (await fetch(`${ORIGIN}/api/v1/repos/bahtraku/id_tb1/git/trees/master?recursive=true&per_page=1000`)).json();
  const files = []; let total = 0;
  for (const e of tree.tree.filter(e => e.type === 'blob' && e.path.endsWith('.usfm'))) { const buf = await rawFile('bahtraku', 'id_tb1', e.path); total += buf.length; files.push({ operation: 'upload', path: `ingredients/${e.path.replace(/^\d+-/, '')}`, content: b64(buf) }); }
  r = await call('POST', `/repos/${owner}/${repo}/contents`, { branch, message: `Probe: ${files.length} books in one commit`, files });
  record('size-commit', r.req, r.res, { files: files.length, raw_bytes: total, base64_bytes: files.reduce((n, f) => n + f.content.length, 0), books_expected: books.length });
}

(async () => {
  const baseMeta = JSON.parse(readFileSync(join(fixtureDir, 'sb-archives/bahtraku__id_tb1__master.metadata.json'), 'utf8'));
  let r;
  if (sizeOnlyRepo) {
    const [owner, repo] = sizeOnlyRepo.split('/'); summary.repository = sizeOnlyRepo;
    r = await call('GET', '/user'); record('user', r.req, r.res); if (r.res.status !== 200) throw new Error('token rejected');
    await sizeTest(owner, repo, baseMeta);
    writeFileSync(join(outDir, 'summary-size.json'), JSON.stringify(summary, null, 2));
    console.log(`\nDone. Recordings in ${outDir}. Add the Q13 result to docs/evidence.md.`); return;
  }
  r = await call('GET', '/user'); record('user', r.req, r.res); if (r.res.status !== 200) throw new Error('token rejected');
  const login = r.res.json.login;
  let owner = login, viaOrg = false;
  const org = process.env.TEST_ORG || 'tc-admin-qa-org';
  r = await call('GET', `/orgs/${org}`); record('org-lookup', r.req, r.res);
  if (r.res.status === 200) { owner = org; viaOrg = true; }
  else console.warn(`Organization ${org} not found on ${HOST}; creating under user ${login}, which needs the write:user scope (E26).`);
  const repo = `tca-probe-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  summary.repository = `${owner}/${repo}`;
  r = await call('POST', viaOrg ? `/orgs/${owner}/repos` : '/user/repos', { name: repo, private: false, auto_init: false, description: 'tC Admin write probe; safe to delete', default_branch: 'master' }); record('create-repo', r.req, r.res);
  if (r.res.status >= 300) throw new Error('repository creation failed');

  const gen = await rawFile('bahtraku', 'id_tb1', '01-GEN.usfm'), lic = await rawFile('bahtraku', 'id_tb1', 'LICENSE.md');
  const ing1 = { 'ingredients/GEN.usfm': { checksum: { md5: md5(gen) }, mimeType: 'text/plain', size: gen.length, scope: { GEN: [] } }, 'ingredients/LICENSE.md': { checksum: { md5: md5(lic) }, mimeType: 'text/markdown', size: lic.length, role: 'x-license' } };
  const meta1 = Buffer.from(JSON.stringify(metadataFor(baseMeta, owner, repo, ing1, ['GEN']), null, 2));
  r = await call('POST', `/repos/${owner}/${repo}/contents`, { message: 'Probe: first commit', files: [ { operation: 'create', path: 'metadata.json', content: b64(meta1) }, { operation: 'create', path: 'ingredients/GEN.usfm', content: b64(gen) }, { operation: 'create', path: 'ingredients/LICENSE.md', content: b64(lic) }, { operation: 'create', path: 'README.md', content: b64('# tC Admin write probe\n') } ] });
  record('first-commit', r.req, r.res); if (r.res.status >= 300) throw new Error('first commit failed');
  const sha1 = r.res.json.commit?.sha; summary.first_commit_sha = sha1;
  await pollHealth(owner, repo, 'master', 'health-master');

  r = await call('POST', `/repos/${owner}/${repo}/releases`, { tag_name: 'v1.0.0', name: 'v1.0.0', body: 'Probe release targeting a commit SHA', target_commitish: sha1, prerelease: false, draft: false }); record('release-v1.0.0-by-sha', r.req, r.res);
  if (r.res.status >= 300) { r = await call('POST', `/repos/${owner}/${repo}/releases`, { tag_name: 'v1.0.0', name: 'v1.0.0', body: 'Probe release targeting master', target_commitish: 'master', prerelease: false }); record('release-v1.0.0-by-branch', r.req, r.res); }
  await pollHealth(owner, repo, 'v1.0.0', 'health-tag-v1.0.0');

  r = await call('POST', `/repos/${owner}/${repo}/branches`, { new_branch_name: 'temp-tca-release/v1.1.0', old_ref_name: 'v1.0.0' }); record('branch-from-tag', r.req, r.res);
  const exo = await rawFile('bahtraku', 'id_tb1', '02-EXO.usfm');
  const ing2 = { ...ing1, 'ingredients/EXO.usfm': { checksum: { md5: '00000000000000000000000000000000' }, mimeType: 'text/plain', size: exo.length, scope: { EXO: [] } } };
  const meta2 = Buffer.from(JSON.stringify(metadataFor(baseMeta, owner, repo, ing2, ['GEN', 'EXO']), null, 2));
  r = await call('POST', `/repos/${owner}/${repo}/contents`, { branch: 'temp-tca-release/v1.1.0', message: 'Probe: snapshot with a wrong md5 for EXO', files: [ { operation: 'upload', path: 'metadata.json', content: b64(meta2) }, { operation: 'create', path: 'ingredients/EXO.usfm', content: b64(exo) } ] });
  record('branch-commit-upload', r.req, r.res, { note: 'operation upload for an existing file without sha' });
  if (r.res.status >= 300) {
    const cur = await call('GET', `/repos/${owner}/${repo}/contents/metadata.json?ref=${encodeURIComponent('temp-tca-release/v1.1.0')}`); record('metadata-sha', cur.req, cur.res);
    r = await call('POST', `/repos/${owner}/${repo}/contents`, { branch: 'temp-tca-release/v1.1.0', message: 'Probe: snapshot with a wrong md5 for EXO', files: [ { operation: 'update', path: 'metadata.json', content: b64(meta2), sha: cur.res.json?.sha }, { operation: 'create', path: 'ingredients/EXO.usfm', content: b64(exo) } ] });
    record('branch-commit-update', r.req, r.res);
  }
  const sha2 = r.res.json?.commit?.sha; summary.branch_commit_sha = sha2;
  await pollHealth(owner, repo, 'temp-tca-release/v1.1.0', 'health-branch');
  await new Promise(res => setTimeout(res, 8000));
  await pollHealth(owner, repo, 'temp-tca-release/v1.1.0', 'health-branch-recheck'); // Q1: is md5 verified on branches once the checker has caught up?

  r = await call('POST', `/repos/${owner}/${repo}/releases`, { tag_name: 'v1.1.0', name: 'v1.1.0', body: 'Probe pre-release', target_commitish: sha2, prerelease: true }); record('prerelease-v1.1.0', r.req, r.res);
  const releaseId = r.res.json?.id;
  await pollHealth(owner, repo, 'v1.1.0', 'health-tag-v1.1.0');
  r = await call('PATCH', `/repos/${owner}/${repo}/releases/${releaseId}`, { prerelease: false }); record('promote', r.req, r.res);
  r = await call('GET', `/repos/${owner}/${repo}/releases/tags/v1.1.0`); record('lookup-by-tag', r.req, r.res);
  r = await call('DELETE', `/repos/${owner}/${repo}/branches/${encodeURIComponent('temp-tca-release/v1.1.0')}`); record('delete-branch', r.req, r.res);
  r = await call('GET', `/repos/${owner}/${repo}/releases/tags/v1.1.0`); record('lookup-after-delete', r.req, r.res);
  r = await call('GET', `${ORIGIN}/${owner}/${repo}/sb/v1.1.0.zip`, undefined, { raw: true, auth: false }); record('sb-archive-after-delete', r.req, r.res);

  if (!args.has('--skip-size')) await sizeTest(owner, repo, baseMeta);
  if (args.has('--cleanup')) { r = await call('DELETE', `/repos/${owner}/${repo}`); record('cleanup', r.req, r.res); }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nDone. Repository ${summary.repository}. Recordings in ${outDir}. Now add the facts to docs/evidence.md (Q1, Q2, Q3, Q5, Q13).`);
})().catch(e => { console.error('probe failed:', e.message); writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ ...summary, failed: e.message }, null, 2)); process.exit(1); });
