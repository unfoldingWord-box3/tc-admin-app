// `upload.plan` (#74) against the recorded Pendau repository, tree, and
// archive (E19, E34, E52; the archive's blobs are the tree's, path for path):
// the order of its checks (W6 before anything, W2 and A2 before anything else
// is read), the overwrites and their diffs, the entries and the metadata diff
// (R10), the binding (R5), the one commit announced (W5), the files held back
// (S5), and what is stored: what was computed, never the bytes (Q33).
import { readFileSync } from 'node:fs';
import { CatalogError, OPERATIONS } from '@tc-admin/shared/schema';
import type { ParsedInput } from '@tc-admin/shared/schema';
import { beforeAll, describe, expect, test } from 'vitest';
import { openArchive } from '../../src/door43/archive';
import type { Fetch } from '../../src/door43/api';
import type { KVNamespace } from '../../src/env';
import { md5 } from '../../src/model/md5';
import { MAX_UPLOAD_BYTES } from '../../src/model/upload-paths';
import { operationContext } from '../../src/operations';
import type { OperationContext } from '../../src/operations';
import type { StoredPlan } from '../../src/operations/plans';
import { uploadPlan } from '../../src/operations/upload-plan';
import type { UploadPlanPayload } from '../../src/operations/upload-plan';
import { recorded } from '../support/recorded';

