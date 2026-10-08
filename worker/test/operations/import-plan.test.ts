// `import.plan` (#79) against the recorded Pendau project (repository, tree,
// branch, archive: E19, E34, E52, E63) and the recorded sources: `bahtraku/id_tb1`,
// a Resource Container Bible, at its release `1974` and its default branch (E1,
// E17, E18), and `unfoldingWord/en_obs` v9, a Resource Container Open Bible
// Stories repository, into an Open Bible Stories project as the wizard creates
// it (E36, E47). The order of its checks (A2 and W2 before anything else is
// read; a source that is missing, of another type, or at no release or default
// branch), the files taken byte for byte from the source's archive (E18), the
// overwrites and their diffs, the entries and the one source relationship (R10,
// E24), the binding (R5), the one commit announced to the project and nothing to
// the source (W5, W2), and what is stored: what was computed, never the bytes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { ParsedInput } from '@tc-admin/shared/schema';
import { beforeAll, describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { BIBLE_BOOKS } from '../../src/model/books';
import { DCS_AUTHORITY, newProjectFiles } from '../../src/model/burrito';
import { gitBlobSha } from '../../src/model/git-blob';
import { md5 } from '../../src/model/md5';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import { importPlan } from '../../src/operations/import-plan';
import type { ImportPlanPayload } from '../../src/operations/import-plan';
import type { StoredPlan } from '../../src/operations/plans';
import { recorded } from '../support/recorded';
import { storedZip } from '../support/zip';

const fixture = (path: string) => new URL(`../../../fixtures/door43/qa.door43.org/${path}`, import.meta.url);
const reference = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const encode = (text: string) => new TextEncoder().encode(text);

const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
/** Pendau's default-branch commit as recorded (E52), at which its tree was read. */
const PENDAU_SHA = '2d9dbd1ee09b5a1c28edd8668462f6a64029619b';
const TB1 = { owner: 'bahtraku', repo: 'id_tb1' };
/** id_tb1's one commit, the default branch's head and the release `1974`'s (E1, E17). */
const TB1_SHA = '6ac2aeb0dbaf97f1d71278c8ac4e5d5dc170dd6f';
const EN_OBS = { owner: 'unfoldingWord', repo: 'en_obs' };
const OBS_PROJECT = { owner: 'tc-admin-qa-org', repo: 'ums_obs' };
const SYNTHETIC = { owner: 'tc-admin-qa', repo: 'src_bible' };
const SYNTHETIC_SHA = 'f'.repeat(40);

const user = recorded<unknown>('2026-10-05/user/user.json');
const pendauRepository = recorded<Record<string, unknown>>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const pendauTree = recorded<{ sha: string; tree: { path: string; sha: string; size: number }[] }>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau__git-trees__master.json.gz');
const tb1Repository = recorded<Record<string, unknown>>('2026-10-07/repos/bahtraku__id_tb1.json.gz');
const tb1Tree = JSON.parse(readFileSync(fixture('2026-09-21/repos/bahtraku__id_tb1__git-trees__master.json'), 'utf8')) as { tree: { path: string; sha: string; size: number }[] };
const tb1Releases = JSON.parse(readFileSync(fixture('2026-09-21/releases/bahtraku__id_tb1.json'), 'utf8')) as { tag_name: string }[];
/** The branch read's shape as recorded (E63); each stub names its own head commit. */
const branchShape = JSON.parse(readFileSync(fixture('2026-10-07/setup-retry/08-GET-branch.json'), 'utf8')) as { commit: object };
const branchAt = (name: string, sha: string) => ({ ...branchShape, name, commit: { ...branchShape.commit, id: sha } });
const pendauZip = new Uint8Array(readFileSync(fixture('2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip')));
const tb1Zip = new Uint8Array(readFileSync(fixture('2026-09-21/sb-archives/bahtraku__id_tb1__master.zip')));
const enObsZip = new Uint8Array(readFileSync(fixture('2026-10-01/sb-archives/unfoldingWord__en_obs__v9.zip')));
/** en_obs as the catalog search lists it (E35), with its release v9; the repository read answers the same fields. */
const enObsEntry = (JSON.parse(readFileSync(fixture('2026-10-01/catalog/search__owner=unfoldingWord__flavor=textTranslation,textStories.json'), 'utf8')) as { data: Record<string, unknown>[] }).data.find(entry => entry.name === 'en_obs')!;
const enObsRepository = { ...enObsEntry, default_branch: 'master', permissions: { pull: true, push: false, admin: false } };

/** An Open Bible Stories project as the wizard creates it (E47): its files, the tree listing their blobs, and its archive. */
const obsProject = newProjectFiles(
  { ...OBS_PROJECT, repo_name: OBS_PROJECT.repo, project_type: 'obs', testament_scope: null, title: 'Cerita', abbreviation: 'OBS', language: { code: 'ums', title: 'Pendau' }, license: 'cc-by-sa-4.0' },
  { name: 'tC Admin', version: '0.1.0', user: { login: 'tc-admin-qa', name: 'tc-admin-qa' } },
  new Date('2026-10-07T12:00:00.000Z'),
);
const OBS_SHA = 'a'.repeat(40);
const obsRepository = { full_name: `${OBS_PROJECT.owner}/${OBS_PROJECT.repo}`, name: OBS_PROJECT.repo, owner: { login: OBS_PROJECT.owner }, default_branch: 'master', flavor: 'textStories', metadata_type: 'sb', permissions: { push: true, admin: false, pull: true } };
let obsTree: { sha: string; tree: { path: string; sha: string; type: string }[] };
const obsZip = storedZip(obsProject.files.map(file => [`ums_obs/${file.path}`, file.content]));

class MemoryKV implements KVNamespace {
  readonly entries = new Map<string, string>();
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.entries.set(key, value);
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
  async list(options: { prefix: string }) {
    return { keys: [...this.entries.keys()].filter(name => name.startsWith(options.prefix)).map(name => ({ name })), list_complete: true };
  }
}

interface Door43Options {
  /** The project's repository answer; Pendau's recording unless given. */
  repo?: Record<string, unknown>;
  writable?: boolean;
  /** The status the source's archive answers instead of the bytes. */
  sourceArchiveStatus?: number;
  /** The source's archive bytes for id_tb1, its recording unless given. */
  sourceArchive?: Uint8Array;
  /** A synthetic source's archive, served for `tc-admin-qa/src_bible` at its head. */
  syntheticArchive?: Uint8Array;
}

/** A Door43 of recorded answers, every request recorded with its method. */
function door43(options: Door43Options = {}): { fetch: Fetch; calls: string[]; methods: string[] } {
  const calls: string[] = [];
  const methods: string[] = [];
  const api = '/api/v1';
  const fetch: Fetch = async (url, init) => {
    const { pathname, search } = new URL(url);
    calls.push(pathname + search);
    methods.push(init?.method ?? 'GET');
    const p = pathname.slice(api.length);
    const pendau = `/repos/${PENDAU.owner}/${PENDAU.repo}`;
    const tb1 = `/repos/${TB1.owner}/${TB1.repo}`;
    const obs = `/repos/${OBS_PROJECT.owner}/${OBS_PROJECT.repo}`;
    const enObs = `/repos/${EN_OBS.owner}/${EN_OBS.repo}`;
    const synthetic = `/repos/${SYNTHETIC.owner}/${SYNTHETIC.repo}`;
    if (p === '/user') return Response.json(user);
    // The project: Pendau, or the Open Bible Stories project.
    if (p === pendau) return Response.json({ ...(options.repo ?? pendauRepository), permissions: options.writable === false ? { pull: true } : { push: true, admin: false, pull: true } });
    if (p === `${pendau}/branches/master`) return Response.json(branchAt('master', PENDAU_SHA));
    if (p === `${pendau}/git/trees/${PENDAU_SHA}`) return Response.json(pendauTree);
    if (p === `${pendau}/sb/${PENDAU_SHA}.zip`) return new Response(pendauZip);
    if (p === obs) return Response.json({ ...obsRepository, permissions: options.writable === false ? { pull: true } : obsRepository.permissions });
    if (p === `${obs}/branches/master`) return Response.json(branchAt('master', OBS_SHA));
    if (p === `${obs}/git/trees/${OBS_SHA}`) return Response.json(obsTree);
    if (p === `${obs}/sb/${OBS_SHA}.zip`) return new Response(obsZip);
    // The sources: id_tb1 at its release or its default branch, en_obs at v9, and a synthetic Bible at its head.
    // Door43 resolves a repository name in any case (its answer spells the canonical one).
    if (p.toLowerCase() === tb1) return Response.json(tb1Repository);
    if (p === `${tb1}/releases/tags/1974`) return Response.json(tb1Releases.find(release => release.tag_name === '1974'));
    if (p === `${tb1}/branches/master`) return Response.json(branchAt('master', TB1_SHA));
    if (p === `${tb1}/sb/1974.zip` || p === `${tb1}/sb/${TB1_SHA}.zip`) {
      return options.sourceArchiveStatus ? new Response('', { status: options.sourceArchiveStatus }) : new Response(options.sourceArchive ?? tb1Zip);
    }
    if (p === enObs) return Response.json(enObsRepository);
    if (p === `${enObs}/releases/tags/v9`) return Response.json(enObsEntry.release);
    if (p === `${enObs}/sb/v9.zip`) return new Response(enObsZip);
    if (p === synthetic) return Response.json({ full_name: 'tc-admin-qa/src_bible', default_branch: 'main', flavor: 'textTranslation', metadata_type: 'rc', permissions: { pull: true } });
    if (p === `${synthetic}/branches/main`) return Response.json(branchAt('main', SYNTHETIC_SHA));
    if (p === `${synthetic}/sb/${SYNTHETIC_SHA}.zip` && options.syntheticArchive) return new Response(options.syntheticArchive);
    return new Response('', { status: 404 });
  };
  return { fetch, calls, methods };
}

const NOW = new Date('2026-10-08T12:00:00.000Z');
let kv: MemoryKV;
const context = (fetch: Fetch): OperationContext => {
  kv = new MemoryKV();
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', 'door43-token', kv);
  return { ...base, door43: { ...base.door43!, fetch }, now: () => NOW };
};
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const stored = (planId: string) => JSON.parse(kv.entries.get(`plan:${planId}`)!) as StoredPlan<ImportPlanPayload>;
type Units = ParsedInput<'import.plan'>['units'];
const fromTb1 = (units: Units, revision = '1974', project = PENDAU): ParsedInput<'import.plan'> => ({ ...project, source: { ...TB1, revision }, units });

let tb1Gen: Uint8Array;
let tb1Mat: Uint8Array;
let pendauJud: Uint8Array;
let enObs01: Uint8Array;
beforeAll(async () => {
  const tb1 = openArchive(tb1Zip);
  tb1Gen = await tb1.bytes('ingredients/GEN.usfm');
  tb1Mat = await tb1.bytes('ingredients/MAT.usfm');
  pendauJud = await openArchive(pendauZip).bytes('ingredients/JUD.usfm');
  enObs01 = await openArchive(enObsZip).bytes('ingredients/content/01.md');
  obsTree = { sha: 'b'.repeat(40), tree: await Promise.all(obsProject.files.map(async file => ({ path: file.path, type: 'blob', sha: await gitBlobSha(file.bytes) }))) };
});

describe('contract: an import from the recorded id_tb1 archive into the recorded Pendau project (S9)', () => {
  test('R5, W5: one commit to the project is announced, the plan is bound to the project\'s head, every read is a GET, and the plan is stored under its id with no bytes', async () => {
    const { fetch, calls, methods } = door43();
    const plan = OPERATIONS['import.plan'].output.parse(await importPlan(fromTb1(['GEN']), context(fetch)));

    expect(plan.operation).toBe('import.plan');
    expect(plan.bound_to).toEqual({ default_branch_sha: PENDAU_SHA, release_tag: null, release_tag_sha: null });
    expect(plan.would_write).toEqual([{ kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@master' }]);
    expect(plan.preview.source).toEqual({ ...TB1, revision: '1974', sha: TB1_SHA });
    expect(plan.expires_at).toBe('2026-10-08T12:30:00.000Z');
    // The account and the project; the source and its release; the project's head; then its tree and the two archives (E63, E34, E1).
    expect(calls.slice(0, 5)).toEqual(['/api/v1/user', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau', '/api/v1/repos/bahtraku/id_tb1', '/api/v1/repos/bahtraku/id_tb1/releases/tags/1974', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/branches/master']);
    expect(calls.slice(5).sort()).toEqual([`/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/git/trees/${PENDAU_SHA}?recursive=true&per_page=1000&page=1`, `/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/sb/${PENDAU_SHA}.zip`, '/api/v1/repos/bahtraku/id_tb1/sb/1974.zip']);
    // W2: the source is read, never written: no request is anything but a GET.
    expect(new Set(methods)).toEqual(new Set(['GET']));

    const kept = stored(plan.id);
    expect(kept.account).toBe('tc-admin-qa');
    expect(kept.plan).toEqual({ id: plan.id, operation: 'import.plan', created_at: plan.created_at, expires_at: plan.expires_at, bound_to: plan.bound_to, would_write: plan.would_write, warnings: [] });
    expect(kept.payload).toMatchObject({
      ...PENDAU,
      project_type: 'bible',
      bound_to: plan.bound_to,
      default_branch: { name: 'master', sha: PENDAU_SHA },
      source: { ...TB1, revision: '1974', sha: TB1_SHA, archive_ref: '1974', relationship_revision: '1974' },
      files: [{ source_path: 'ingredients/GEN.usfm', identified: { book: 'gen' }, path: 'ingredients/GEN.usfm', size: tb1Gen.length, md5: reference(tb1Gen), overwrite: false, replaces_sha: null }],
    });
    expect([kept.payload.metadata.path, kept.payload.metadata.size, kept.payload.metadata.md5]).toEqual(['metadata.json', encode(kept.payload.metadata.content).length, md5(encode(kept.payload.metadata.content))]);
    // What was computed from the bytes, never the bytes: Genesis opens with a line the stored plan does not hold.
    expect(kv.entries.get(`plan:${plan.id}`)).not.toContain('\\c 1');
  });

  test('E18: the file taken is the source archive\'s byte for byte, the blob Door43 lists for 01-GEN.usfm on master, with its size and md5 (R10)', async () => {
    const { fetch } = door43();
    const plan = await importPlan(fromTb1(['gen']), context(fetch));
    const [gen] = plan.preview.files;
    expect(gen).toEqual({ name: 'ingredients/GEN.usfm', identified: { book: 'gen' }, path: 'ingredients/GEN.usfm', size: 242027, md5: reference(tb1Gen), overwrite: false, diff: null });
    const onMaster = tb1Tree.tree.find(entry => entry.path === '01-GEN.usfm')!;
    expect([gen!.size, await gitBlobSha(tb1Gen)]).toEqual([onMaster.size, onMaster.sha]);
    expect(onMaster.sha).toBe('fcdd2dce4316b6fe2fe4d17aab3a5d5ce51227fe');
  });

  test('S2: a book the project holds is an overwrite with a text diff against the default branch (E19); the project\'s own bytes are an overwrite with the empty diff', async () => {
    const { fetch } = door43();
    const plan = await importPlan(fromTb1(['MAT', 'GEN']), context(fetch));
    const [mat, gen] = plan.preview.files;
    // id_tb1's Matthew is another translation: an overwrite whose diff is not practical (over the edit limit), so `null`, never a partial diff.
    expect(mat).toEqual({ name: 'ingredients/MAT.usfm', identified: { book: 'mat' }, path: 'ingredients/MAT.usfm', size: tb1Mat.length, md5: reference(tb1Mat), overwrite: true, diff: null });
    expect(gen!.overwrite).toBe(false);
    expect(stored(plan.id).payload.files[0]!.replaces_sha).toBe(pendauTree.tree.find(entry => entry.path === 'ingredients/MAT.usfm')!.sha);

    // A source whose Matthew is Pendau's with one verse revised: a text diff of that one line.
    const revised = new TextDecoder().decode(await openArchive(pendauZip).bytes('ingredients/MAT.usfm')).replace('\\v 1 ', '\\v 1 Revised ');
    const near = door43({ syntheticArchive: storedZip([['src_bible/ingredients/MAT.usfm', revised]]) });
    const small = await importPlan({ ...PENDAU, source: { ...SYNTHETIC, revision: 'main' }, units: ['MAT'] }, context(near.fetch));
    expect(small.preview.files[0]!.diff).toMatch(/^--- a\/ingredients\/MAT\.usfm\n\+\+\+ b\/ingredients\/MAT\.usfm\n@@ /);
    expect(small.preview.files[0]!.diff).toContain('\n+\\v 1 Revised ');

    // Pendau's own Jude, served as a source archive, is the blob the branch holds.
    const own = door43({ sourceArchive: storedZip([['id_tb1/ingredients/JUD.usfm', new TextDecoder().decode(pendauJud)]]) });
    const same = await importPlan(fromTb1(['JUD']), context(own.fetch));
    expect(same.preview.files[0]).toMatchObject({ path: 'ingredients/JUD.usfm', overwrite: true, diff: '', md5: reference(pendauJud) });
  });

  test('R10, E24: the metadata diff carries exactly the chosen entries and the one source relationship, and the proposed metadata.json lists them with the dcs authority', async () => {
    const { fetch } = door43();
    const plan = await importPlan(fromTb1(['MAT', 'GEN']), context(fetch));
    expect(plan.preview.metadata_diff).toEqual({
      ingredients: [
        { path: 'ingredients/MAT.usfm', before: { checksum: { md5: '5ee344412572e540a257f79d80f8a126' }, mimeType: 'text/x-usfm', size: 154502, scope: { MAT: [] } }, after: { checksum: { md5: reference(tb1Mat) }, mimeType: 'text/x-usfm', size: tb1Mat.length, scope: { MAT: [] } } },
        { path: 'ingredients/GEN.usfm', before: null, after: { checksum: { md5: reference(tb1Gen) }, mimeType: 'text/x-usfm', size: tb1Gen.length, scope: { GEN: [] } } },
      ],
      relationships: [{ id: 'dcs::bahtraku/id_tb1', relationType: 'source', flavor: 'textTranslation', revision: '1974' }],
    });
    const document = JSON.parse(stored(plan.id).payload.metadata.content) as { ingredients: Record<string, unknown>; relationships: unknown[]; idAuthorities: Record<string, unknown> };
    expect(document.ingredients['ingredients/GEN.usfm']).toEqual(plan.preview.metadata_diff.ingredients[1]!.after);
    expect(document.relationships).toEqual(plan.preview.metadata_diff.relationships);
    expect(document.idAuthorities.dcs).toEqual(DCS_AUTHORITY);
  });

  test('units: all takes every book the archive holds, 66 in canonical order, and nothing else from it', async () => {
    const { fetch } = door43();
    const plan = await importPlan(fromTb1('all'), context(fetch));
    expect(plan.preview.files).toHaveLength(66);
    expect(plan.preview.files.map(file => file.identified)).toEqual(BIBLE_BOOKS.map(book => ({ book })));
    expect(plan.preview.files.at(-1)).toMatchObject({ identified: { book: 'rev' }, path: 'ingredients/REV.usfm' });
    expect(plan.preview.files.every(file => file.path?.startsWith('ingredients/') && file.path.endsWith('.usfm'))).toBe(true);
    expect(plan.preview.metadata_diff.ingredients).toHaveLength(66);
    expect(plan.preview.files.filter(file => file.overwrite)).toHaveLength(27);
  });

  test('the default branch as revision: the archive is read by the branch\'s head commit, and the relationship records that commit', async () => {
    const { fetch, calls } = door43();
    const plan = await importPlan(fromTb1(['GEN'], 'master'), context(fetch));
    expect(calls).toContain('/api/v1/repos/bahtraku/id_tb1/branches/master');
    expect(calls).toContain(`/api/v1/repos/bahtraku/id_tb1/sb/${TB1_SHA}.zip`);
    expect(calls).not.toContain('/api/v1/repos/bahtraku/id_tb1/releases/tags/master');
    expect(plan.preview.source).toEqual({ ...TB1, revision: 'master', sha: TB1_SHA });
    expect(plan.preview.metadata_diff.relationships).toEqual([{ id: 'dcs::bahtraku/id_tb1', relationType: 'source', flavor: 'textTranslation', revision: TB1_SHA }]);
    expect(stored(plan.id).payload.source).toEqual({ ...TB1, revision: 'master', sha: TB1_SHA, archive_ref: TB1_SHA, relationship_revision: TB1_SHA });
  });

  test('E24: the relationship id, the plan\'s source, and the archive read carry Door43\'s spelling of the source, whatever case the request used', async () => {
    const { fetch, calls } = door43();
    const plan = await importPlan({ ...PENDAU, source: { owner: 'BAHTRAKU', repo: 'ID_TB1', revision: '1974' }, units: ['GEN'] }, context(fetch));
    expect(calls).toContain('/api/v1/repos/BAHTRAKU/ID_TB1');
    expect(calls).toContain('/api/v1/repos/bahtraku/id_tb1/releases/tags/1974');
    expect(calls).toContain('/api/v1/repos/bahtraku/id_tb1/sb/1974.zip');
    expect(plan.preview.source).toEqual({ ...TB1, revision: '1974', sha: TB1_SHA });
    expect(plan.preview.metadata_diff.relationships).toEqual([{ id: 'dcs::bahtraku/id_tb1', relationType: 'source', flavor: 'textTranslation', revision: '1974' }]);
    expect(stored(plan.id).payload.source).toMatchObject(TB1);
  });

  test('W1: a source file whose \\id line names another book is planned as the chosen book, its bytes unchanged, with an id_line_mismatch warning', async () => {
    const text = '\\id EXO\n\\c 1\n\\v 1 Pada mulanya\n';
    const { fetch } = door43({ syntheticArchive: storedZip([['src_bible/ingredients/GEN.usfm', text]]) });
    const plan = await importPlan({ ...PENDAU, source: { ...SYNTHETIC, revision: 'main' }, units: ['GEN'] }, context(fetch));
    expect(plan.preview.files[0]).toMatchObject({ identified: { book: 'gen' }, path: 'ingredients/GEN.usfm', md5: reference(encode(text)) });
    expect(plan.warnings).toEqual([{ code: 'id_line_mismatch', message: 'ingredients/GEN.usfm is imported as GEN, but its \\id line does not name it. The file is committed unchanged.' }]);
  });

  test('R5: a project archive that is not the commit its tree describes is no ground for a plan: door43_unavailable, nothing stored', async () => {
    const archive = openArchive(pendauZip);
    const entries: [string, string][] = [];
    for (const entry of archive.entries) {
      const text = new TextDecoder().decode(await archive.bytes(entry.path));
      entries.push([`perjanjian-baru-pendau/${entry.path}`, entry.path === 'ingredients/MAT.usfm' ? `${text}\n` : text]);
    }
    const { fetch } = door43();
    const changed: Fetch = async (url, init) => (new URL(url).pathname.endsWith(`/Perjanjian-Baru-Pendau/sb/${PENDAU_SHA}.zip`) ? new Response(storedZip(entries)) : fetch(url, init));
    const error = await failure(importPlan(fromTb1(['MAT']), context(changed)));
    expect(error).toMatchObject({ code: 'door43_unavailable', details: { path: 'ingredients/MAT.usfm', reason: 'the archive does not match the default branch tree' } });
    expect([...kv.entries.keys()]).toEqual([]);
  });
});

describe('contract: stories from the recorded en_obs v9 archive into an Open Bible Stories project (E36, #83)', () => {
  const fromEnObs = (units: Units): ParsedInput<'import.plan'> => ({ ...OBS_PROJECT, source: { ...EN_OBS, revision: 'v9' }, units });

  test('E36, R10: story 01 lands at ingredients/content/01.md, byte for byte the archive\'s, with a markdown entry without scope', async () => {
    const { fetch } = door43();
    const plan = OPERATIONS['import.plan'].output.parse(await importPlan(fromEnObs(['1']), context(fetch)));
    expect(plan.preview.files).toEqual([{ name: 'ingredients/content/01.md', identified: { story: '01' }, path: 'ingredients/content/01.md', size: 4396, md5: reference(enObs01), overwrite: false, diff: null }]);
    expect(plan.preview.metadata_diff.ingredients).toEqual([{ path: 'ingredients/content/01.md', before: null, after: { checksum: { md5: reference(enObs01) }, mimeType: 'text/markdown', size: 4396 } }]);
    expect(plan.preview.source).toEqual({ ...EN_OBS, revision: 'v9', sha: 'd39a1dc7a7557ac54e4a8fecc3462147fe7eec3b' });
    expect(plan.would_write).toEqual([{ kind: 'commit', target: 'tc-admin-qa-org/ums_obs@master' }]);
    expect(plan.warnings).toEqual([]);
  });

  test('units: all takes the 50 stories and nothing else: not front.md, back.md, or the license (E36)', async () => {
    const { fetch } = door43();
    const plan = await importPlan(fromEnObs('all'), context(fetch));
    expect(plan.preview.files.map(file => file.path)).toEqual(Array.from({ length: 50 }, (_, i) => `ingredients/content/${String(i + 1).padStart(2, '0')}.md`));
    expect(plan.preview.metadata_diff.ingredients).toHaveLength(50);
  });

  test('Q34: the source relationship of an Open Bible Stories import carries the custom flavor the relationship schema accepts, built behind for Rich', async () => {
    const { fetch } = door43();
    const plan = await importPlan(fromEnObs(['01']), context(fetch));
    expect(plan.preview.metadata_diff.relationships).toEqual([{ id: 'dcs::unfoldingWord/en_obs', relationType: 'source', flavor: 'x-textStories', revision: 'v9' }]);
  });

  test('validation_failed: a story the source lacks, a story number that is none, and a book asked of an Open Bible Stories project are each refused naming the unit', async () => {
    const { fetch } = door43({ syntheticArchive: storedZip([['src/ingredients/content/01.md', '# 1\n']]) });
    const none = await failure(importPlan(fromEnObs(['51']), context(fetch)));
    expect(none).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'units[0]', message: '"51" is not a story of an Open Bible Stories project' }] } });
    const book = await failure(importPlan(fromEnObs(['GEN']), context(fetch)));
    expect(book?.code).toBe('validation_failed');
  });
});

