#!/usr/bin/env node
// Rebuild the standard QA test projects after a QA reset (#3, rescoped by Rich on 9 October 2026).
//
// Each Monday QA becomes a copy of production (E23). The Bahtraku repositories come with it, but
// everything created on QA in `tc-admin-qa` and `tc-admin-qa-org` does not: both are empty on
// production. This script rebuilds a standard set of projects there through the Worker's own
// operation code, bundled with esbuild as the probes are, so what it writes is what tC Admin writes:
//
//   tc-admin-qa-org/id_seedtb   a Bible, New Testament: Matthew and Mark imported from bahtraku/id_tb1 at
//                               its release 1974, released in full (v1.0.0); then John imported and released
//                               as a pre-release (v1.1.0), left for promotion
//   tc-admin-qa-org/en_seedobs  Open Bible Stories: every story imported from unfoldingWord/en_obs at its
//                               last release, released in full (v1.0.0)
//   tc-admin-qa/id_seedhf       a Bible in the user's own namespace (E26, E49): Matthew imported, never
//                               released, so Door43's health check reports findings on its default branch
//
// Each is created on the default branch main, as tC Admin creates every project (#167, E79), and the script
// stops one Door43 answers otherwise. After that the branch is the one Door43 answered (#170): its imports are
// committed to it, and each release is bound to its head and takes its books from there (a later release
// starts from the previous release tag, ADR 0010).
//
// Safe to run twice: a project whose repository already exists is reported and left alone, never written
// again (W5). A project that stopped half way is left as it is; delete its repository on QA to rebuild it.
// A project built before #167 is on master and stays so until it is deleted and rebuilt.
//
// Usage:  node --env-file=.env scripts/seed-qa.mjs [--plan] [--only <repo>]
// Env:    DOOR43_ORIGIN (default https://qa.door43.org; any other host is refused), TEST_TOKEN (required,
//         issued by QA, with write:organization and write:user, E49).
// Output: the steps on the console, and fixtures/door43/<host>/<date>/seed/summary-<HHMMSS>.json (no token, no email).
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
// Only QA is ever written: production is never seeded, and a mistyped host gets nothing.
if (ORIGIN !== 'https://qa.door43.org') {
  console.error(`Refusing to run against ${ORIGIN}: the seed writes to https://qa.door43.org only.`);
  process.exit(2);
}
const TOKEN = process.env.TEST_TOKEN;
const HOST = new URL(ORIGIN).host;
const root = resolve(new URL('..', import.meta.url).pathname);
const today = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString().slice(11, 19).replaceAll(':', '');

