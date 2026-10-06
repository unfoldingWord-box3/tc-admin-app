#!/usr/bin/env node
// Live QA probe for `project.create.plan` and `project.create.apply` (#30, ADR 0012).
// It runs the Worker's own operation code, bundled with esbuild, against QA Door43 with
// TEST_TOKEN standing in for the session's token, so what it records is what the Worker
// would write. It closes the health-acceptance part of Q4 for scripture/textTranslation
// and records the creation and first-commit request and response shapes (Q3, E27).
//
// Usage:  node --env-file=.env scripts/probe/qa-create-probe.mjs [--owner <login>] [--type bible|obs] [--abbreviation <abbr>]
//                [--language <code> --language-title <name>] [--scope nt|ot|full]
//                [--project-type <projectType> --translation-type <translationType> --audience <audience>] [--out <folder>] [--plan]
//         The three flavor flags are a Bible's translation details (Q4, #28), spelled as the Scripture Burrito schema spells
//         their values; without them the plan writes the defaults. `--out` names the recording folder under project-create/
//         (default: the owner, with `-obs` for Open Bible Stories), so a second run in a day does not overwrite the first.
// Env:    DOOR43_ORIGIN (default https://qa.door43.org; production is refused), TEST_TOKEN (required),
//         TEST_USER (the default owner: the token's own namespace, which needs a token with write:user,
//         E26, E49; or pass --owner tc-admin-qa-org, E23).
// Output: fixtures/door43/<host>/<date>/project-create/<owner>[-obs]/NN-<METHOD>-<path>.json (Authorization and
//         the account's email redacted; the first-commit request body replaced by a note, its files being
//         plan.json and metadata.json), plan.json, metadata.json (the generated file, the Q4 fixture),
//         receipt.json, and summary.json. Nothing secret is written.
// Effect: creates one public repository <language>_<abbreviation> under the owner with one commit,
//         exactly as the Worker would, a Bible (New Testament scope by default) or, with --type obs,
//         an Open Bible Stories project, and leaves it in place for inspection.
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
// Only QA may receive the token and the writes: production is never written outside the demo and pilot plans, and a mistyped origin gets nothing.
if (ORIGIN !== 'https://qa.door43.org') {
  console.error(`Refusing to run against ${ORIGIN}: this probe writes to https://qa.door43.org only.`);
  process.exit(2);
}
const TOKEN = process.env.TEST_TOKEN;
const HOST = new URL(ORIGIN).host;
const root = resolve(new URL('../..', import.meta.url).pathname);
const today = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString().slice(11, 16).replace(':', '');

const plan = [
  '00 bundle worker/src/operations/index.ts with esbuild; GET /version (public)',
  '01 project.create.plan: GET /user, GET /user/teams (for an organization owner), GET /repos/{owner}/{repo} (404 means the name is free)',
  '02 project.create.apply: GET /user, GET /user/teams, GET /repos/{owner}/{repo}; POST /orgs/{org}/repos or POST /user/repos; POST /repos/{owner}/{repo}/contents with metadata.json, ingredients/license.md, README.md (a Bible, or with --type obs an Open Bible Stories project)',
  '03 poll GET /repos/{owner}/{repo}/healthcheck?ref=master every 5 s for up to 3 min (public): the health result Door43 gives the generated metadata (Q4)',
  '04 GET /repos/{owner}/{repo} and GET /catalog/entry/{owner}/{repo}/master (public): the catalog view of the new project',
];
if (argv.includes('--plan')) {
  console.log(plan.join('\n'));
  process.exit(0);
}
if (!TOKEN) {
  console.error('TEST_TOKEN is required (docs/evidence.md E23). Use --plan to print the steps.');
  process.exit(2);
}

const type = flag('--type', 'bible');
const input = {
  owner: flag('--owner', process.env.TEST_USER || ''),
  project_type: type,
  title: `tC Admin probe ${type === 'obs' ? 'OBS ' : ''}${today} ${stamp}`,
  abbreviation: flag('--abbreviation', `${type === 'obs' ? 'obs' : 'tcap'}${stamp}`),
  language: { code: flag('--language', 'id'), title: flag('--language-title', 'Bahasa Indonesia'), direction: 'ltr' },
  testament_scope: type === 'obs' ? null : flag('--scope', 'nt'),
  license: 'cc-by-sa-4.0',
};
const flavor = { projectType: flag('--project-type'), translationType: flag('--translation-type'), audience: flag('--audience') };
if (Object.values(flavor).some(Boolean)) input.flavor = Object.fromEntries(Object.entries(flavor).filter(([, value]) => value));

