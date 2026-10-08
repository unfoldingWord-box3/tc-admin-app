// Door43 releases as reads (E21): one release by its tag, which is the lookup
// a retry after an unknown outcome makes before anything is written again (R6).
// A release's `target_commitish` is whatever it was created with, a branch
// name for one made on Door43's site (Pendau's `v1.2` says `master`), so the
// commit comes from the catalog entry Door43 carries on every release as
// `door43_metadata` (E20), and from the target only when it is a commit. The
// writes: one release created on the snapshot commit, which makes the tag as
// well (E21, E27), and the one edit that promotes a pre-release and changes
// nothing else (R8); each sent once and never retried (X1). Door43's shape
// stops here.

import { CatalogError } from '@tc-admin/shared/schema';
import { door43Message, readDoor43, writeDoor43 } from './api';
import type { Door43Client } from './api';

/** One release as Door43 returns it. Only the fields read. */
interface Door43Release {
  id?: unknown;
  tag_name?: unknown;
  target_commitish?: unknown;
  html_url?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  published_at?: unknown;
  author?: { login?: unknown } | null;
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

/** The release's answer by its tag, or `null` for Door43's 404 (which a missing repository also answers). */
async function readReleaseBody(client: Door43Client, owner: string, repo: string, tag: string): Promise<unknown> {
  try {
    return await readDoor43(client, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    if (error instanceof CatalogError && error.code === 'not_found') return null;
    throw error;
  }
}

/** `GET /repos/{owner}/{repo}/releases/tags/{tag}`: the release, or `null` when Door43 has none under that tag (its 404, which a missing repository also answers). */
export async function readReleaseByTag(client: Door43Client, owner: string, repo: string, tag: string): Promise<Release | null> {
  const body = await readReleaseBody(client, owner, repo, tag);
  if (body === null) return null;
  const release = releaseShape(body);
  if (!release) throw new CatalogError('door43_unavailable', { details: { reason: 'unexpected release shape', owner, repo, tag } });
  return release;
}

/** A full release as the project report names it (operations.md §2): its tag, its commit, when it was published, and who published it. */
export interface PublishedRelease {
  tag: string;
  sha: string;
  published_at: string | null;
  author: string | null;
}

/**
 * The release under a tag with when and by whom it was published (`published_at`,
 * `author.login`, recorded in `2026-09-22/probe-write/14-lookup-by-tag.json`), or
 * `null` when Door43 has none under that tag. A field Door43 does not give is `null`.
 */
export async function readPublishedRelease(client: Door43Client, owner: string, repo: string, tag: string): Promise<PublishedRelease | null> {
  const body = await readReleaseBody(client, owner, repo, tag);
  if (body === null) return null;
  const release = releaseShape(body);
  if (!release) throw new CatalogError('door43_unavailable', { details: { reason: 'unexpected release shape', owner, repo, tag } });
  const { published_at, author } = body as Door43Release;
  return {
    tag: release.tag,
    sha: release.target_sha,
    published_at: typeof published_at === 'string' && published_at ? published_at : null,
    author: typeof author?.login === 'string' && author.login ? author.login : null,
  };
}

export interface ReleaseToCreate {
  tag: string;
  /** The notes, as the release body. */
  notes: string;
  /** The snapshot commit the tag and the release target (E27: the release records the SHA). */
  target_sha: string;
  prerelease: boolean;
}

/** How a release write ended when Door43 did not do it: refused as existing, refused otherwise, or not confirmed (X1). */
export class ReleaseWriteError extends Error {
  constructor(
    readonly kind: 'exists' | 'failed' | 'unknown',
    readonly reason: string,
    readonly status: number | null,
  ) {
    super(reason);
  }
}

const unanswered = (error: unknown): ReleaseWriteError | null =>
  error instanceof CatalogError && error.code === 'door43_unavailable' ? new ReleaseWriteError('unknown', String(error.details.reason ?? 'Door43 did not answer'), null) : null;

/**
 * `POST /repos/{owner}/{repo}/releases` (`CreateReleaseOption`, E21) with the tag,
 * the notes, the commit, and the pre-release flag; Door43 creates the tag on that
 * commit with the release (E27). A 409 means the tag or release is already there
 * (`exists`, R6); any other 4xx refusal is `failed`; a request Door43 did not answer,
 * answered unreadably, or answered with a status that does not say it refused (a 5xx
 * or gateway timeout, a 408, an unexpected success) is `unknown`: whether the release
 * exists is then for `release.lookup` to settle before anything is sent again (R6, X1).
 */
export async function createRelease(client: Door43Client, owner: string, repo: string, release: ReleaseToCreate): Promise<Release> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
  const body = { tag_name: release.tag, name: release.tag, body: release.notes, target_commitish: release.target_sha, prerelease: release.prerelease, draft: false };
  let outcome;
  try {
    outcome = await writeDoor43(client, 'POST', path, body);
  } catch (error) {
    throw unanswered(error) ?? error;
  }
  if (outcome.status === 409) throw new ReleaseWriteError('exists', door43Message(outcome), 409);
  const refused = outcome.status >= 400 && outcome.status < 500 && outcome.status !== 408;
  if (outcome.status !== 201) throw new ReleaseWriteError(refused ? 'failed' : 'unknown', door43Message(outcome), outcome.status);
  const created = releaseShape(outcome.body);
  if (!created) throw new ReleaseWriteError('unknown', 'unexpected release shape', 201);
  return created;
}

/**
 * `PATCH /repos/{owner}/{repo}/releases/{id}` with `{ prerelease: false }` and nothing
 * else (`EditReleaseOption`, E21, E27): the promotion changes the flag only (R8). A
 * release Door43 no longer has is `not_found`; any other answer but 200 is `failed`
 * with Door43's message; no answer is `unknown`.
 */
export async function promoteRelease(client: Door43Client, owner: string, repo: string, id: number): Promise<Release> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${id}`;
  let outcome;
  try {
    outcome = await writeDoor43(client, 'PATCH', path, { prerelease: false });
  } catch (error) {
    throw unanswered(error) ?? error;
  }
  if (outcome.status === 404) throw new CatalogError('not_found', { details: { owner, repo, release_id: id } });
  if (outcome.status !== 200) throw new ReleaseWriteError('failed', door43Message(outcome), outcome.status);
  const edited = releaseShape(outcome.body);
  if (!edited) throw new ReleaseWriteError('unknown', 'unexpected release shape', 200);
  return edited;
}
