// Door43's catalog search by owner and flavor (E35), the import picker's list
// of sources: `GET /catalog/search?owner=&flavor=textTranslation&flavor=textStories&stage=`,
// every page, each entry mapped to glossary terms. Door43's field names stop here.
//
// Each entry describes one ref of one repository: with `stage=prod` (Door43's
// default, E34, E62) its latest full release; with `stage=latest`, the latest full
// release of a repository that has one and the default branch of one that has
// none (E35: bahtraku's 40 released repositories came back as their releases
// and `PB-Loli-Edisi-Percobaan`, unreleased, as `master`). Each entry also
// carries its repository with the repository's catalog stages (E14), so the
// default-branch head of a released repository is in the same answer.

import { CatalogError } from '@tc-admin/shared/schema';
import type { RepoRef } from '@tc-admin/shared/schema';
import type { ProjectCatalog } from '../model/project';
import { SUPPORTED_FLAVORS } from '../model/project';
import { readDoor43 } from './api';
import type { Door43Client } from './api';
import { projectCatalog, repositoryRefs } from './catalog';
import type { Door43Ingredient, Door43Repository, RepositoryRefs } from './catalog';

/** The catalog stages `source.search` asks for: the latest full release, or the default branch too. */
export type CatalogStage = 'prod' | 'latest';

/** One catalog search entry (E35, the shape of E20). Only the fields read; each is checked, since the answer is data. */
interface Door43CatalogEntry {
  id?: unknown;
  name?: unknown;
  owner?: unknown;
  title?: unknown;
  language?: unknown;
  language_title?: unknown;
  metadata_type?: string | null;
  flavor?: string | null;
  ingredients?: Door43Ingredient[] | null;
  stage?: unknown;
  branch_or_tag_name?: unknown;
  commit_sha?: unknown;
  repo?: Door43Repository | null;
}

/** One catalog search entry in glossary terms. */
export interface CatalogSearchEntry {
  ref: RepoRef;
  /** The title Door43 reads from the ref's metadata; the repository name when it has none. */
  title: string;
  language: { code: string; title: string };
  /** The flavor, metadata format, and ingredients of the ref this entry describes. */
  catalog: ProjectCatalog;
  /** The stage this entry describes, as Door43 names it; `null` for any other. */
  stage: CatalogStage | null;
  /** The tag (`prod`) or branch (`latest`) this entry describes, with its commit; `null` when Door43 names none. */
  revision: { name: string; sha: string } | null;
  /** The repository's default-branch head and latest full release, from its catalog stages (E14). */
  refs: RepositoryRefs;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function entry(raw: Door43CatalogEntry): CatalogSearchEntry | null {
  const owner = text(raw.owner) || text(raw.repo?.owner?.login);
  const repo = text(raw.name) || text(raw.repo?.name);
  if (!owner || !repo) return null;
  const stage = raw.stage === 'prod' || raw.stage === 'latest' ? raw.stage : null;
  const name = text(raw.branch_or_tag_name);
  const sha = text(raw.commit_sha);
  return {
    ref: { owner, repo },
    title: text(raw.title) || repo,
    language: { code: text(raw.language), title: text(raw.language_title) },
    catalog: projectCatalog(raw),
    stage,
    revision: name && sha ? { name, sha } : null,
    refs: raw.repo ? repositoryRefs(raw.repo) : { default_branch: null, latest_full_release: null },
  };
}

/** The page size asked for; the search honors `limit` and `page` (E62). */
const PAGE_SIZE = 50;
/** A hundred pages is five thousand Bible and Open Bible Stories repositories for one owner: beyond any owner on Door43. */
const MAX_PAGES = 100;

/**
 * The owner's Bible and Open Bible Stories entries in any metadata format at the
 * given stage, every page, until the empty list Door43 answers past the last page
 * and for an owner with no entries (E62). A page that repeats an earlier one, an
 * answer that is not a list (`data: null` included, which the search was not seen
 * to send), or more than `MAX_PAGES` pages fails as `door43_unavailable`, never
 * as a partial or an invented empty list.
 */
export async function searchCatalog(client: Door43Client, owner: string, stage: CatalogStage): Promise<CatalogSearchEntry[]> {
  const entries: CatalogSearchEntry[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await readDoor43<{ data?: unknown } | null>(client, '/catalog/search', { owner, flavor: SUPPORTED_FLAVORS, stage, page, limit: PAGE_SIZE });
    const batch = body?.data;
    if (!Array.isArray(batch)) throw new CatalogError('door43_unavailable', { details: { reason: 'unexpected catalog search shape' } });
    if (batch.length === 0) return entries;
    const signature = JSON.stringify(batch.map(item => (item && typeof item === 'object' ? (item as Door43CatalogEntry).id : null)));
    if (seen.has(signature)) throw new CatalogError('door43_unavailable', { details: { reason: 'repeated result page', page } });
    seen.add(signature);
    for (const item of batch) {
      const mapped = item && typeof item === 'object' ? entry(item as Door43CatalogEntry) : null;
      if (mapped) entries.push(mapped);
    }
  }
  throw new CatalogError('door43_unavailable', { details: { reason: 'catalog search longer than the read limit', pages: MAX_PAGES } });
}
