// The recursive git tree of a ref (`GET /repos/{owner}/{repo}/git/trees/{ref}
// ?recursive=true`, E19): every file with its blob SHA, which is the same for
// a book whether it sits in a Resource Container layout on the default branch
// or in a Scripture Burrito release (E18), so a release plan compares SHAs
// instead of downloading archives. Door43 pages the tree: a page that is not
// the last says `truncated: true` (observed 7 October 2026, E52), so every
// page is read until one says otherwise. Door43's shape stops here.

import { CatalogError } from '@tc-admin/shared/schema';
import { readDoor43 } from './api';
import type { Door43Client } from './api';

/** One entry of the tree, as Door43 lists it. Only the fields read. */
interface Door43TreeEntry {
  path?: unknown;
  type?: unknown;
  sha?: unknown;
  size?: unknown;
}

interface Door43Tree {
  sha?: unknown;
  tree?: unknown;
  truncated?: unknown;
  total_count?: unknown;
}

/** A file of a ref: its path from the repository root and its blob SHA. */
export interface TreeFile {
  path: string;
  sha: string;
  size: number | null;
}

/** A ref's files, in Door43's order, with the tree's own SHA: the tree object's, not the commit's, whether read by branch or by commit (E63). */
export interface Tree {
  sha: string;
  files: TreeFile[];
}

/** Door43's largest page (E19). */
const PAGE_SIZE = 1000;
/** A hundred pages is a hundred thousand files: beyond any Bible project. */
const MAX_PAGES = 100;

export async function readTree(client: Door43Client, owner: string, repo: string, ref: string): Promise<Tree> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}`;
  const files: TreeFile[] = [];
  let sha = '';
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await readDoor43<Door43Tree>(client, path, { recursive: true, per_page: PAGE_SIZE, page });
    if (typeof body?.sha !== 'string' || !Array.isArray(body.tree)) {
      throw new CatalogError('door43_unavailable', { details: { reason: 'unexpected tree shape', owner, repo, ref } });
    }
    sha ||= body.sha;
    for (const entry of body.tree as Door43TreeEntry[]) {
      if (entry.type !== 'blob' || typeof entry.path !== 'string' || !entry.path || typeof entry.sha !== 'string' || !entry.sha) continue;
      files.push({ path: entry.path, sha: entry.sha, size: typeof entry.size === 'number' ? entry.size : null });
    }
    if (body.truncated !== true) return { sha, files };
  }
  throw new CatalogError('door43_unavailable', { details: { reason: 'tree longer than the read limit', owner, repo, ref, pages: MAX_PAGES } });
}