// 00: the Worker's operations, as a module Node can import.
const bundle = join(tmpdir(), 'tc-admin-probe', 'operations.mjs');
mkdirSync(join(tmpdir(), 'tc-admin-probe'), { recursive: true });
execFileSync(join(root, 'node_modules/.bin/esbuild'), [
  join(root, 'worker/src/operations/index.ts'),
  '--bundle', '--format=esm', '--platform=neutral', '--target=es2022', '--log-level=warning', `--outfile=${bundle}`,
]);
const { HANDLERS, operationContext } = await import(pathToFileURL(bundle).href);

// Recording.
let outDir;
let step = 0;
const summary = { host: HOST, date: new Date().toISOString(), input: { ...input }, steps: [] };
const redactHeaders = headers => {
  const safe = Object.fromEntries(new Headers(headers));
  if (safe.authorization) safe.authorization = 'token [redacted]';
  return safe;
};
function record(name, request, response, extra = {}) {
  step += 1;
  const file = join(outDir, `${String(step).padStart(2, '0')}-${name}.json`);
  writeFileSync(file, JSON.stringify({ request, response, ...extra }, null, 2));
  summary.steps.push({ step, name, status: response.status, ms: response.ms, ...extra });
  const detail = typeof response.status === 'number' && response.status >= 400 && response.json ? `  ← ${response.json.message || response.json.error || JSON.stringify(response.json).slice(0, 300)}` : '';
  console.log(`${String(step).padStart(2, '0')} ${name}: ${response.status} (${response.ms} ms)${detail}`);
}
const stepName = (method, url) => `${method}-${new URL(url).pathname.replace(/^\/api\/v1\//, '').replace(/[^A-Za-z0-9._-]+/g, '_')}`;

/** The Worker's fetch, recorded: every Door43 request the operations make, with the token redacted. */
const recording = async (url, init = {}) => {
  const started = Date.now();
  const response = await fetch(url, init);
  const ms = Date.now() - started;
  const text = await response.clone().text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { unparsed: text.slice(0, 2000) };
  }
  // The account's own contact address is not evidence (AGENTS.md: never a secret in a fixture).
  if (json && typeof json === 'object' && typeof json.email === 'string' && json.email) json.email = '[redacted]';
  const method = init.method || 'GET';
  let body = init.body === undefined ? undefined : String(init.body);
  if (body && body.length > 4000) body = `[${body.length} bytes omitted: the files are plan.json's preview and metadata.json]`;
  record(stepName(method, url), { method, url, headers: redactHeaders(init.headers), body }, { status: response.status, ms, json });
  return response;
};

const publicCall = async (path, raw = false) => {
  const url = path.startsWith('http') ? path : `${ORIGIN}/api/v1${path}`;
  const started = Date.now();
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual' });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { unparsed: text.slice(0, 2000) };
  }
  return { request: { method: 'GET', url }, response: { status: response.status, ms: Date.now() - started, json } };
};

