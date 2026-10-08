// Door43's catalog view of a repository, as the repository search item and the
// repository endpoint return it (E7, E14, E32), mapped to the model's input.
// Door43's field names stop here.

import type { MetadataFormat, ProjectRef } from '@tc-admin/shared/schema';
import type { CatalogIngredient, ProjectCatalog } from '../model/project';
import { readDoor43 } from './api';
import type { Door43Client } from './api';

/** One entry of `ingredients[]` (E14). Only the fields tC Admin reads. */
export interface Door43Ingredient {
  identifier?: string | null;
  path?: string | null;
  exists?: boolean | null;
  is_dir?: boolean | null;
  categories?: string[] | null;
  size?: number | null;
  title?: string | null;
}

/**
 * The fields of a repository search item or repository response that the
 * project model reads (E14). Other issues extend this as they read more.
 */
export interface Door43Repository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  html_url?: string | null;
  /** When Door43 last recorded a change to the repository (E32). */
  updated_at?: string | null;
  title?: string | null;
  description?: string | null;
  default_branch?: string | null;
  language?: string | null;
  language_title?: string | null;
  metadata_type?: string | null;
  /** The Scripture Burrito flavor, which Door43 reads for every metadata format (E14, E42). Its `subject` is derived from this and is not read. */
  flavor?: string | null;
  ingredients?: Door43Ingredient[] | null;
  healthcheck_severity?: string | null;
  /** The catalog stages (E14): the latest full release, the latest pre-release, and the default-branch head. */
  catalog?: { prod?: Door43CatalogStage | null; preprod?: Door43CatalogStage | null; latest?: Door43CatalogStage | null } | null;
}

/** One catalog stage of a repository (E14). Only the fields read. */
export interface Door43CatalogStage {
  branch_or_tag_name?: unknown;
  commit_sha?: unknown;
  released?: unknown;
}

/** The refs a release plan starts from, in glossary terms: the default-branch head and the latest full release (E14). */
export interface RepositoryRefs {
  /** `null` for a repository without a commit (E10). */
  default_branch: { name: string; sha: string } | null;
  latest_full_release: { tag: string; sha: string; released_at: string | null } | null;
}

function stage(value: Door43CatalogStage | null | undefined): { name: string; sha: string; released_at: string | null } | null {
  if (!value || typeof value.branch_or_tag_name !== 'string' || !value.branch_or_tag_name || typeof value.commit_sha !== 'string' || !value.commit_sha) return null;
  return { name: value.branch_or_tag_name, sha: value.commit_sha, released_at: typeof value.released === 'string' ? value.released : null };
}

export function repositoryRefs(repo: Door43Repository): RepositoryRefs {
  const latest = stage(repo.catalog?.latest);
  const prod = stage(repo.catalog?.prod);
  return {
    default_branch: latest ? { name: latest.name, sha: latest.sha } : null,
    latest_full_release: prod ? { tag: prod.name, sha: prod.sha, released_at: prod.released_at } : null,
  };
}

/** The catalog view of one ref (E20): the same fields as the repository's, for that tag or branch, with the commit it was computed for. */
export interface CatalogEntry {
  sha: string | null;
  catalog: ProjectCatalog;
}

/** `GET /catalog/entry/{owner}/{repo}/{ref}` (E20). A ref without an entry is `not_found`. */
export async function readCatalogEntry(client: Door43Client, owner: string, repo: string, ref: string): Promise<CatalogEntry> {
  const entry = await readDoor43<Door43Repository & { commit_sha?: unknown }>(
    client,
    `/catalog/entry/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}`,
  );
  return { sha: typeof entry.commit_sha === 'string' && entry.commit_sha ? entry.commit_sha : null, catalog: projectCatalog(entry) };
}

/** `GET /api/v1/repos/search` returns `{ ok, data }` (E7). */
export interface Door43RepositorySearch {
  ok: boolean;
  data: Door43Repository[];
}

/** `metadata_type` is `rc`, `sb`, `tc`, or `ts` (E14, `/catalog/list/metadata-types`); anything else is no recognized metadata. */
export function metadataFormat(metadataType: string | null | undefined): MetadataFormat {
  switch (metadataType) {
    case 'sb':
    case 'rc':
    case 'ts':
    case 'tc':
      return metadataType;
    default:
      return 'none';
  }
}

function ingredient(entry: Door43Ingredient): CatalogIngredient {
  return {
    id: entry.identifier ?? '',
    path: entry.path ?? '',
    exists: entry.exists === true,
    is_dir: entry.is_dir === true,
    title: entry.title ?? '',
  };
}

/** The model's catalog view of a repository. Absent `ingredients` is unknown, not empty (H3). */
export function projectCatalog(repo: Pick<Door43Repository, 'flavor' | 'metadata_type' | 'ingredients'>): ProjectCatalog {
  return {
    flavor: repo.flavor || null,
    metadata_format: metadataFormat(repo.metadata_type),
    ingredients: Array.isArray(repo.ingredients) ? repo.ingredients.map(ingredient) : null,
  };
}

/** What a repository is called and where it lives, in glossary terms. A repository without a title is called by its name. */
export interface RepositoryIdentity {
  ref: ProjectRef;
  title: string;
  description: string;
  default_branch: string;
  language: { code: string; title: string };
}

export function repositoryIdentity(repo: Door43Repository): RepositoryIdentity {
  return {
    ref: { owner: repo.owner.login, repo: repo.name, id: repo.id, url: repo.html_url ?? '' },
    title: repo.title || repo.name,
    description: repo.description ?? '',
    default_branch: repo.default_branch ?? '',
    language: { code: repo.language ?? '', title: repo.language_title ?? '' },
  };
}
