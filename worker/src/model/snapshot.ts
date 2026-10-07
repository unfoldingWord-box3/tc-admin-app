// What a release snapshot writes (ADR 0010, Q22, #34): given the plan's
// candidates, the manager's selection, the classification of the default
// branch's files, and the blob SHAs of the ref the temporary branch starts
// from, the files each commit uploads or deletes. Nothing is uploaded that
// the start ref already has byte for byte, which is how carried-forward books
// are never uploaded and unchanged root files are left alone (R1); a book
// left out is deleted and listed (R2); the uploads are spread over commits
// no larger than `MAX_COMMIT_BYTES` of raw content, since a Worker cannot
// hold an aligned Bible as one request (E30, Q22). Pure.

import type { SelectionState } from '@tc-admin/shared/schema';
import type { Candidate } from './candidates';
import { isRootOrWorkflow } from './classify';
import type { Classification } from './classify';

/** The raw bytes one commit carries at most: base64 adds a third, and the Worker holds the request whole (Q22, E30). */
export const MAX_COMMIT_BYTES = 32 * 1024 * 1024;

export interface Upload {
  operation: 'upload';
  path: string;
  size: number;
  /** Where the bytes come from, for the receipt (`snapshot.files[].source`). */
  source: 'default_branch';
  unit: string | null;
}

export interface Deletion {
  operation: 'delete';
  path: string;
  /** The blob SHA on the start ref, which Door43 needs to delete a file (E21). */
  sha: string;
  unit: string | null;
}

export type SnapshotWrite = Upload | Deletion;

export interface SnapshotPlan {
  /** Every change to make on the temporary branch, in commit order; `metadata.json` is the last upload. */
  writes: SnapshotWrite[];
  /** The writes grouped into commits of at most `MAX_COMMIT_BYTES` of uploads; deletions and `metadata.json` go in the last. */
  commits: SnapshotWrite[][];
  /** Every file of the snapshot with where its bytes come from (`tag` for one the start ref keeps). */
  files: { path: string; source: 'tag' | 'default_branch'; unit: string | null }[];
}

export interface SnapshotInput {
  project_type: 'bible' | 'obs';
  /** `true` when the temporary branch starts from the previous release's commit; `false` from the default-branch head. */
  from_release: boolean;
  candidates: readonly Candidate[];
  selection: Readonly<Record<string, SelectionState>>;
  /** The default branch's files, classified against its metadata (#20). */
  branch: Classification;
  /** Path to blob SHA on the default branch. */
  branch_blobs: ReadonlyMap<string, string>;
  /** Path to blob SHA and size on the ref the branch starts from. */
  start_blobs: ReadonlyMap<string, string>;
  /** Sizes of the default branch's files, by path. */
  sizes: ReadonlyMap<string, number>;
  /** Unknown files the manager included (product spec §8). */
  unknown_included: readonly string[];
  /** The merged `metadata.json`, which every snapshot writes. */
  metadata_size: number;
}

const METADATA = 'metadata.json';

