#!/usr/bin/env node
// Live QA probe for `import.plan` and `import.apply` (#79, #80, ADR 0012): the import
// rehearsal the roadmap names, through the Worker's own operation code, bundled with
// esbuild, against QA Door43 with TEST_TOKEN standing in for the session's token.
// It creates a new Bible project (as the wizard does, `project.create.plan` and
// `project.create.apply`) unless `--project` names one, plans an import of the chosen
// books from the source at its revision, applies it, and re-reads what Door43 holds:
// the commit, the metadata.json with its relationship, and the health result.
//
// Usage:  node --env-file=.env scripts/probe/qa-import-probe.mjs [--owner <login>] [--project <owner>/<repo>]
//                [--source bahtraku/id_tb1] [--revision 1974] [--units GEN,EXO | all] [--out <folder>] [--plan]
// Env:    DOOR43_ORIGIN (default https://qa.door43.org; production is refused), TEST_TOKEN (required),
//         TEST_USER (the default owner of a new project: the token's own namespace, E26, E49).
// Output: fixtures/door43/<host>/<date>/import/<folder>/NN-<METHOD>-<path>.json (Authorization and the
//         account's email redacted; archive bodies and the commit's request body replaced by notes),
//         plan.json, receipt.json, metadata-after.json (the committed file, re-read), and summary.json.
// Effect: one public repository created under the owner (unless --project), then one commit on its
//         default branch with the imported books and metadata.json. Nothing is written to the source.
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

const [sourceOwner, sourceRepo] = flag('--source', 'bahtraku/id_tb1').split('/');
const revision = flag('--revision', '1974');
const unitsFlag = flag('--units', 'GEN,EXO');
const units = unitsFlag === 'all' ? 'all' : unitsFlag.split(',').map(unit => unit.trim()).filter(Boolean);

const plan = [
  '00 bundle worker/src/operations/index.ts with esbuild; GET /version (public)',
  '01 unless --project: project.create.plan and project.create.apply, a New Testament Bible under the owner (as qa-create-probe)',
  '02 import.plan: GET /user, GET /repos/{project}, GET /repos/{source}, GET /repos/{source}/releases/tags/{revision} (or /branches/{branch}), GET /repos/{project}/branches/{branch}, GET git/trees, GET /sb/{sha}.zip (project), GET /sb/{revision}.zip (source)',
  '03 import.apply: GET /user, GET /sb/{ref}.zip (source), GET /repos/{project}, GET branches, GET git/trees, GET releases by tag when any; POST /repos/{project}/contents once',
  '04 re-read (public): the commit, metadata.json at the new head, the catalog entry; poll the health check for up to 3 min',
];
if (argv.includes('--plan')) {
  console.log(plan.join('\n'));
  process.exit(0);
}
if (!TOKEN) {
  console.error('TEST_TOKEN is required (docs/evidence.md E23). Use --plan to print the steps.');
  process.exit(2);
}

const bundle = join(tmpdir(), 'tc-admin-probe', 'operations.mjs');
mkdirSync(join(tmpdir(), 'tc-admin-probe'), { recursive: true });
execFileSync(join(root, 'node_modules/.bin/esbuild'), [
  join(root, 'worker/src/operations/index.ts'),
  '--bundle', '--format=esm', '--platform=neutral', '--target=es2022', '--log-level=warning', `--outfile=${bundle}`,
]);
const { HANDLERS, operationContext } = await import(pathToFileURL(bundle).href);

let outDir;
let step = 0;
const summary = { host: HOST, date: new Date().toISOString(), source: { owner: sourceOwner, repo: sourceRepo, revision }, units, steps: [] };
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

