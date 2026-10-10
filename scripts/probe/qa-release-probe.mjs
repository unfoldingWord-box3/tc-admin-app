#!/usr/bin/env node
// Live QA probe of the release flow (#33, #34, #36, #39, #40, #58): the Worker's own
// operation code, bundled with esbuild, against QA Door43 with TEST_TOKEN standing in
// for the session's token, so what it records is what the Worker would write.
//
// Usage:  node --env-file=.env scripts/probe/qa-release-probe.mjs [--owner <login>] [--out <folder>] [--plan]
// Env:    DOOR43_ORIGIN (default https://qa.door43.org; production is refused), TEST_TOKEN (required),
//         TEST_USER (the default owner: the token's own namespace, E49).
// Output: fixtures/door43/<host>/<date>/release-flow/<owner>/NN-<METHOD>-<path>.json (the token redacted, large
//         request bodies replaced by a note), the plans, preparations, and receipts of each step, and summary.json.
// Effect: creates one public Bible repository id_tcar<stamp> under the owner with two books from
//         bahtraku/Perjanjian-Baru-Pendau (public on QA), releases it as v1.0.0 (pre-release, then promoted),
//         changes one book and adds one, releases v1.1.0 with both included, prepares a third release and
//         discards it. The repository is left in place for inspection.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index > -1 ? argv[index + 1] : fallback;
};
const ORIGIN = (process.env.DOOR43_ORIGIN || 'https://qa.door43.org').replace(/\/+$/, '');
if (ORIGIN !== 'https://qa.door43.org') {
  console.error(`Refusing to run against ${ORIGIN}: this probe writes to https://qa.door43.org only.`);
  process.exit(2);
}
const TOKEN = process.env.TEST_TOKEN;
const HOST = new URL(ORIGIN).host;
const root = resolve(new URL('../..', import.meta.url).pathname);
const today = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString().slice(11, 16).replace(':', '');
const SOURCE = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };

const plan = [
  '00 bundle worker/src/operations/index.ts with esbuild; GET /version (public)',
  '01 seed: project.create.plan and project.create.apply (a Bible, New Testament scope); one POST /contents adding MAT and JHN from Perjanjian-Baru-Pendau with their metadata entries; wait for the catalog to index the commit',
  '02 first release: release.plan (every book included), release.prepare (branch from the default head, the commits), preparation.read polled until the health is in, release.create as a pre-release v1.0.0, release.lookup, release.promote; wait for catalog.prod',
  '03 second release: POST /contents changing MAT and adding MRK; release.plan (MAT carried forward, MRK left out by default), release.prepare including both, preparation.read, release.create v1.1.0 (full), release.lookup; GET /sb/v1.1.0.zip (public)',
  '04 discard: release.plan, release.prepare (the defaults: everything carried forward), preparation.discard; GET /repos/{owner}/{repo}/branches (public) shows no temp-tca-release branch',
];
if (argv.includes('--plan')) {
  console.log(plan.join('\n'));
  process.exit(0);
}
if (!TOKEN) {
  console.error('TEST_TOKEN is required (docs/evidence.md E23). Use --plan to print the steps.');
  process.exit(2);
}

const bundle = join(tmpdir(), 'tc-admin-probe', 'operations-release.mjs');
mkdirSync(join(tmpdir(), 'tc-admin-probe'), { recursive: true });
execFileSync(join(root, 'node_modules/.bin/esbuild'), [join(root, 'worker/src/operations/index.ts'), '--bundle', '--format=esm', '--platform=neutral', '--target=es2022', '--log-level=warning', `--outfile=${bundle}`]);
const { HANDLERS, operationContext } = await import(pathToFileURL(bundle).href);