const PENDAU = { owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' };
/** The default-branch commit the recorded repository names (E52), at which the tree was read. */
const SHA = '2d9dbd1ee09b5a1c28edd8668462f6a64029619b';
const user = recorded<unknown>('2026-10-05/user/user.json');
const repository = recorded<Record<string, unknown>>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau.json.gz');
const tree = recorded<{ sha: string; tree: { path: string; sha: string }[] }>('2026-10-07/repos/bahtraku__Perjanjian-Baru-Pendau__git-trees__master.json.gz');
/** The branch read's shape as recorded on 7 October 2026 (E63), naming Pendau's head commit. */
const branch = { ...(JSON.parse(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-10-07/setup-retry/08-GET-branch.json', import.meta.url), 'utf8')) as { commit: object }), name: 'master' };
const zip = new Uint8Array(readFileSync(new URL('../../../fixtures/door43/qa.door43.org/2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master.zip', import.meta.url)));
const encode = (text: string) => new TextEncoder().encode(text);

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
  repo?: Record<string, unknown>;
  writable?: boolean;
  /** The archive's bytes; Pendau's recorded archive unless given. */
  archive?: Uint8Array;
}

/** A Door43 of recorded answers, every request recorded. */
function door43(options: Door43Options = {}): { fetch: Fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetch = async url => {
    const { pathname, search } = new URL(url);
    calls.push(pathname + search);
    if (pathname === '/api/v1/user') return Response.json(user);
    if (pathname === '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau') return Response.json({ ...(options.repo ?? repository), permissions: options.writable === false ? { pull: true } : { push: true, admin: false, pull: true } });
    if (pathname === '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/branches/master') return Response.json({ ...branch, commit: { ...branch.commit, id: SHA } });
    if (pathname === `/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/git/trees/${SHA}`) return Response.json(tree);
    if (pathname === `/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/sb/${SHA}.zip`) return new Response(options.archive ?? zip);
    return new Response('', { status: 404 });
  };
  return { fetch, calls };
}

const NOW = new Date('2026-10-08T12:00:00.000Z');
let kv: MemoryKV;
const context = (fetch: Fetch): OperationContext => {
  kv = new MemoryKV();
  const base = operationContext({ door43Origin: 'https://qa.door43.org', door43ClientId: 'id' }, 'request-1', 'door43-token', kv);
  return { ...base, door43: { ...base.door43!, fetch }, now: () => NOW };
};
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error : Promise.reject(error)));
const stored = (planId: string) => JSON.parse(kv.entries.get(`plan:${planId}`)!) as StoredPlan<UploadPlanPayload>;
type Files = ParsedInput<'upload.plan'>['files'];
const input = (files: Files, confirmations?: ParsedInput<'upload.plan'>['confirmations']): ParsedInput<'upload.plan'> => ({ ...PENDAU, files, ...(confirmations ? { confirmations } : {}) });
const upload = (name: string, content: Uint8Array | string, mode: number | null = null) => ({ name, mode, content: typeof content === 'string' ? encode(content) : content });

let branchMat: string;
let branchJud: Uint8Array;
beforeAll(async () => {
  const archive = openArchive(zip);
  branchMat = new TextDecoder().decode(await archive.bytes('ingredients/MAT.usfm'));
  branchJud = await archive.bytes('ingredients/JUD.usfm');
});

describe('contract: an upload over the recorded Pendau tree and archive', () => {
  test('R5, W5: one commit is announced, the plan is bound to the default-branch head, and it is stored under its id with an expiry and no bytes', async () => {
    const mat = branchMat.replace('\\v 1 ', '\\v 1 Revised ');
    const gen = '\\id GEN\n\\c 1\n\\v 1 Pada mulanya\n';
    const { fetch, calls } = door43();
    const plan = OPERATIONS['upload.plan'].output.parse(await uploadPlan(input([upload('41-MAT.usfm', mat), upload('books/GEN.usfm', gen), upload('notes.txt', 'catatan\n')]), context(fetch)));

    expect(plan.operation).toBe('upload.plan');
    expect(plan.bound_to).toEqual({ default_branch_sha: SHA, release_tag: null, release_tag_sha: null });
    expect(plan.would_write).toEqual([{ kind: 'commit', target: 'bahtraku/Perjanjian-Baru-Pendau@master' }]);
    expect(plan.created_at).toBe('2026-10-08T12:00:00.000Z');
    expect(plan.expires_at).toBe('2026-10-08T12:30:00.000Z');
    // The account and the repository, then the branch head, and its tree and archive at that commit (E63: by commit, never by the tree's own sha).
    expect(calls.slice(0, 3)).toEqual(['/api/v1/user', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/branches/master']);
    expect(calls.slice(3).sort()).toEqual([`/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/git/trees/${SHA}?recursive=true&per_page=1000&page=1`, `/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau/sb/${SHA}.zip`]);

    const kept = stored(plan.id);
    expect(kept.account).toBe('tc-admin-qa');
    expect(kept.plan).toEqual({ id: plan.id, operation: 'upload.plan', created_at: plan.created_at, expires_at: plan.expires_at, bound_to: plan.bound_to, would_write: plan.would_write, warnings: [] });
    expect(kept.payload).toMatchObject({ ...PENDAU, project_type: 'bible', bound_to: plan.bound_to, default_branch: { name: 'master', sha: SHA } });
    // What was computed from the bytes, and never the bytes (Q33): no stored value holds the uploaded text.
    const raw = kv.entries.get(`plan:${plan.id}`)!;
    expect(raw).not.toContain('Revised');
    expect(raw).not.toContain('Pada mulanya');
    expect(raw).not.toContain('catatan');
    expect(kept.payload.files.map(file => [file.name, file.path, file.md5])).toEqual([
      ['41-MAT.usfm', 'ingredients/MAT.usfm', md5(encode(mat))],
      ['books/GEN.usfm', 'ingredients/GEN.usfm', md5(encode(gen))],
      ['notes.txt', null, md5(encode('catatan\n'))],
    ]);
    const matBlob = tree.tree.find(entry => entry.path === 'ingredients/MAT.usfm')!.sha;
    expect(kept.payload.files.map(file => [file.overwrite, file.replaces_sha])).toEqual([[true, matBlob], [false, null], [false, null]]);
  });

  test('S2: an overwrite of a file on the default branch is detected from its tree (E19) and shown as a text diff; a new file is no overwrite', async () => {
    const mat = branchMat.replace('\\v 1 ', '\\v 1 Revised ');
    const { fetch } = door43();
    const plan = await uploadPlan(input([upload('41-MAT.usfm', mat), upload('GEN.usfm', '\\id GEN\n')]), context(fetch));
    const [matFile, genFile] = plan.preview.files;
    expect(matFile).toMatchObject({ name: '41-MAT.usfm', identified: { book: 'mat' }, path: 'ingredients/MAT.usfm', overwrite: true });
    expect(matFile!.diff).toMatch(/^--- a\/ingredients\/MAT\.usfm\n\+\+\+ b\/ingredients\/MAT\.usfm\n@@ /);
    expect(matFile!.diff).toContain('\n+\\v 1 Revised ');
    expect(matFile!.diff!.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---'))).toHaveLength(1);
    expect(genFile).toEqual({ name: 'GEN.usfm', identified: { book: 'gen' }, path: 'ingredients/GEN.usfm', size: 8, md5: md5(encode('\\id GEN\n')), overwrite: false, diff: null });
  });

  test('S2: a file whose bytes are the default branch\'s own is an overwrite with the empty diff, told by its blob id (E19)', async () => {
    const { fetch } = door43();
    const plan = await uploadPlan(input([upload('65-JUD.usfm', branchJud)]), context(fetch));
    expect(plan.preview.files[0]).toMatchObject({ path: 'ingredients/JUD.usfm', overwrite: true, diff: '' });
  });

  test('R10: every identified file\'s entry carries its bytes\' size and md5, and the metadata diff shows exactly those entries', async () => {
    const mat = encode(branchMat.replace('\\v 1 ', '\\v 1 Revised '));
    const gen = encode('\\id GEN\n\\c 1\n');
    const { fetch } = door43();
    const plan = await uploadPlan(input([upload('41-MAT.usfm', mat), upload('GEN.usfm', gen), upload('notes.txt', 'x')]), context(fetch));
    expect(plan.preview.metadata_diff.ingredients).toEqual([
      { path: 'ingredients/MAT.usfm', before: { checksum: { md5: '5ee344412572e540a257f79d80f8a126' }, mimeType: 'text/x-usfm', size: 154502, scope: { MAT: [] } }, after: { checksum: { md5: md5(mat) }, mimeType: 'text/x-usfm', size: mat.length, scope: { MAT: [] } } },
      { path: 'ingredients/GEN.usfm', before: null, after: { checksum: { md5: md5(gen) }, mimeType: 'text/x-usfm', size: gen.length, scope: { GEN: [] } } },
    ]);
    for (const file of plan.preview.files.filter(file => file.identified)) {
      const entry = plan.preview.metadata_diff.ingredients.find(change => change.path === file.path)!;
      expect([entry.after.size, (entry.after.checksum as { md5: string }).md5]).toEqual([file.size, file.md5]);
    }
    // The proposed metadata.json is stored whole for the apply, with those entries and its own size and md5.
    const metadata = stored(plan.id).payload.metadata!;
    const document = JSON.parse(metadata.content) as { ingredients: Record<string, unknown> };
    expect(document.ingredients['ingredients/GEN.usfm']).toEqual(plan.preview.metadata_diff.ingredients[1]!.after);
    expect([metadata.path, metadata.size, metadata.md5]).toEqual(['metadata.json', encode(metadata.content).length, md5(encode(metadata.content))]);
  });

  test('R5: a default branch whose archive is not the commit its tree describes is no ground for a plan: door43_unavailable, nothing stored', async () => {
    const archive = openArchive(zip);
    const { storedZip } = await import('../support/zip');
    const entries: [string, string][] = [];
    for (const entry of archive.entries) {
      const text = new TextDecoder().decode(await archive.bytes(entry.path));
      entries.push([`perjanjian-baru-pendau/${entry.path}`, entry.path === 'ingredients/MAT.usfm' ? `${text}\n` : text]);
    }
    const { fetch } = door43({ archive: storedZip(entries) });
    const error = await failure(uploadPlan(input([upload('41-MAT.usfm', branchMat.replace('\\v 1 ', '\\v 1 x'))]), context(fetch)));
    expect(error).toMatchObject({ code: 'door43_unavailable', details: { path: 'ingredients/MAT.usfm', reason: 'the archive does not match the default branch tree' } });
    expect([...kv.entries.keys()]).toEqual([]);
  });
});

describe('W6: the batch is checked first, before identification or any Door43 read', () => {
  test('W6: an unsafe name is refused as validation_failed naming the file, and Door43 is never asked', async () => {
    const { fetch, calls } = door43();
    const error = await failure(uploadPlan(input([upload('GEN.usfm', '\\id GEN\n'), upload('../MAT.usfm', '\\id MAT\n')]), context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { files: [{ name: '../MAT.usfm', reason: 'traversal' }] } });
    expect(calls).toEqual([]);
    expect([...kv.entries.keys()]).toEqual([]);
  });

  test('W6: the sizes checked are the bytes received, one byte over the limit is refused, and Door43 is never asked', async () => {
    const { fetch, calls } = door43();
    const error = await failure(uploadPlan(input([upload('GEN.usfm', new Uint8Array(MAX_UPLOAD_BYTES + 1))]), context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { files: [{ name: 'GEN.usfm', reason: 'too_large' }] } });
    expect(calls).toEqual([]);
  });

  test('W6: a symlink or an executable entry is refused before any read', async () => {
    const { fetch, calls } = door43();
    const error = await failure(uploadPlan(input([upload('GEN.usfm', '\\id GEN\n', 0o120777), upload('MAT.usfm', '\\id MAT\n', 0o100755)]), context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { files: [{ name: 'GEN.usfm', reason: 'symlink' }, { name: 'MAT.usfm', reason: 'executable' }] } });
    expect(calls).toEqual([]);
  });

  test('W6: a confirmation naming no file of the batch is validation_failed before any read', async () => {
    const { fetch, calls } = door43();
    const error = await failure(uploadPlan(input([upload('GEN.usfm', '\\id GEN\n')], { 'other.usfm': { book: 'gen' } }), context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { fields: [{ path: 'confirmations.other.usfm' }] } });
    expect(calls).toEqual([]);
  });

  test('W6: two confirmation keys that name one file are validation_failed naming both, before any read', async () => {
    const { fetch, calls } = door43();
    const error = await failure(uploadPlan(input([upload('GEN.usfm', '\\id GEN\n')], { './GEN.usfm': { book: 'gen' }, 'GEN.usfm': { book: 'exo' } }), context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed' });
    expect(error?.message).toContain('"GEN.usfm" and "./GEN.usfm" name the same file');
    expect(calls).toEqual([]);
  });
});

describe('W2, A2: only a writable Scripture Burrito project is planned for', () => {
  test('W2: on an unsupported project the plan is not_editable with the project\'s editability reason, and nothing but the account and the repository is read', async () => {
    const { fetch, calls } = door43({ repo: { ...repository, metadata_type: 'rc' } });
    const error = await failure(uploadPlan(input([upload('GEN.usfm', '\\id GEN\n')]), context(fetch)));
    expect(error?.code).toBe('not_editable');
    expect(error?.message).toBe('Resource Container project. Import it into a new project to manage it here.');
    expect(calls).toEqual(['/api/v1/user', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau']);
    expect([...kv.entries.keys()]).toEqual([]);
  });

  test('A2: without push permission the plan is permission_denied and nothing more is read', async () => {
    const { fetch, calls } = door43({ writable: false });
    const error = await failure(uploadPlan(input([upload('GEN.usfm', '\\id GEN\n')]), context(fetch)));
    expect(error?.code).toBe('permission_denied');
    expect(calls).toEqual(['/api/v1/user', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau']);
  });
});

describe('identification in the plan (#72)', () => {
  test('S5: a file that identifies nothing is held back with no path, listed under unknown, and not written; a batch of only such files announces no write', async () => {
    const { fetch } = door43();
    const plan = await uploadPlan(input([upload('notes.txt', 'x'), upload('RUT-JON.usfm', '\\id JON\n')]), context(fetch));
    expect(plan.preview.files).toEqual([
      { name: 'notes.txt', identified: null, path: null, size: 1, md5: md5(encode('x')), overwrite: false, diff: null },
      { name: 'RUT-JON.usfm', identified: null, path: null, size: 8, md5: md5(encode('\\id JON\n')), overwrite: false, diff: null },
    ]);
    expect(plan.preview.unknown).toEqual(['notes.txt', 'RUT-JON.usfm']);
    expect(plan.preview.metadata_diff).toEqual({ ingredients: [] });
    expect(plan.would_write).toEqual([]);
    expect(stored(plan.id).payload.metadata).toBeNull();
  });

  test('S5: a manager\'s confirmation identifies a held-back file, keyed by its name as sent or as planned', async () => {
    const { fetch } = door43();
    const plan = await uploadPlan(input([upload('./RUT-JON.usfm', '\\id JON\n')], { './RUT-JON.usfm': { book: 'JON' } }), context(fetch));
    expect(plan.preview.files[0]).toMatchObject({ name: 'RUT-JON.usfm', identified: { book: 'jon' }, path: 'ingredients/JON.usfm', overwrite: false });
    expect(plan.warnings).toEqual([]);
    expect(stored(plan.id).payload.files[0]!.confirmed).toBe(true);
  });

  test('a confirmation naming a book other than the \\id line\'s is planned as confirmed, its bytes unchanged, with an id_line_mismatch warning', async () => {
    const { fetch } = door43();
    const bytes = '\\id EST\n\\c 1\n';
    const plan = await uploadPlan(input([upload('est_ult_01-GEN.usfm', bytes), upload('draft.usfm', 'no id here\n')], { 'est_ult_01-GEN.usfm': { book: 'gen' }, 'draft.usfm': { book: 'rut' } }), context(fetch));
    expect(plan.preview.files.map(file => [file.path, file.md5])).toEqual([
      ['ingredients/GEN.usfm', md5(encode(bytes))],
      ['ingredients/RUT.usfm', md5(encode('no id here\n'))],
    ]);
    expect(plan.warnings).toEqual([
      { code: 'id_line_mismatch', message: 'est_ult_01-GEN.usfm is confirmed as GEN, but its \\id line does not name it. The file is committed unchanged.' },
      { code: 'id_line_mismatch', message: 'draft.usfm is confirmed as RUT, but its \\id line does not name it. The file is committed unchanged.' },
    ]);
  });

  test('W6: two files identified as one book are refused as validation_failed naming both, before the branch is read', async () => {
    const { fetch, calls } = door43();
    const error = await failure(uploadPlan(input([upload('MAT.usfm', '\\id MAT\n'), upload('GEN.usfm', '\\id GEN\n'), upload('40-MAT.usfm', '\\id MAT\n')]), context(fetch)));
    expect(error).toMatchObject({
      code: 'validation_failed',
      details: { files: [{ name: 'MAT.usfm', reason: 'same_unit', unit: { book: 'mat' } }, { name: '40-MAT.usfm', reason: 'same_unit', unit: { book: 'mat' } }], fields: [{ path: 'files.0.name' }, { path: 'files.2.name' }] },
    });
    expect(error?.message).toContain('"MAT.usfm": the file is MAT (ingredients/MAT.usfm), as is "40-MAT.usfm"');
    expect(calls).toEqual(['/api/v1/user', '/api/v1/repos/bahtraku/Perjanjian-Baru-Pendau']);
  });

  test('W6: a confirmation that makes two files one book is refused the same way', async () => {
    const { fetch } = door43();
    const error = await failure(uploadPlan(input([upload('MAT.usfm', '\\id MAT\n'), upload('draft.usfm', '\\id MRK\n')], { 'draft.usfm': { book: 'mat' } }), context(fetch)));
    expect(error).toMatchObject({ code: 'validation_failed', details: { files: [{ name: 'MAT.usfm' }, { name: 'draft.usfm' }] } });
  });
});
