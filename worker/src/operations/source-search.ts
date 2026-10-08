// `source.search` (operations.md §4): an owner's Bible and Open Bible Stories
// repositories in any metadata format, as import sources (ADR 0013), at their
// last release (`prod`) or their default branch (`latest`), so an unreleased
// translationCore or translationStudio repository can be a source too (Q25).
// One catalog search, every page (E35), read live, with its freshness (P3).
//
// Each source's revision is the release tag the entry describes (`prod`) or the
// repository's default-branch head (`latest`), each with its commit. Its books
// are the ones the catalog itemizes for that same commit, or `null` when the
// catalog does not itemize them (H3): a container only, as for a Resource
// Container Open Bible Stories repository (E35, E36), or, for `latest`, an
// entry that describes the last release while the default branch has moved on
// since. `import.plan` then reads the archive. The project type is the
// flavor's (Q23); anything outside the two flavors is never returned.

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { searchCatalog } from '../door43/catalog-search';
import type { CatalogSearchEntry } from '../door43/catalog-search';
import { offeredUnits, projectTypeFromFlavor } from '../model/project';
import type { OperationContext } from './context';
import { signedIn } from './context';

type SourceSearch = OperationOutput<'source.search'>;
type Source = SourceSearch['sources'][number];

/** The revision a source offers at the asked stage, with whether the catalog entry describes that same commit. */
function revisionOf(entry: CatalogSearchEntry, stage: ParsedInput<'source.search'>['stage']): { revision: Source['revision']; itemized: boolean } | null {
  if (stage === 'prod') {
    if (entry.stage !== 'prod' || !entry.revision) return null;
    return { revision: { tag: entry.revision.name, sha: entry.revision.sha }, itemized: true };
  }
  const head = entry.refs.default_branch ?? (entry.stage === 'latest' ? entry.revision : null);
  if (!head) return null;
  return { revision: { branch: head.name, sha: head.sha }, itemized: entry.revision?.sha === head.sha };
}

function source(entry: CatalogSearchEntry, stage: ParsedInput<'source.search'>['stage']): Source | null {
  const project_type = projectTypeFromFlavor(entry.catalog.flavor);
  if (project_type === 'other') return null;
  const offered = revisionOf(entry, stage);
  if (!offered) return null;
  return {
    ref: entry.ref,
    title: entry.title,
    language: entry.language,
    project_type,
    metadata_format: entry.catalog.metadata_format,
    stage,
    revision: offered.revision,
    released: entry.stage === 'prod' || entry.refs.latest_full_release !== null,
    books: offered.itemized ? offeredUnits(entry.catalog, project_type) : null,
  };
}

export async function sourceSearch(input: ParsedInput<'source.search'>, context: OperationContext): Promise<SourceSearch> {
  const client = signedIn(context);
  const owner = input.owner.trim();
  if (!owner) throw new CatalogError('validation_failed', { message: 'owner: an owner is required', details: { fields: [{ path: 'owner', message: 'an owner is required' }] } });
  const entries = await searchCatalog(client, owner, input.stage);
  // One source per repository, in Door43's order (E35 never listed one twice; the first entry is kept if it ever does).
  const sources = new Map<string, Source>();
  for (const entry of entries) {
    const found = source(entry, input.stage);
    const key = found && `${found.ref.owner}/${found.ref.repo}`.toLowerCase();
    if (found && key && !sources.has(key)) sources.set(key, found);
  }
  return {
    sources: [...sources.values()],
    freshness: { read_at: context.now().toISOString(), source: 'live', age_seconds: 0 },
  };
}