/** The default branch every standard project is built on, as tC Admin creates it (#167, E79). */
const BRANCH = 'main';
const ID = { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' };
const EN = { code: 'en', title: 'English', direction: 'ltr' };
const PROJECTS = [
  {
    owner: 'tc-admin-qa-org',
    create: { project_type: 'bible', title: 'tC Admin seed Bible', abbreviation: 'seedtb', language: ID, testament_scope: 'nt', license: 'cc-by-sa-4.0' },
    steps: [
      { import: { source: { owner: 'bahtraku', repo: 'id_tb1', revision: '1974' }, units: ['mat', 'mrk'] } },
      { release: { prerelease: false } },
      { import: { source: { owner: 'bahtraku', repo: 'id_tb1', revision: '1974' }, units: ['jhn'] } },
      { release: { prerelease: true, include: ['jhn'] } },
    ],
  },
  {
    owner: 'tc-admin-qa-org',
    create: { project_type: 'obs', title: 'tC Admin seed Open Bible Stories', abbreviation: 'seedobs', language: EN, testament_scope: null, license: 'cc-by-sa-4.0' },
    steps: [{ import: { source: { owner: 'unfoldingWord', repo: 'en_obs', revision: 'last-release' }, units: 'all' } }, { release: { prerelease: false } }],
  },
  {
    owner: 'tc-admin-qa',
    create: { project_type: 'bible', title: 'tC Admin seed Bible with findings', abbreviation: 'seedhf', language: ID, testament_scope: 'nt', license: 'cc-by-sa-4.0' },
    steps: [{ import: { source: { owner: 'bahtraku', repo: 'id_tb1', revision: '1974' }, units: ['mat'] } }],
  },
];
const repoOf = project => `${project.create.language.code}_${project.create.abbreviation}`;
// `--only` names one project, as `<repo>` or `<owner>/<repo>`; a name that matches none is refused, not a run that does nothing.
if (argv.includes('--only')) {
  const named = flag('--only');
  if (!PROJECTS.some(project => named === repoOf(project) || named === `${project.owner}/${repoOf(project)}`)) {
    console.error(`--only ${named ?? ''} matches no project; one of: ${PROJECTS.map(project => `${project.owner}/${repoOf(project)}`).join(', ')}`);
    process.exit(2);
  }
}

if (argv.includes('--plan')) {
  for (const project of PROJECTS) {
    console.log(`${project.owner}/${repoOf(project)}: project.create.plan and .apply on ${BRANCH}, then`);
    for (const step of project.steps) {
      if (step.import) console.log(`  import.plan and .apply to ${BRANCH} from ${step.import.source.owner}/${step.import.source.repo} at ${step.import.source.revision}: ${step.import.units === 'all' ? 'all' : step.import.units.join(', ')}`);
      if (step.release) console.log(`  release.plan bound to ${BRANCH}'s head, .prepare${step.release.include ? ` (including ${step.release.include.join(', ')})` : ''}, preparation.read until health, release.create (${step.release.prerelease ? 'pre-release' : 'full release'})`);
    }
  }
  process.exit(0);
}
if (!TOKEN) {
  console.error('TEST_TOKEN is required (docs/evidence.md E23). Use --plan to print the steps.');
  process.exit(2);
}

// The Worker's operations, as a module Node can import.
const bundle = join(tmpdir(), 'tc-admin-probe', 'operations-seed.mjs');
mkdirSync(join(tmpdir(), 'tc-admin-probe'), { recursive: true });
execFileSync(join(root, 'node_modules/.bin/esbuild'), [join(root, 'worker/src/operations/index.ts'), '--bundle', '--format=esm', '--platform=neutral', '--target=es2022', '--log-level=warning', `--outfile=${bundle}`]);
const { HANDLERS, operationContext } = await import(pathToFileURL(bundle).href);

const sleep = ms => new Promise(done => setTimeout(done, ms));
const memoryKV = () => {
  const entries = new Map();
  return {
    get: async key => entries.get(key) ?? null,
    put: async (key, value) => void entries.set(key, value),
    delete: async key => void entries.delete(key),
    list: async ({ prefix }) => ({ keys: [...entries.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
  };
};
const tokenCall = async path => {
  const response = await fetch(`${ORIGIN}/api/v1${path}`, { headers: { accept: 'application/json', authorization: `token ${TOKEN}` } });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json };
};

/** Wait until Door43's catalog carries the commit on `latest`, or the tag on `prod`, up to 3 minutes (E28). */
async function waitForCatalog(owner, repo, { latest, prod } = {}) {
  const started = Date.now();
  while (Date.now() - started < 3 * 60 * 1000) {
    const { json } = await tokenCall(`/repos/${owner}/${repo}`);
    const catalog = json?.catalog || {};
    if ((!latest || catalog.latest?.commit_sha === latest) && (!prod || catalog.prod?.branch_or_tag_name === prod)) return;
    await sleep(5000);
  }
  throw new Error(`Door43's catalog did not index ${owner}/${repo} ${latest ?? ''} ${prod ?? ''} within 3 minutes`);
}

/** The head commit of a branch as Door43 has it now. */
async function branchHead(owner, repo, branch) {
  const { status, json } = await tokenCall(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  if (status !== 200 || typeof json?.commit?.id !== 'string') throw new Error(`${owner}/${repo} has no branch ${branch} Door43 can read (${status})`);
  return json.commit.id;
}

/** The commit a receipt says it wrote; a receipt that names none stops the project, never a wait that is skipped (bench round 1 on #160). */
function committed(sha, what) {
  if (!sha) throw new Error(`${what} named no commit, so the catalog cannot be waited on`);
  return sha;
}

/** preparation.read every 5 s until the health check is in, up to 3 minutes (HEALTH_POLL). */
async function readUntilHealth(context, ref, id) {
  const started = Date.now();
  let read;
  while (Date.now() - started < 3 * 60 * 1000) {
    read = await HANDLERS['preparation.read']({ ...ref, preparation_id: id }, context);
    if (read.state !== 'health_checking') return read;
    await sleep(5000);
  }
  return read;
}

/** The revision a source offers at its last release, as `source.search` names it. */
async function lastRelease(context, owner, repo) {
  const found = await HANDLERS['source.search']({ owner, stage: 'prod' }, context);
  const source = found.sources.find(candidate => candidate.ref.repo === repo);
  if (!source || !('tag' in source.revision)) throw new Error(`${owner}/${repo} has no release Door43's catalog lists`);
  return source.revision.tag;
}

const base = operationContext({ door43Origin: ORIGIN, door43ClientId: 'seed' }, `seed-${Date.now()}`, TOKEN, memoryKV());
const context = { ...base };
const summary = { host: HOST, date: new Date().toISOString(), projects: [] };
const only = flag('--only');
let failed = false;

for (const project of PROJECTS) {
  const repo = repoOf(project);
  if (only && only !== repo && only !== `${project.owner}/${repo}`) continue;
  const ref = { owner: project.owner, repo };
  const row = { project: `${ref.owner}/${repo}`, outcome: null, steps: [] };
  summary.projects.push(row);
  const existing = await tokenCall(`/repos/${ref.owner}/${repo}`);
  if (existing.status === 200) {
    row.outcome = 'exists, left alone';
    console.log(`${row.project}: already exists, left alone (delete it on QA to rebuild it)`);
    continue;
  }
  try {
    const plan = await HANDLERS['project.create.plan']({ owner: ref.owner, ...project.create }, context);
    const created = await HANDLERS['project.create.apply']({ plan_id: plan.id }, context);
    const branch = created.result.default_branch;
    row.default_branch = branch;
    row.steps.push({ step: 'create', setup: created.result.setup.state, commit: created.wrote.find(write => write.kind === 'commit')?.sha ?? null });
    console.log(`${row.project}: created on ${branch} (setup ${created.result.setup.state})`);
    if (branch !== BRANCH) throw new Error(`Door43 created ${row.project} on ${branch}, not ${BRANCH}`);
    await waitForCatalog(ref.owner, repo, { latest: committed(created.result.default_branch_head?.sha, 'the creation') });
    for (const step of project.steps) {
      if (step.import) {
        const source = step.import.source;
        const revision = source.revision === 'last-release' ? await lastRelease(context, source.owner, source.repo) : source.revision;
        const planned = await HANDLERS['import.plan']({ ...ref, source: { owner: source.owner, repo: source.repo, revision }, units: step.import.units }, context);
        const applied = await HANDLERS['import.apply']({ ...ref, plan_id: planned.id }, context);
        const commit = applied.wrote.find(write => write.kind === 'commit');
        const sha = commit?.sha ?? null;
        row.steps.push({ step: 'import', source: `${source.owner}/${source.repo}@${revision}`, files: planned.preview.files.length, target: commit?.target ?? null, commit: sha });
        console.log(`  imported ${planned.preview.files.length} file(s) from ${source.owner}/${source.repo}@${revision} to ${commit?.target ?? 'no commit'}`);
        if (commit?.target !== `${ref.owner}/${repo}@${branch}`) throw new Error(`the import committed to ${commit?.target ?? 'nothing'}, not ${branch}`);
        await waitForCatalog(ref.owner, repo, { latest: committed(sha, 'the import') });
      }
      if (step.release) {
        const planned = await HANDLERS['release.plan'](ref, context);
        // The release takes its books from main: the plan is bound to main's head as Door43 has it now (R5).
        const head = await branchHead(ref.owner, repo, branch);
        if (planned.bound_to.default_branch_sha !== head) throw new Error(`the release plan is bound to ${planned.bound_to.default_branch_sha}, not ${branch}'s head ${head}`);
        // An Open Bible Stories release takes the whole default branch, so it sends no selection (release.prepare refuses one).
        const selection = project.create.project_type === 'obs' ? {} : Object.fromEntries(planned.preview.books.map(book => [book.id, step.release.include?.includes(book.id) ? 'include' : book.selection]));
        const prepared = await HANDLERS['release.prepare']({ ...ref, plan_id: planned.id, selection, unknown_included: [], version: null }, context);
        const read = await readUntilHealth(context, ref, prepared.result.id);
        if (read.state !== 'ready_for_release') throw new Error(`the preparation of ${read.version.proposed} is ${read.state}, health ${read.health.state}; nothing was released`);
        const released = await HANDLERS['release.create']({ ...ref, preparation_id: read.id, version: read.version.confirmed ?? read.version.proposed, notes: read.notes.draft, prerelease: step.release.prerelease, acknowledge_warnings: read.requires_acknowledgement }, context);
        const tag = released.result.release.tag;
        row.steps.push({ step: step.release.prerelease ? 'pre-release' : 'full release', tag, from: `${branch}@${head}`, baseline: planned.bound_to.release_tag, health: read.health.state, acknowledged_warnings: released.acknowledged_warnings });
        console.log(`  released ${tag} as ${step.release.prerelease ? 'a pre-release' : 'a full release'} from ${branch} at ${head.slice(0, 10)}${planned.bound_to.release_tag ? ` on ${planned.bound_to.release_tag}` : ''} (health ${read.health.state})`);
        if (!step.release.prerelease) await waitForCatalog(ref.owner, repo, { prod: tag });
      }
    }
    const health = await tokenCall(`/repos/${ref.owner}/${repo}/healthcheck?ref=${encodeURIComponent(branch)}`);
    row.health_on_default_branch = health.json?.data?.overall_severity_level ?? null;
    row.outcome = 'built';
    console.log(`  done; Door43's health on ${branch}: ${row.health_on_default_branch ?? 'not yet checked'}`);
  } catch (error) {
    failed = true;
    row.outcome = 'stopped';
    // The code and the message only: a committed fixture never carries an error's details, which may echo a request (bench round 1 on #160).
    row.error = { code: error.code ?? null, message: error.message };
    console.error(`  stopped: ${error.code ?? ''} ${error.message}`);
  }
}

const outDir = resolve(root, 'fixtures/door43', HOST, today, 'seed');
mkdirSync(outDir, { recursive: true });
// One file per run, by its time, so a second run the same day keeps the first one's record.
writeFileSync(join(outDir, `summary-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
console.log(`Summary: ${join(outDir, `summary-${stamp}.json`)}`);
process.exit(failed ? 1 : 0);
