// Door43 releases as reads (E21): one release by its tag, which is the lookup
// a retry after an unknown outcome makes before anything is written again (R6).
// A release's `target_commitish` is whatever it was created with, a branch
// name for one made on Door43's site (Pendau's `v1.2` says `master`), so the
// commit comes from the catalog entry Door43 carries on every release as
// `door43_metadata` (E20), and from the target only when it is a commit. The
// writes (create, edit) join with #39. Door43's shape stops here.

import { CatalogError } from '@tc-admin/shared/schema';
import { readDoor43 } from './api';
import type { Door43Client } from './api';

/** One release as Door43 returns it. Only the fields read. */
interface Door43Release {
  id?: unknown;
  tag_name?: unknown;
  target_commitish?: unknown;
  html_url?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  door43_metadata?: { commit_sha?: unknown } | null;
}

/** A release in glossary terms. `target_sha` is empty only when Door43 names no commit, which no recorded release does (E21, E27). */
export interface Release {
  id: number;
  tag: string;
  url: string;
  prerelease: boolean;
  draft: boolean;
  target_sha: string;
}

const COMMIT = /^[0-9a-f]{40}$/;

export function releaseShape(body: unknown): Release | null {
  const release = body as Door43Release | null;
  if (typeof release?.id !== 'number' || typeof release.tag_name !== 'string' || !release.tag_name) return null;
  const fromEntry = release.door43_metadata?.commit_sha;
  const target = release.target_commitish;
  return {
    id: release.id,
    tag: release.tag_name,
    url: typeof release.html_url === 'string' ? release.html_url : '',
    prerelease: release.prerelease === true,
    draft: release.draft === true,
    target_sha: typeof fromEntry === 'string' && COMMIT.test(fromEntry) ? fromEntry : typeof target === 'string' && COMMIT.test(target) ? target : '',
  };
}

/** `GET /repos/{owner}/{repo}/releases/tags/{tag}`: the release, or `null` when Door43 has none under that tag (its 404, which a missing repository also answers). */
export async function readReleaseByTag(client: Door43Client, owner: string, repo: string, tag: string): Promise<Release | null> {
  let body: unknown;
  try {
    body = await readDoor43(client, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    if (error instanceof CatalogError && error.code === 'not_found') return null;
    throw error;
  }
  const release = releaseShape(body);
  if (!release) throw new CatalogError('door43_unavailable', { details: { reason: 'unexpected release shape', owner, repo, tag } });
  return release;
}