/** The Worker's fetch, recorded: every Door43 request the operations make, with the token redacted and archive bodies summarized. */
const recording = async (url, init = {}) => {
  const started = Date.now();
  const response = await fetch(url, init);
  const ms = Date.now() - started;
  const isZip = new URL(url).pathname.endsWith('.zip');
  let json = null;
  if (isZip) {
    json = { note: `[zip body: ${response.headers.get('content-length') ?? 'unknown'} bytes declared]` };
  } else {
    const text = await response.clone().text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { unparsed: text.slice(0, 2000) };
    }
    if (json && typeof json === 'object' && typeof json.email === 'string' && json.email) json.email = '[redacted]';
  }
  const method = init.method || 'GET';
  let body = init.body === undefined ? undefined : String(init.body);
  if (body && body.length > 4000) body = `[${body.length} bytes omitted: the imported files and metadata.json, as plan.json previews them]`;
  record(stepName(method, url), { method, url, headers: redactHeaders(init.headers), body }, { status: response.status, ms, json });
  return response;
};

const publicCall = async (path) => {
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
  if (json && typeof json === 'object') {
    for (const key of ['author', 'committer']) if (json[key] && typeof json[key].email === 'string') json[key].email = '[redacted]';
    if (json.commit) for (const key of ['author', 'committer']) if (json.commit[key] && typeof json.commit[key].email === 'string') json.commit[key].email = '[redacted]';
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
  return {
    get: async key => entries.get(key) ?? null,
    put: async (key, value) => void entries.set(key, value),
    delete: async key => void entries.delete(key),
    list: async ({ prefix }) => ({ keys: [...entries.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
    entries,
  };
};

(async () => {
  const version = await publicCall('/version');
  summary.dcs_version = version.response.json?.version ?? null;
  const kv = memoryKV();
  const base = operationContext({ door43Origin: ORIGIN, door43ClientId: 'probe' }, `probe-${Date.now()}`, TOKEN, kv);
  const context = { ...base, door43: { ...base.door43, fetch: recording } };

  let owner = flag('--owner', process.env.TEST_USER || '');
  if (!owner) {
    const me = await (await fetch(`${ORIGIN}/api/v1/user`, { headers: { accept: 'application/json', authorization: `token ${TOKEN}` } })).json();
    owner = me.login;
  }
  let project = flag('--project');
  outDir = resolve(root, 'fixtures/door43', HOST, today, 'import', flag('--out', `${sourceRepo}-${stamp}`));
  mkdirSync(outDir, { recursive: true });
  console.log(`Source ${sourceOwner}/${sourceRepo}@${revision}, units ${Array.isArray(units) ? units.join(', ') : 'all'}, recordings in ${outDir}`);

  if (!project) {
    const creation = {
      owner,
      project_type: 'bible',
      title: `tC Admin import probe ${today} ${stamp}`,
      abbreviation: `tcai${stamp}`,
      language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' },
      testament_scope: 'nt',
      license: 'cc-by-sa-4.0',
    };
    const planned = await HANDLERS['project.create.plan'](creation, context);
    const created = await HANDLERS['project.create.apply']({ plan_id: planned.id }, context);
    if (created.result.setup.state !== 'complete') throw new Error(`project setup ${created.result.setup.state}: ${JSON.stringify(created.warnings)}`);
    project = `${owner}/${planned.preview.repo_name}`;
    summary.created = { project, commit: created.wrote.find(write => write.kind === 'commit')?.sha ?? null };
    console.log(`created ${project}`);
    // Door43's catalog reads the new repository a few seconds later (E28, E45): the import's repository read needs its flavor.
    await new Promise(r => setTimeout(r, 8000));
  }
  const [projectOwner, projectRepo] = project.split('/');
  summary.project = project;

  let planned;
  try {
    planned = await HANDLERS['import.plan']({ owner: projectOwner, repo: projectRepo, source: { owner: sourceOwner, repo: sourceRepo, revision }, units }, context);
  } catch (error) {
    summary.plan_error = { code: error.code, message: error.message, details: error.details };
    throw error;
  }
  writeFileSync(join(outDir, 'plan.json'), JSON.stringify(planned, null, 2));
  summary.plan = { id: planned.id, bound_to: planned.bound_to, source: planned.preview.source, files: planned.preview.files.map(({ diff, ...file }) => ({ ...file, diff_lines: diff === null ? null : diff.split('\n').length })), relationships: planned.preview.metadata_diff.relationships, warnings: planned.warnings };
  console.log(`plan ${planned.id}: ${planned.preview.files.map(file => `${file.path} (${file.size} bytes${file.overwrite ? ', overwrite' : ''})`).join(', ')}; relationship ${JSON.stringify(planned.preview.metadata_diff.relationships)}`);

  let receipt;
  try {
    receipt = await HANDLERS['import.apply']({ owner: projectOwner, repo: projectRepo, plan_id: planned.id }, context);
  } catch (error) {
    summary.apply_error = { code: error.code, message: error.message, details: error.details };
    throw error;
  }
  writeFileSync(join(outDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  summary.receipt = { wrote: receipt.wrote, warnings: receipt.warnings, coverage: receipt.result.coverage, started_at: receipt.started_at, finished_at: receipt.finished_at };
  console.log(`receipt: wrote ${receipt.wrote.map(write => `${write.kind} ${write.target} ${write.sha}`).join(', ')}; coverage ${receipt.result.coverage.present} of ${receipt.result.coverage.target}`);

  // The same plan id again: the stored receipt, nothing written (§1 rule 6).
  const again = await HANDLERS['import.apply']({ owner: projectOwner, repo: projectRepo, plan_id: planned.id }, context);
  summary.repeated_apply_same_receipt = JSON.stringify(again) === JSON.stringify(receipt);

  const sha = receipt.wrote.find(write => write.kind === 'commit')?.sha;
  if (sha) {
    const commit = await publicCall(`/repos/${projectOwner}/${projectRepo}/git/commits/${sha}`);
    record('GET-commit', commit.request, commit.response);
    summary.commit = commit.response.json && { sha: commit.response.json.sha, parents: (commit.response.json.parents || []).map(p => p.sha), files: (commit.response.json.files || []).map(f => `${f.status} ${f.filename}`), author: commit.response.json.author?.login, committer: commit.response.json.committer?.login };
    const metadata = await publicCall(`/repos/${projectOwner}/${projectRepo}/raw/metadata.json?ref=${sha}`);
    record('GET-raw-metadata', metadata.request, metadata.response);
    writeFileSync(join(outDir, 'metadata-after.json'), JSON.stringify(metadata.response.json, null, 2));
    summary.metadata_after = metadata.response.json && { relationships: metadata.response.json.relationships, idAuthorities: Object.keys(metadata.response.json.idAuthorities || {}), ingredients: Object.keys(metadata.response.json.ingredients || {}) };
    const branches = await publicCall(`/repos/${projectOwner}/${projectRepo}/branches`);
    record('GET-branches', branches.request, branches.response);
    summary.branches = (branches.response.json || []).map(b => b.name);
    summary.health_master = await pollHealth(projectOwner, projectRepo, 'master');
    const entry = await publicCall(`/catalog/entry/${projectOwner}/${projectRepo}/master`);
    record('GET-catalog_entry_master', entry.request, entry.response);
    summary.catalog_entry = entry.response.json && { is_valid: entry.response.json.is_valid, healthcheck_severity: entry.response.json.healthcheck_severity, ingredients: (entry.response.json.ingredients || []).map(i => i.identifier), books: entry.response.json.books };
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nDone. Project ${project}. Recordings in ${outDir}. Now record the facts in docs/evidence.md and add the fixtures README.`);
})().catch(error => {
  console.error(`probe failed: ${error.code ? `${error.code}: ` : ''}${error.message}`);
  if (error.details) console.error('details:', JSON.stringify(error.details));
  if (!error.code) console.error(error.stack);
  if (outDir) writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ ...summary, failed: `${error.code ?? ''} ${error.message}`.trim() }, null, 2));
  process.exit(1);
});