describe('W2, A2: only a writable Scripture Burrito project is planned for, and the source is read only', () => {
  test('W2: on an unsupported project the plan is not_editable with the project\'s editability reason, and nothing but the account and the repository is read', async () => {
    const { fetch, calls } = door43({ repo: { ...pendauRepository, metadata_type: 'rc' } });
    const error = await failure(importPlan(fromTb1(['GEN']), context(fetch)));
    expect(error?.code).toBe('not_editable');
    expect(error?.message).toBe('Resource Container project. Import it into a new project to manage it here.');
    expect(calls).toEqual(['/api/v1/user', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau']);
    expect([...kv.entries.keys()]).toEqual([]);
  });

  test('A2: without push permission to the project the plan is permission_denied and nothing more is read, whatever the source', async () => {
    const { fetch, calls } = door43({ writable: false });
    const error = await failure(importPlan(fromTb1(['GEN']), context(fetch)));
    expect(error?.code).toBe('permission_denied');
    expect(calls).toEqual(['/api/v1/user', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau']);
  });

  test('W2: a source the account cannot push to is imported from all the same: en_obs answers pull only', async () => {
    const { fetch } = door43();
    expect(enObsRepository.permissions.push).toBe(false);
    const plan = await importPlan({ ...OBS_PROJECT, source: { ...EN_OBS, revision: 'v9' }, units: ['01'] }, context(fetch));
    expect(plan.preview.files).toHaveLength(1);
  });
});

describe('the source: it must exist, be of the project\'s type, and be asked for at a release or its default branch', () => {
  test('not_found: a source repository Door43 does not have, named in the details, before the project\'s branch is read', async () => {
    const { fetch, calls } = door43();
    const error = await failure(importPlan({ ...PENDAU, source: { owner: 'bahtraku', repo: 'no_such_repo', revision: 'master' }, units: ['GEN'] }, context(fetch)));
    expect(error).toMatchObject({ code: 'not_found', message: 'The source repository was not found on Door43.', details: { source: { owner: 'bahtraku', repo: 'no_such_repo' } } });
    expect(calls).toEqual(['/api/v1/user', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau', '/api/v1/repos/bahtraku/no_such_repo']);
    expect([...kv.entries.keys()]).toEqual([]);
  });

  test('validation_failed: a source of the other project type is refused on source, before any archive is read', async () => {
    const { fetch, calls } = door43();
    const error = await failure(importPlan({ ...PENDAU, source: { ...EN_OBS, revision: 'v9' }, units: ['GEN'] }, context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { source_type: 'obs', project_type: 'bible', fields: [{ path: 'source', message: 'unfoldingWord/en_obs is an Open Bible Stories repository; a Bible project imports from a Bible repository' }] } });
    expect(calls.filter(call => call.includes('.zip'))).toEqual([]);
  });

  test('validation_failed: a revision that is neither a release nor the default branch is refused on source.revision', async () => {
    const { fetch, calls } = door43();
    const error = await failure(importPlan(fromTb1(['GEN'], 'v2'), context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'source.revision', message: '"v2" is not a release or the default branch of bahtraku/id_tb1' }] } });
    expect(calls).toContain('/api/v1/repos/bahtraku/id_tb1/releases/tags/v2');
    expect(calls.filter(call => call.includes('.zip'))).toEqual([]);
  });

  test('W1, E24: a release whose tag the schema cannot record as a revision is refused on source.revision, before any archive is read, nothing stored', async () => {
    const { fetch, calls } = door43();
    const release = { ...tb1Releases.find(entry => entry.tag_name === '1974'), tag_name: 'v1.0.0+build.1' };
    const tagged: Fetch = async (url, init) => (new URL(url).pathname.includes('/id_tb1/releases/tags/v1.0.0') ? Response.json(release) : fetch(url, init));
    const error = await failure(importPlan(fromTb1(['GEN'], 'v1.0.0+build.1'), context(tagged)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'source.revision' }] } });
    expect(error?.message).toContain('cannot record as a revision');
    expect(calls.filter(call => call.includes('.zip'))).toEqual([]);
    expect([...kv.entries.keys()]).toEqual([]);
  });

  test('source_unavailable: an archive Door43 cannot serve, whether missing or malformed, and nothing stored', async () => {
    const missing = door43({ sourceArchiveStatus: 404 });
    const error = await failure(importPlan(fromTb1(['GEN']), context(missing.fetch)));
    expect(error).toMatchObject({ code: 'source_unavailable', details: { source: { ...TB1, revision: '1974', ref: '1974' }, door43_status: 404 } });
    expect(error?.message).toBe("Door43 could not provide the source repository's archive. Try again later.");
    expect([...kv.entries.keys()]).toEqual([]);

    const malformed = door43({ sourceArchive: encode('not a zip') });
    const bad = await failure(importPlan(fromTb1(['GEN']), context(malformed.fetch)));
    expect(bad?.code).toBe('source_unavailable');
    expect(String(bad?.details.reason)).toContain('malformed archive');
  });

  test('validation_failed: a unit the source lacks is refused naming it in details.units; the rest of the plan is not made', async () => {
    const { fetch } = door43({ sourceArchive: storedZip([['id_tb1/ingredients/GEN.usfm', '\\id GEN\n']]) });
    const error = await failure(importPlan(fromTb1(['GEN', 'EXO', 'rev']), context(fetch)));
    expect(error).toMatchObject({
      code: 'validation_failed',
      details: {
        units: [{ id: 'exo', reason: 'not_in_source' }, { id: 'rev', reason: 'not_in_source' }],
        fields: [{ path: 'units[1]', message: 'bahtraku/id_tb1 at "1974" has no EXO (ingredients/EXO.usfm)' }, { path: 'units[2]', message: 'bahtraku/id_tb1 at "1974" has no REV (ingredients/REV.usfm)' }],
      },
    });
    expect([...kv.entries.keys()]).toEqual([]);
  });

  test('validation_failed: no unit chosen, an id that is no book, or a book chosen twice, each before the source is read', async () => {
    const { fetch, calls } = door43();
    expect(await failure(importPlan(fromTb1([]), context(fetch)))).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'units', message: 'choose at least one book, or all' }] } });
    expect(await failure(importPlan(fromTb1(['GEN', 'FRT']), context(fetch)))).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'units[1]', message: '"FRT" is not a book of a Bible project' }] } });
    expect(await failure(importPlan(fromTb1(['GEN', 'gen']), context(fetch)))).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'units[1]', message: '"gen" is chosen twice (also units[0])' }] } });
    expect(calls.filter(call => call.includes('id_tb1'))).toEqual([]);
  });

  test('validation_failed: all of a source that holds no book under ingredients/', async () => {
    const { fetch } = door43({ sourceArchive: storedZip([['id_tb1/README.md', '# nothing\n']]) });
    const error = await failure(importPlan(fromTb1('all'), context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'units', message: 'bahtraku/id_tb1 at "1974" holds no book under ingredients/' }] } });
  });
});