let outDir;
let step = 0;
const summary = { host: HOST, date: new Date().toISOString(), steps: [], phases: {} };
/** Every non-empty `email` in an answer, at any depth (the user, and each release's and commit's author), as `[redacted]`. */
const redactEmails = value => {
  if (Array.isArray(value)) value.forEach(redactEmails);
  else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) {
    if (key === 'email' && typeof inner === 'string' && inner) value[key] = '[redacted]';
    else redactEmails(inner);
  }
  return value;
};
/** Every `content` longer than 4000 characters (a whole file as base64, as the contents endpoint answers it) as its length only. */
const omitLargeContent = value => {
  if (Array.isArray(value)) value.forEach(omitLargeContent);
  else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) {
    if (key === 'content' && typeof inner === 'string' && inner.length > 4000) value[key] = `[${inner.length} bytes of base64 omitted]`;
    else omitLargeContent(inner);
  }
  return value;
};
const redactHeaders = headers => {
  const safe = Object.fromEntries(new Headers(headers));
  if (safe.authorization) safe.authorization = 'token [redacted]';
  return safe;
};
function record(name, request, response, extra = {}) {
  step += 1;
  writeFileSync(join(outDir, `${String(step).padStart(2, '0')}-${name}.json`), JSON.stringify({ request, response, ...extra }, null, 2));
  summary.steps.push({ step, name, status: response.status, ms: response.ms, ...extra });
  const detail = typeof response.status === 'number' && response.status >= 400 && response.json ? `  ← ${response.json.message || response.json.error || JSON.stringify(response.json).slice(0, 300)}` : '';
  console.log(`${String(step).padStart(2, '0')} ${name}: ${response.status} (${response.ms} ms)${detail}`);
}
const stepName = (method, url) => `${method}-${new URL(url).pathname.replace(/^\/api\/v1\//, '').replace(/[^A-Za-z0-9._-]+/g, '_')}`;
const save = (name, value) => writeFileSync(join(outDir, `${name}.json`), JSON.stringify(value, null, 2));

const recording = async (url, init = {}) => {
  const started = Date.now();
  const response = await fetch(url, init);
  const ms = Date.now() - started;
  const text = await response.clone().text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text.length > 2000 ? { unparsed: `[${text.length} bytes]` } : { unparsed: text };
  }
  redactEmails(json);
  omitLargeContent(json);
  const method = init.method || 'GET';
  let body = init.body === undefined ? undefined : String(init.body);
  if (body && body.length > 4000) body = `[${body.length} bytes omitted: file contents as base64]`;
  if (new URL(url).pathname.endsWith('.zip')) json = { archive_bytes: Number(response.headers.get('content-length')) || null };
  record(stepName(method, url), { method, url, headers: redactHeaders(init.headers), body }, { status: response.status, ms, json });
  return response;
};