/** The writes of one release, and how they fall into commits. */
export function planSnapshot(input: SnapshotInput): SnapshotPlan {
  const uploads: Upload[] = [];
  const deletions: Deletion[] = [];
  const files: SnapshotPlan['files'] = [];
  const size = (path: string) => input.sizes.get(path) ?? 0;
  const same = (path: string) => input.start_blobs.has(path) && input.start_blobs.get(path) === input.branch_blobs.get(path);
  const upload = (path: string, unit: string | null) => {
    files.push({ path, source: 'default_branch', unit });
    if (!same(path)) uploads.push({ operation: 'upload', path, size: size(path), source: 'default_branch', unit });
  };
  const remove = (path: string, unit: string | null) => {
    const sha = input.start_blobs.get(path);
    if (sha) deletions.push({ operation: 'delete', path, sha, unit });
  };

  if (input.project_type === 'obs') {
    // The whole default branch, which the temporary branch starts from: only the metadata is refreshed (ADR 0013).
    for (const file of input.branch.files) if (file.path !== METADATA) files.push({ path: file.path, source: 'default_branch', unit: file.unit });
  } else {
    for (const candidate of input.candidates) {
      const selection = input.selection[candidate.id] ?? 'leave_out';
      if (selection === 'include' && candidate.default_branch) upload(candidate.default_branch.path, candidate.id);
      else if (selection === 'carry_forward' && candidate.baseline) files.push({ path: candidate.baseline.path, source: 'tag', unit: candidate.id });
    }
    // Every root file, `.gitea/` file, and administrative ingredient comes from the default branch (R1, Q22).
    for (const path of input.branch.administrative) upload(path, null);
    // Unknown files: only the ones the manager included (S5).
    for (const path of input.branch.unknown) if (input.unknown_included.includes(path)) upload(path, null);
    // Everything under `ingredients/` the start ref holds that the snapshot does not name is deleted, so the branch's tree is `files`:
    // a left-out released book (R2), a first release's left-out book, a book's old path after a rename, an unknown file not included (S5),
    // an administrative ingredient the default branch no longer lists. Outside `ingredients/` the archive does not carry every file (E17),
    // so a root or `.gitea/` file is deleted only when the default branch's tree no longer has it (decided 7 October 2026 by Rich):
    // one on both refs stays, uploaded or not; one in another directory is left alone.
    const named = new Set(files.map(file => file.path));
    const unitOf = new Map(input.candidates.flatMap(candidate => [candidate.baseline, candidate.default_branch].flatMap(ref => (ref ? [[ref.path, candidate.id] as const] : []))));
    for (const [path] of input.start_blobs) {
      if (path.startsWith('ingredients/')) {
        if (!named.has(path)) remove(path, unitOf.get(path) ?? null);
      } else if (path !== METADATA && isRootOrWorkflow(path) && !named.has(path) && !input.branch_blobs.has(path)) remove(path, null);
    }
  }
  files.push({ path: METADATA, source: 'default_branch', unit: null });
  uploads.push({ operation: 'upload', path: METADATA, size: input.metadata_size, source: 'default_branch', unit: null });

  const commits = batch(uploads, deletions);
  return { writes: commits.flat(), commits, files };
}

/**
 * Uploads in commits of at most `MAX_COMMIT_BYTES`, the metadata counted with them; the metadata and every
 * deletion in the last, so the snapshot is complete when the last commit lands. One file larger than the
 * ceiling still makes a commit of its own, which the caller refuses (`commitBytes`) before any write.
 */
export function batch(uploads: readonly Upload[], deletions: readonly Deletion[]): SnapshotWrite[][] {
  const metadata = uploads.filter(upload => upload.path === METADATA);
  const content = uploads.filter(upload => upload.path !== METADATA);
  const commits: SnapshotWrite[][] = [];
  let current: SnapshotWrite[] = [];
  let bytes = 0;
  for (const upload of [...content, ...metadata]) {
    if (current.length > 0 && bytes + upload.size > MAX_COMMIT_BYTES) {
      commits.push(current);
      current = [];
      bytes = 0;
    }
    if (upload.path === METADATA) current.push(...deletions);
    current.push(upload);
    bytes += upload.size;
  }
  if (metadata.length === 0) current.push(...deletions);
  commits.push(current);
  return commits;
}

/** The raw bytes a commit uploads. */
export function commitBytes(commit: readonly SnapshotWrite[]): number {
  return commit.reduce((total, write) => total + (write.operation === 'upload' ? write.size : 0), 0);
}

/**
 * How many commits the plan announces (R3, W5): every file of the default branch uploaded, in the order given,
 * the metadata last, by the same rule as `batch`. A size the tree does not give counts as a full commit.
 */
export function commitsForAll(sizes: readonly (number | null)[]): number {
  const uploads = sizes.map((size, index): Upload => ({ operation: 'upload', path: `${index}`, size: size ?? MAX_COMMIT_BYTES, source: 'default_branch', unit: null }));
  return batch(uploads, []).length;
}