async function pollHealth(owner, repo, ref) {
  const started = Date.now();
  const sequence = [];
  while (Date.now() - started < 3 * 60 * 1000) {
    const { request, response } = await publicCall(`/repos/${owner}/${repo}/healthcheck?ref=${encodeURIComponent(ref)}`);
    const level = response.json?.data?.overall_severity_level ?? null;
    const issues = response.json?.data?.issues ? Object.fromEntries(Object.entries(response.json.data.issues).filter(([, v]) => v.length).map(([k, v]) => [k, v.length])) : null;
    sequence.push({ t_ms: Date.now() - started, status: response.status, level, error: response.json?.error ?? null, issues });
    if (response.status === 200 && level) {
      record(`health-${ref}`, request, { ...response, ms: Date.now() - started }, { sequence, latency_ms: Date.now() - started });
      return { level, issues, latency_ms: Date.now() - started };
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  record(`health-${ref}`, { method: 'GET', url: `healthcheck?ref=${ref}` }, { status: 'timeout', ms: 3 * 60 * 1000, json: null }, { sequence });
  return null;
}

const memoryKV = () => {
  const entries = new Map();
  return { get: async key => entries.get(key) ?? null, put: async (key, value) => void entries.set(key, value), delete: async key => void entries.delete(key), entries };
};

(async () => {
  const version = await publicCall('/version');
  summary.dcs_version = version.response.json?.version ?? null;
  const kv = memoryKV();
  const base = operationContext({ door43Origin: ORIGIN, door43ClientId: 'probe' }, `probe-${Date.now()}`, TOKEN, kv);
  const context = { ...base, door43: { ...base.door43, fetch: recording } };

  if (!input.owner) {
    const me = await (await fetch(`${ORIGIN}/api/v1/user`, { headers: { accept: 'application/json', authorization: `token ${TOKEN}` } })).json();
    input.owner = me.login;
    summary.input.owner = me.login;
  }
  outDir = resolve(root, 'fixtures/door43', HOST, today, 'project-create', flag('--out', type === 'obs' ? `${input.owner}-obs` : input.owner));
  mkdirSync(outDir, { recursive: true });
  console.log(`Owner ${input.owner}, repository ${input.language.code.toLowerCase()}_${input.abbreviation.toLowerCase()}, recordings in ${outDir}`);

  let planned;
  try {
    planned = await HANDLERS['project.create.plan'](input, context);
  } catch (error) {
    summary.plan_error = { code: error.code, message: error.message, details: error.details };
    throw error;
  }
  writeFileSync(join(outDir, 'plan.json'), JSON.stringify(planned, null, 2));
  const stored = JSON.parse(kv.entries.get(`plan:${planned.id}`));
  writeFileSync(join(outDir, 'metadata.json'), stored.payload.files.find(file => file.path === 'metadata.json').content);
  summary.plan = { id: planned.id, repo_name: planned.preview.repo_name, would_write: planned.would_write, files: planned.preview.files };
  console.log(`plan ${planned.id}: ${planned.would_write.map(write => `${write.kind} ${write.target}`).join(', ')}`);

  let receipt;
  try {
    receipt = await HANDLERS['project.create.apply']({ plan_id: planned.id }, context);
  } catch (error) {
    summary.apply_error = { code: error.code, message: error.message, details: error.details };
    throw error;
  }
  writeFileSync(join(outDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  summary.receipt = { wrote: receipt.wrote, warnings: receipt.warnings, setup: receipt.result.setup, started_at: receipt.started_at, finished_at: receipt.finished_at };
  summary.repository = `${input.owner}/${planned.preview.repo_name}`;
  console.log(`receipt: wrote ${receipt.wrote.map(write => `${write.kind} ${write.target}`).join(', ')}; setup ${receipt.result.setup.state}; warnings ${receipt.warnings.map(w => w.code).join(', ') || 'none'}`);

  if (receipt.result.setup.state === 'complete') {
    summary.health_master = await pollHealth(input.owner, planned.preview.repo_name, 'master');
    const repository = await publicCall(`/repos/${input.owner}/${planned.preview.repo_name}`);
    record('GET-repos_catalog-view', repository.request, repository.response);
    summary.catalog_view = repository.response.json && {
      metadata_type: repository.response.json.metadata_type,
      flavor_type: repository.response.json.flavor_type,
      flavor: repository.response.json.flavor,
      subject: repository.response.json.subject,
      language: repository.response.json.language,
      title: repository.response.json.title,
      abbreviation: repository.response.json.abbreviation,
      ingredients: (repository.response.json.ingredients || []).map(i => i.identifier),
      healthcheck_severity: repository.response.json.healthcheck_severity,
      catalog: repository.response.json.catalog,
    };
    const entry = await publicCall(`/catalog/entry/${input.owner}/${planned.preview.repo_name}/master`);
    record('GET-catalog_entry_master', entry.request, entry.response);
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nDone. Repository ${summary.repository}. Recordings in ${outDir}. Now record the facts in docs/evidence.md (Q4, Q28) and add the fixtures README.`);
})().catch(error => {
  console.error(`probe failed: ${error.code ? `${error.code}: ` : ''}${error.message}`);
  if (error.details) console.error('details:', JSON.stringify(error.details));
  if (!error.code) console.error(error.stack);
  if (outDir) writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ ...summary, failed: `${error.code ?? ''} ${error.message}`.trim() }, null, 2));
  process.exit(1);
});