const publicCall = async (path, init = {}) => {
  const url = path.startsWith('http') ? path : `${ORIGIN}/api/v1${path}`;
  const started = Date.now();
  const response = await fetch(url, { headers: { accept: 'application/json', ...(init.headers || {}) }, redirect: 'manual', ...init });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { unparsed: text.slice(0, 2000) };
  }
  return { request: { method: init.method || 'GET', url }, response: { status: response.status, ms: Date.now() - started, json } };
};
const tokenCall = (path, init = {}) => publicCall(path, { ...init, headers: { authorization: `token ${TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Wait until Door43's catalog carries the commit on `latest` (and `prod` when a tag is named), up to 3 minutes (E28). */
async function waitForCatalog(owner, repo, { latest, prod } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < 3 * 60 * 1000) {
    last = await publicCall(`/repos/${owner}/${repo}`);
    const catalog = last.response.json?.catalog || {};
    const okLatest = !latest || catalog.latest?.commit_sha === latest;
    const okProd = !prod || catalog.prod?.branch_or_tag_name === prod;
    if (okLatest && okProd) {
      record(`GET-repos_catalog-view`, last.request, { ...last.response, ms: Date.now() - started }, { waited_ms: Date.now() - started, latest: catalog.latest, prod: catalog.prod });
      return catalog;
    }
    await sleep(5000);
  }
  record(`GET-repos_catalog-view-timeout`, last.request, last.response, { waited_ms: Date.now() - started });
  throw new Error(`the catalog did not index ${latest ?? ''} ${prod ?? ''} within 3 minutes`);
}

/** preparation.read every 5 s until the health is in, up to 3 minutes (HEALTH_POLL). */
async function readUntilHealth(context, ref, id) {
  const started = Date.now();
  let read;
  while (Date.now() - started < 3 * 60 * 1000) {
    read = await HANDLERS['preparation.read']({ ...ref, preparation_id: id }, context);
    if (read.state !== 'health_checking') break;
    await sleep(5000);
  }
  return { ...read, waited_ms: Date.now() - started };
}

const md5 = bytes => createHash('md5').update(bytes).digest('hex');
const b64 = bytes => Buffer.from(bytes).toString('base64');
const raw = async (owner, repo, path, ref) => {
  const response = await fetch(`${ORIGIN}/${owner}/${repo}/raw/branch/${ref}/${path}`);
  if (!response.ok) throw new Error(`raw ${owner}/${repo}/${path}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const ingredient = (bytes, book) => ({ checksum: { md5: md5(bytes) }, mimeType: 'text/x-usfm', size: bytes.length, scope: { [book]: [] } });

const memoryKV = () => {
  const entries = new Map();
  return { get: async key => entries.get(key) ?? null, put: async (key, value) => void entries.set(key, value), delete: async key => void entries.delete(key), entries };
};
const fail = (phase, error) => {
  summary.phases[phase] = { ...(summary.phases[phase] || {}), error: { code: error.code, message: error.message, details: error.details } };
  save('summary', summary);
  throw error;
};

(async () => {
  const version = await publicCall('/version');
  summary.dcs_version = version.response.json?.version ?? null;
  const kv = memoryKV();
  const base = operationContext({ door43Origin: ORIGIN, door43ClientId: 'probe' }, `probe-${Date.now()}`, TOKEN, kv);
  const context = { ...base, door43: { ...base.door43, fetch: recording } };
  let owner = flag('--owner', process.env.TEST_USER || '');
  if (!owner) owner = (await tokenCall('/user')).response.json.login;
  outDir = resolve(root, 'fixtures/door43', HOST, today, 'release-flow', flag('--out', owner));
  mkdirSync(outDir, { recursive: true });
  const abbreviation = `tcar${stamp}`;
  const repo = `id_${abbreviation}`;
  const ref = { owner, repo };
  console.log(`Owner ${owner}, repository ${repo}, recordings in ${outDir}`);

  // 01 seed
  const phase1 = (summary.phases.seed = {});
  // Each repository's branch is the default_branch Door43 answers for it (#170): the new project's from its receipt
  // (main since #167), the source's from its repository read (master for Pendau).
  let branch;
  const sourceBranch = (await publicCall(`/repos/${SOURCE.owner}/${SOURCE.repo}`)).response.json?.default_branch;
  if (typeof sourceBranch !== 'string' || !sourceBranch) throw new Error(`Door43 names no default branch for ${SOURCE.owner}/${SOURCE.repo}`);
  try {
    const created = await HANDLERS['project.create.plan']({ owner, project_type: 'bible', title: `tC Admin release probe ${today} ${stamp}`, abbreviation, language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' }, testament_scope: 'nt', license: 'cc-by-sa-4.0' }, context);
    const applied = await HANDLERS['project.create.apply']({ plan_id: created.id }, context);
    save('seed-receipt', applied);
    branch = applied.result.default_branch;
    phase1.created = { repo: created.preview.repo_name, setup: applied.result.setup.state, default_branch: branch };
    const metadata = JSON.parse((await raw(owner, repo, 'metadata.json', branch)).toString('utf8'));
    const mat = await raw(SOURCE.owner, SOURCE.repo, 'ingredients/MAT.usfm', sourceBranch);
    const jhn = await raw(SOURCE.owner, SOURCE.repo, 'ingredients/JHN.usfm', sourceBranch);
    metadata.ingredients['ingredients/MAT.usfm'] = ingredient(mat, 'MAT');
    metadata.ingredients['ingredients/JHN.usfm'] = ingredient(jhn, 'JHN');
    metadata.type.flavorType.currentScope = { MAT: [], JHN: [] };
    metadata.localizedNames = { MAT: { short: { id: 'Matius' }, long: { id: 'Injil Matius' }, abbr: { id: 'Mat' } }, JHN: { short: { id: 'Yohanes' }, long: { id: 'Injil Yohanes' }, abbr: { id: 'Yoh' } } };
    const seed = await tokenCall(`/repos/${owner}/${repo}/contents`, {
      method: 'POST',
      body: JSON.stringify({ branch, message: 'Add Matthew and John from Perjanjian-Baru-Pendau (probe seed)', files: [
        { operation: 'upload', path: 'ingredients/MAT.usfm', content: b64(mat) },
        { operation: 'upload', path: 'ingredients/JHN.usfm', content: b64(jhn) },
        { operation: 'upload', path: 'metadata.json', content: b64(Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)) },
      ] }),
    });
    record('POST-contents-seed', { ...seed.request, body: '[two books and metadata.json as base64]' }, { ...seed.response, json: seed.response.json?.commit ? { commit: { sha: seed.response.json.commit.sha } } : seed.response.json });
    if (seed.response.status !== 201) throw new Error(`seed commit: ${seed.response.status}`);
    phase1.seed_sha = seed.response.json.commit.sha;
    await waitForCatalog(owner, repo, { latest: phase1.seed_sha });
  } catch (error) {
    fail('seed', error);
  }

  // 02 first release
  const phase2 = (summary.phases.first_release = {});
  try {
    const plan1 = await HANDLERS['release.plan'](ref, context);
    save('release-plan-1', plan1);
    phase2.plan = { id: plan1.id, books: plan1.preview.books, version: plan1.preview.version, would_write: plan1.would_write };
    console.log(`plan 1: ${plan1.preview.books.map(b => `${b.id} ${b.group}/${b.selection}`).join(', ')}; ${plan1.preview.version.proposed}`);
    const selection = Object.fromEntries(plan1.preview.books.map(b => [b.id, b.selection]));
    const prepared = await HANDLERS['release.prepare']({ ...ref, plan_id: plan1.id, selection, unknown_included: [], version: null }, context);
    save('release-prepare-1', prepared);
    phase2.prepare = { wrote: prepared.wrote, state: prepared.result.state, files: prepared.result.snapshot.files.length };
    const read = await readUntilHealth(context, ref, prepared.result.id);
    save('preparation-read-1', read);
    phase2.read = { state: read.state, health: read.health.state, severity_raw: read.health.severity_raw, issues: read.health.issue_count, waited_ms: read.waited_ms, requires_acknowledgement: read.requires_acknowledgement };
    console.log(`preparation ${read.id}: ${read.state}, health ${read.health.state} after ${read.waited_ms} ms`);
    const created = await HANDLERS['release.create']({ ...ref, preparation_id: read.id, version: read.version.confirmed, notes: read.notes.draft, prerelease: true, acknowledge_warnings: read.requires_acknowledgement }, context);
    save('release-create-1', created);
    phase2.create = { wrote: created.wrote, warnings: created.warnings, state: created.result.state, release: created.result.release };
    const lookup = await HANDLERS['release.lookup']({ ...ref, tag: created.result.release.tag }, context);
    phase2.lookup = lookup;
    const promoted = await HANDLERS['release.promote']({ ...ref, tag: created.result.release.tag }, context);
    save('release-promote-1', promoted);
    phase2.promote = promoted.result;
    await waitForCatalog(owner, repo, { prod: created.result.release.tag });
  } catch (error) {
    fail('first_release', error);
  }

  // 03 second release
  const phase3 = (summary.phases.second_release = {});
  try {
    const current = JSON.parse((await raw(owner, repo, 'metadata.json', branch)).toString('utf8'));
    const mat = Buffer.concat([await raw(owner, repo, 'ingredients/MAT.usfm', branch), Buffer.from('\n\\rem Revised for the tC Admin release probe.\n')]);
    const mrk = await raw(SOURCE.owner, SOURCE.repo, 'ingredients/MRK.usfm', sourceBranch);
    current.ingredients['ingredients/MAT.usfm'] = ingredient(mat, 'MAT');
    current.ingredients['ingredients/MRK.usfm'] = ingredient(mrk, 'MRK');
    current.type.flavorType.currentScope = { MAT: [], MRK: [], JHN: [] };
    current.localizedNames.MRK = { short: { id: 'Markus' }, long: { id: 'Injil Markus' }, abbr: { id: 'Mrk' } };
    const change = await tokenCall(`/repos/${owner}/${repo}/contents`, {
      method: 'POST',
      body: JSON.stringify({ branch, message: 'Revise Matthew, add Mark (probe)', files: [
        { operation: 'upload', path: 'ingredients/MAT.usfm', content: b64(mat) },
        { operation: 'upload', path: 'ingredients/MRK.usfm', content: b64(mrk) },
        { operation: 'upload', path: 'metadata.json', content: b64(Buffer.from(`${JSON.stringify(current, null, 2)}\n`)) },
      ] }),
    });
    record('POST-contents-change', { ...change.request, body: '[two books and metadata.json as base64]' }, { ...change.response, json: change.response.json?.commit ? { commit: { sha: change.response.json.commit.sha } } : change.response.json });
    if (change.response.status !== 201) throw new Error(`change commit: ${change.response.status}`);
    phase3.change_sha = change.response.json.commit.sha;
    await waitForCatalog(owner, repo, { latest: phase3.change_sha });
    const plan2 = await HANDLERS['release.plan'](ref, context);
    save('release-plan-2', plan2);
    phase3.plan = { id: plan2.id, books: plan2.preview.books, removals: plan2.preview.removals, version: plan2.preview.version, would_write: plan2.would_write };
    console.log(`plan 2: ${plan2.preview.books.map(b => `${b.id} ${b.group}/${b.selection}`).join(', ')}; ${plan2.preview.version.proposed}`);
    const selection = Object.fromEntries(plan2.preview.books.map(b => [b.id, b.id === 'mat' || b.id === 'mrk' ? 'include' : b.selection]));
    const prepared = await HANDLERS['release.prepare']({ ...ref, plan_id: plan2.id, selection, unknown_included: [], version: null }, context);
    save('release-prepare-2', prepared);
    phase3.prepare = { wrote: prepared.wrote, state: prepared.result.state, selection: prepared.result.selection, files: prepared.result.snapshot.files };
    const read = await readUntilHealth(context, ref, prepared.result.id);
    save('preparation-read-2', read);
    phase3.read = { state: read.state, health: read.health.state, severity_raw: read.health.severity_raw, issues: read.health.issues, waited_ms: read.waited_ms };
    console.log(`preparation ${read.id}: ${read.state}, health ${read.health.state} after ${read.waited_ms} ms`);
    const created = await HANDLERS['release.create']({ ...ref, preparation_id: read.id, version: read.version.confirmed, notes: read.notes.draft, prerelease: false, acknowledge_warnings: read.requires_acknowledgement }, context);
    save('release-create-2', created);
    phase3.create = { wrote: created.wrote, warnings: created.warnings, state: created.result.state, release: created.result.release };
    phase3.lookup = await HANDLERS['release.lookup']({ ...ref, tag: created.result.release.tag }, context);
    // The archive's own size, from its bytes: publicCall reads text and keeps 2,000 characters of it, which measures nothing.
    const archiveUrl = `${ORIGIN}/${owner}/${repo}/sb/${created.result.release.tag}.zip`;
    const archiveStarted = Date.now();
    const archive = await fetch(archiveUrl, { redirect: 'manual' });
    const archiveBytes = archive.ok ? (await archive.arrayBuffer()).byteLength : null;
    record('GET-sb-archive-after-release', { method: 'GET', url: archiveUrl }, { status: archive.status, ms: Date.now() - archiveStarted, json: { archive_bytes: archiveBytes } });
    phase3.archive_status = archive.status;
  } catch (error) {
    fail('second_release', error);
  }

  // 04 discard
  const phase4 = (summary.phases.discard = {});
  try {
    const plan3 = await HANDLERS['release.plan'](ref, context);
    save('release-plan-3', plan3);
    phase4.plan = { id: plan3.id, books: plan3.preview.books, version: plan3.preview.version };
    const selection = Object.fromEntries(plan3.preview.books.map(b => [b.id, b.selection]));
    const prepared = await HANDLERS['release.prepare']({ ...ref, plan_id: plan3.id, selection, unknown_included: [], version: null }, context);
    save('release-prepare-3', prepared);
    phase4.prepare = { wrote: prepared.wrote, state: prepared.result.state };
    const discarded = await HANDLERS['preparation.discard']({ ...ref, preparation_id: prepared.result.id }, context);
    save('preparation-discard-3', discarded);
    phase4.discard = { wrote: discarded.wrote, state: discarded.result.state };
    const branches = await publicCall(`/repos/${owner}/${repo}/branches`);
    record('GET-branches-after-discard', branches.request, branches.response);
    phase4.branches = (branches.response.json || []).map(b => b.name);
  } catch (error) {
    fail('discard', error);
  }
  summary.repository = `${owner}/${repo}`;
  save('summary', summary);
  console.log(`done: ${owner}/${repo}; phases ${Object.keys(summary.phases).join(', ')}`);
})();
