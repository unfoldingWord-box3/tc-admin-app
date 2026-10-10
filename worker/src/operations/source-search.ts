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
//
// The search at `latest` can answer an entry other than the default branch's,
// such as a release newer than the branch's last commit (#163). For such a
// source the branch's own catalog entry is read (E20); when it describes the
// head, its books are offered. A few such reads run at a time; a branch with no
// entry, one for another commit, or a read that fails offers none, as before,
// and only an expired session stops the search.

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readCatalogEntry } from '../door43/catalog';
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
  // The repository's own default branch and its head (#170): with neither known, the repository is not offered at its latest
  // content, never at the branch a catalog entry names instead (H3).
  const head = entry.refs.default_branch;
  if (!head) return null;
  return { revision: { branch: head.name, sha: head.sha }, itemized: entry.revision?.sha === head.sha };
}

/** A source, and, when its books are not itemized because the entry describes another commit than the branch head, that head to read (#163). */
function source(entry: CatalogSearchEntry, stage: ParsedInput<'source.search'>['stage']): { found: Source; stale: { branch: string; sha: string } | null } | null {
  const project_type = projectTypeFromFlavor(entry.catalog.flavor);
  if (project_type === 'other') return null;
  const offered = revisionOf(entry, stage);
  if (!offered) return null;
  const stale = stage === 'latest' && !offered.itemized && 'branch' in offered.revision ? { branch: offered.revision.branch, sha: offered.revision.sha } : null;
  const found: Source = {
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
  return { found, stale };
}

/** How many branch entries are read at once for sources whose search entry is another commit's (#163). */
const ENTRY_READS = 4;

/** The books of a branch's own catalog entry, when it describes the head; `null` otherwise, or when it cannot be read (H3). */
async function headBooks(context: OperationContext, found: Source, head: { branch: string; sha: string }): Promise<Source['books']> {
  try {
    const entry = await readCatalogEntry(signedIn(context), found.ref.owner, found.ref.repo, head.branch);
    return entry.sha === head.sha ? offeredUnits(entry.catalog, found.project_type) : null;
  } catch (error) {
    if (error instanceof CatalogError && error.code === 'session_expired') throw error;
    return null;
  }
}

export async function sourceSearch(input: ParsedInput<'source.search'>, context: OperationContext): Promise<SourceSearch> {
  const client = signedIn(context);
  const owner = input.owner.trim();
  if (!owner) throw new CatalogError('validation_failed', { message: 'owner: an owner is required', details: { fields: [{ path: 'owner', message: 'an owner is required' }] } });
  const entries = await searchCatalog(client, owner, input.stage);
  // One source per repository, in Door43's order (E35 never listed one twice; the first entry is kept if it ever does).
  const sources = new Map<string, Source>();
  const stale: { key: string; head: { branch: string; sha: string } }[] = [];
  for (const entry of entries) {
    const result = source(entry, input.stage);
    if (!result) continue;
    const key = `${result.found.ref.owner}/${result.found.ref.repo}`.toLowerCase();
    if (sources.has(key)) continue;
    sources.set(key, result.found);
    if (result.stale) stale.push({ key, head: result.stale });
  }
  // The branch's own entry for each source whose search entry is another commit's, a few at a time (#163).
  for (let start = 0; start < stale.length; start += ENTRY_READS) {
    await Promise.all(
      stale.slice(start, start + ENTRY_READS).map(async ({ key, head }) => {
        const found = sources.get(key)!;
        const books = await headBooks(context, found, head);
        if (books) sources.set(key, { ...found, books });
      }),
    );
  }
  return {
    sources: [...sources.values()],
    freshness: { read_at: context.now().toISOString(), source: 'live', age_seconds: 0 },
  };
}
