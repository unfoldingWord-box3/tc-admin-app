// The import screen's test shapes (#81): owner and source searches, import
// plans and receipts, each parsed by the shared schema as the client parses
// them, with values from the recordings of E35, E62, and E69.
import { OPERATIONS, ProjectReport } from '@tc-admin/shared/schema';
import type { OperationDefinition, OperationOutput } from '@tc-admin/shared/schema';
import { freshness } from './mounted';

type ImportPlan = OperationOutput<'import.plan'>;
type ImportedFile = ImportPlan['preview']['files'][number];
type Source = OperationOutput<'source.search'>['sources'][number];

const parse = <Name extends 'owner.search' | 'source.search' | 'import.plan'>(name: Name, value: unknown): OperationOutput<Name> =>
  (OPERATIONS[name] as OperationDefinition).output!.parse(value) as OperationOutput<Name>;

export const ownersOf = (own: { login: string; name: string }[], matches: { login: string; name: string }[] = []) => parse('owner.search', { own, matches, freshness });

/** A source as `source.search` lists it: a Bible unless said, at its last release `1974` (`prod`) or its default branch (`latest`). */
export function sourceOf(
  owner: string,
  repo: string,
  options: { title?: string; type?: 'bible' | 'obs'; format?: 'sb' | 'rc' | 'ts' | 'tc'; stage?: 'prod' | 'latest'; released?: boolean; books?: { id: string; title: string }[] | null } = {},
): Source {
  const stage = options.stage ?? 'latest';
  return {
    ref: { owner, repo },
    title: options.title ?? `${owner}/${repo}`,
    language: { code: 'id', title: 'Bahasa Indonesia' },
    project_type: options.type ?? 'bible',
    metadata_format: options.format ?? 'rc',
    stage,
    revision: stage === 'prod' ? { tag: '1974', sha: '6'.repeat(40) } : { branch: 'master', sha: '6'.repeat(40) },
    released: options.released ?? true,
    books: options.books === undefined ? [{ id: 'gen', title: 'Kejadian' }, { id: 'exo', title: 'Keluaran' }, { id: 'mat', title: 'Matius' }] : options.books,
  };
}

export const sourcesOf = (sources: Source[]) => parse('source.search', { sources, freshness });

export const book = (id: string, overwrite = false, diff: string | null = null): ImportedFile => ({
  name: `ingredients/${id.toUpperCase()}.usfm`,
  identified: { book: id },
  path: `ingredients/${id.toUpperCase()}.usfm`,
  size: 1000,
  md5: `${id}-md5`,
  overwrite,
  diff,
});

/** A file's book code in capitals, for its entry's scope. */
const scopeOf = (file: ImportedFile): Record<string, []> => (file.identified && 'book' in file.identified ? { [file.identified.book.toUpperCase()]: [] } : {});

/** An import plan of these files from the source at the revision, with an entry for each and the one source relationship (E69). */
export function importPlanOf(id: string, files: readonly ImportedFile[], source = { owner: 'bahtraku', repo: 'id_tb1', revision: '1974' }, target = 'tc-admin-qa/id_tcai1633@master'): ImportPlan {
  return parse('import.plan', {
    id,
    operation: 'import.plan',
    created_at: '2026-10-08T10:00:00.000Z',
    expires_at: '2026-10-08T10:30:00.000Z',
    bound_to: { default_branch_sha: 'a'.repeat(40), release_tag: null, release_tag_sha: null },
    preview: {
      source: { ...source, sha: '6'.repeat(40) },
      files,
      metadata_diff: {
        ingredients: files.map(file => ({
          path: file.path,
          before: file.overwrite ? { checksum: { md5: 'f'.repeat(32) }, mimeType: 'text/x-usfm', size: 10, scope: scopeOf(file) } : null,
          after: { checksum: { md5: file.md5 }, mimeType: 'text/x-usfm', size: file.size, scope: scopeOf(file) },
        })),
        relationships: [{ id: `dcs::${source.owner}/${source.repo}`, relationType: 'source', flavor: 'textTranslation', revision: source.revision }],
      },
    },
    would_write: [{ kind: 'commit', target }],
    warnings: [],
  });
}

/** `import.apply`'s receipt: the project report after the commit. */
export const importReceiptOf = (planId: string, owner = 'tc-admin-qa', repo = 'id_tcai1633', present = 2) => ({
  operation: 'import.apply',
  request_id: 'r9',
  plan_id: planId,
  started_at: '2026-10-08T10:01:00.000Z',
  finished_at: '2026-10-08T10:01:02.000Z',
  wrote: [{ kind: 'commit', target: `${owner}/${repo}@master`, sha: 'a1c91812614d1a306f62fa88d395789afb322ff4' }],
  result: ProjectReport.parse({
    ref: { owner, repo, id: 1, url: `https://qa.door43.org/${owner}/${repo}` },
    title: 'tC Admin import probe',
    description: '',
    default_branch: 'master',
    language: { code: 'id', title: 'Bahasa Indonesia' },
    last_activity_at: '2026-10-08T10:01:01.000Z',
    project_type: 'bible',
    metadata_format: 'sb',
    editability: { state: 'editable', reason: 'A Scripture Burrito project.' },
    coverage: { present, target: 66, scope: 'full', basis: 'archive', units: [] },
    health: { state: 'never_checked', severity_raw: null, ref: null, checked_at: null, issue_count: null, issues: null, source: 'door43' },
    latest_full_release: null,
    default_branch_head: { sha: 'a1c91812614d1a306f62fa88d395789afb322ff4', committed_at: '2026-10-08T10:01:01.000Z' },
    active_preparation: null,
    setup: { state: 'complete', failed_step: null },
    permissions: { push: true, admin: true, checked_at: '2026-10-08T10:01:00.000Z' },
    freshness: { read_at: '2026-10-08T10:01:02.000Z', source: 'live', age_seconds: 0 },
  }),
  warnings: [],
});
