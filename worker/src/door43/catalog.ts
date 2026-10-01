// Door43's catalog view of a repository, as the repository search item and the
// repository endpoint return it (E7, E14, E32), mapped to the model's input.
// Door43's field names stop here.

import type { MetadataFormat } from '@tc-admin/shared/schema';
import type { CatalogIngredient, ProjectCatalog } from '../model/project';

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
  metadata_type?: string | null;
  subject?: string | null;
  flavor_type?: string | null;
  flavor?: string | null;
  ingredients?: Door43Ingredient[] | null;
  healthcheck_severity?: string | null;
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
  };
}

/** The model's catalog view of a repository. Absent `ingredients` is unknown, not empty (H3). */
export function projectCatalog(repo: Door43Repository): ProjectCatalog {
  return {
    subject: repo.subject || null,
    metadata_format: metadataFormat(repo.metadata_type),
    ingredients: Array.isArray(repo.ingredients) ? repo.ingredients.map(ingredient) : null,
  };
}
