// The Door43 writes a project needs (E21, E27): create a repository, and
// commit several files at once through the contents endpoint, the one call
// every committing operation uses (W5). Each is sent once with the session's
// token and nothing else, so Door43 attributes it to the signed-in manager
// (A3) and nothing is retried (X1). There is no repository delete here and
// there will be none (W4). Door43's shapes stop in this module. Branches,
// tags, and releases join with #34 and #39.

import { CatalogError } from '@tc-admin/shared/schema';
import { bytesToBase64, door43Message, writeDoor43 } from './api';
import type { Door43Client } from './api';

/** Every project tC Admin creates has this default branch, as every Door43 repository seen so far (E14, E27). */
export const DEFAULT_BRANCH = 'master';

/** Who a repository is created under: an organization (`POST /orgs/{org}/repos`) or the account itself (`POST /user/repos`, E26). */
export interface RepositoryOwner {
  login: string;
  kind: 'organization' | 'account';
}

/** The created repository, in glossary terms. */
export interface CreatedRepository {
  id: number;
  full_name: string;
  url: string;
  default_branch: string;
  permissions: { push: boolean; admin: boolean };
}

/** `CreateRepoOption` (E21): public, not initialized, so the first commit is the project's (E27). */
export async function createRepository(client: Door43Client, owner: RepositoryOwner, options: { name: string; description: string }): Promise<CreatedRepository> {
  const path = owner.kind === 'organization' ? `/orgs/${encodeURIComponent(owner.login)}/repos` : '/user/repos';
  const outcome = await writeDoor43(client, 'POST', path, {
    name: options.name,
    description: options.description,
    private: false,
    auto_init: false,
    default_branch: DEFAULT_BRANCH,
  });
  const details = { door43_status: outcome.status, owner: owner.login, repo_name: options.name };
  if (outcome.status === 409) throw new CatalogError('name_taken', { values: { repo_name: options.name, owner: owner.login }, details });
  if (outcome.status === 404) throw new CatalogError('not_found', { details: { ...details, reason: 'owner not found' } });
  if (outcome.status === 422) {
    const message = door43Message(outcome);
    throw new CatalogError('validation_failed', { message: `abbreviation: ${message}`, details: { ...details, fields: [{ path: 'abbreviation', message }] } });
  }
  if (outcome.status !== 201) throw new CatalogError('door43_unavailable', { details });
  const repo = outcome.body as { id?: unknown; full_name?: unknown; html_url?: unknown; default_branch?: unknown; permissions?: { push?: unknown; admin?: unknown } | null } | null;
  if (typeof repo?.id !== 'number' || typeof repo.full_name !== 'string' || typeof repo.html_url !== 'string') {
    throw new CatalogError('door43_unavailable', { details: { ...details, reason: 'unexpected repository shape' } });
  }
  return {
    id: repo.id,
    full_name: repo.full_name,
    url: repo.html_url,
    default_branch: typeof repo.default_branch === 'string' && repo.default_branch ? repo.default_branch : DEFAULT_BRANCH,
    permissions: { push: repo.permissions?.push === true, admin: repo.permissions?.admin === true },
  };
}

/** One file of a commit. `create` is the default; `upload` updates an existing file without its blob SHA (E27). */
export interface CommitFile {
  path: string;
  content: Uint8Array | string;
  operation?: 'create' | 'update' | 'upload' | 'delete';
}

export interface CommitOptions {
  message: string;
  files: readonly CommitFile[];
  /** The branch to commit on; omitted for a repository's first commit, which starts its default branch. */
  branch?: string;
}

/** The commit, in glossary terms. */
export interface Commit {
  sha: string;
  url: string;
  /** When Door43 recorded the author's date; `null` when it did not say. */
  committed_at: string | null;
  files: { path: string; sha: string }[];
}

const asBytes = (content: Uint8Array | string) => (typeof content === 'string' ? new TextEncoder().encode(content) : content);

/**
 * One commit of several files through `POST /repos/{owner}/{repo}/contents`
 * (`ChangeFilesOptions`, E21, E27): the one write every committing operation
 * makes (W5). No author or committer is sent; the token's user is both (A3).
 * Anything but a created commit is `commit_failed` quoting Door43's message.
 */
export async function commitFiles(client: Door43Client, owner: string, repo: string, options: CommitOptions): Promise<Commit> {
  const body: Record<string, unknown> = {
    message: options.message,
    files: options.files.map(file => ({ operation: file.operation ?? 'create', path: file.path, content: bytesToBase64(asBytes(file.content)) })),
  };
  if (options.branch) body.branch = options.branch;
  const outcome = await writeDoor43(client, 'POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`, body);
  const details = { door43_status: outcome.status, owner, repo };
  if (outcome.status !== 201 && outcome.status !== 200) throw new CatalogError('commit_failed', { values: { 'error message': door43Message(outcome) }, details });
  const answer = outcome.body as { commit?: { sha?: unknown; html_url?: unknown; author?: { date?: unknown } | null } | null; files?: { path?: unknown; sha?: unknown }[] | null } | null;
  if (typeof answer?.commit?.sha !== 'string' || !answer.commit.sha) throw new CatalogError('commit_failed', { values: { 'error message': 'Door43 did not name the commit' }, details });
  return {
    sha: answer.commit.sha,
    url: typeof answer.commit.html_url === 'string' ? answer.commit.html_url : '',
    committed_at: typeof answer.commit.author?.date === 'string' ? answer.commit.author.date : null,
    files: (answer.files ?? []).flatMap(file => (typeof file.path === 'string' && typeof file.sha === 'string' ? [{ path: file.path, sha: file.sha }] : [])),
  };
}
