// Candidate detection for a release (#33, domain model §4): every book of a
// Bible project on the default branch or in the latest full release, grouped
// by comparing the blob SHAs of the two refs' files (E18, E19), each with the
// selection state the plan starts it in (R4): on a first release every book
// is included; on a later release every released book is carried forward,
// changed or not, and every new book is left out, so nothing new or changed
// is published unless the manager includes it. An Open Bible Stories release
// is the whole default branch, so every story present is included and a
// story the release had but the branch no longer has is a removal, listed
// (R2). Pure: no I/O, no Door43 shape; the adapters produce the inputs.

import type { CandidateGroup, ProjectType, SelectionState } from '@tc-admin/shared/schema';
import { BIBLE_BOOKS, STORIES, bookId, storyId } from './books';
import type { CatalogIngredient } from './project';

/** A file of a ref as its git tree lists it (E19). */
export interface RefFile {
  path: string;
  sha: string;
}

/** What is known of one ref: the catalog's ingredients (E20), which name a Bible's books and their paths, and the tree's files. */
export interface RefContent {
  ingredients: readonly CatalogIngredient[] | null;
  files: readonly RefFile[];
}

/** A book or story on one ref: its path there and its blob SHA; `sha` is `null` when the catalog lists it but the tree has no file at its path. */
export interface UnitFile {
  id: string;
  path: string;
  title: string;
  sha: string | null;
}

export interface Candidate {
  id: string;
  group: CandidateGroup;
  selection: SelectionState;
  /** The unit on the default branch, or `null` when it is only in the release. */
  default_branch: UnitFile | null;
  /** The unit in the latest full release, or `null` when it is new, or there is no release. */
  baseline: UnitFile | null;
}

export interface Candidates {
  books: Candidate[];
  /** Books in the latest full release that this selection leaves out (R2). */
  removals: string[];
  /** Root files and `.gitea/` files of the default branch, always carried (R1); administrative ingredients join with #20. */
  administrative: string[];
}

export type ReleasableType = Exclude<ProjectType, 'other'>;

/** A catalog path, `./ingredients/MAT.usfm`, as the tree spells it. */
const treePath = (path: string) => path.replace(/^\.\//, '');

/** The story a path under `ingredients/content/` names (E36): `01.md` or `1.md` for story 1. */
const STORY_PATH = /^ingredients\/content\/(\d{1,2})\.md$/;

/**
 * The books of a ref, from the catalog's ingredients, which name each book and
 * its path (E20), with the blob SHA the tree gives that path. The stories of an
 * Open Bible Stories ref come from the tree alone, since Door43 lists only the
 * `content` container for one (E35, E47; the path rule is E36).
 */
export function unitFiles(type: ReleasableType, content: RefContent): UnitFile[] {
  const shaOf = new Map(content.files.map(file => [file.path, file.sha]));
  if (type === 'obs') {
    return content.files.flatMap(file => {
      const match = STORY_PATH.exec(file.path);
      const id = match ? storyId(match[1]!.padStart(2, '0')) : null;
      return id ? [{ id, path: file.path, title: '', sha: file.sha }] : [];
    });
  }
  const seen = new Set<string>();
  return (content.ingredients ?? []).flatMap(ingredient => {
    const id = bookId(ingredient.id);
    if (!id || ingredient.is_dir || seen.has(id)) return [];
    seen.add(id);
    const path = treePath(ingredient.path);
    return [{ id, path, title: ingredient.title ?? '', sha: shaOf.get(path) ?? null }];
  });
}

const ORDER: Readonly<Record<ReleasableType, readonly string[]>> = { bible: BIBLE_BOOKS, obs: STORIES };
const byCanonicalOrder = (type: ReleasableType) => {
  const index = new Map(ORDER[type].map((id, i) => [id, i]));
  return (a: Candidate, b: Candidate) => (index.get(a.id) ?? Infinity) - (index.get(b.id) ?? Infinity) || a.id.localeCompare(b.id);
};

/** The group a unit falls in from what each ref has of it (domain model §4). */
export function groupOf(onBranch: UnitFile | null, inBaseline: UnitFile | null): CandidateGroup {
  if ((onBranch && onBranch.sha === null) || (inBaseline && inBaseline.sha === null)) return 'unknown';
  if (!inBaseline) return 'new';
  if (!onBranch) return 'unchanged';
  return onBranch.sha === inBaseline.sha ? 'unchanged' : 'changed_released';
}

/**
 * The selection a plan starts a unit in (R4, Q24). A Bible: everything included
 * on a first release; afterwards every released book carried forward and every
 * new one left out. Open Bible Stories: the whole default branch is included,
 * and a story no longer on it cannot be, so it is left out and listed as removed.
 */
export function defaultSelection(type: ReleasableType, candidate: Pick<Candidate, 'default_branch' | 'baseline'>, firstRelease: boolean): SelectionState {
  if (type === 'obs') return candidate.default_branch ? 'include' : 'leave_out';
  if (firstRelease) return 'include';
  return candidate.baseline ? 'carry_forward' : 'leave_out';
}

/** The files always carried from the default branch (R1): the root files, except the metadata the release rewrites, and `.gitea/` (Q22). */
export function administrativeFiles(files: readonly RefFile[]): string[] {
  return files
    .map(file => file.path)
    .filter(path => (!path.includes('/') && path !== 'metadata.json') || path.startsWith('.gitea/'))
    .sort();
}

/** The candidates of a release: every unit on the default branch or in the baseline, grouped, with the plan's default selection. */
export function detectCandidates(type: ReleasableType, defaultBranch: RefContent, baseline: RefContent | null): Candidates {
  const onBranch = new Map(unitFiles(type, defaultBranch).map(unit => [unit.id, unit]));
  const released = new Map(baseline ? unitFiles(type, baseline).map(unit => [unit.id, unit]) : []);
  const firstRelease = baseline === null;
  const books = [...new Set([...onBranch.keys(), ...released.keys()])]
    .map((id): Candidate => {
      const candidate = { id, default_branch: onBranch.get(id) ?? null, baseline: released.get(id) ?? null };
      return { ...candidate, group: groupOf(candidate.default_branch, candidate.baseline), selection: defaultSelection(type, candidate, firstRelease) };
    })
    .sort(byCanonicalOrder(type));
  return { books, removals: removals(books), administrative: administrativeFiles(defaultBranch.files) };
}

/** The released units a selection leaves out, in order (R2): what the plan lists and the notes name. */
export function removals(books: readonly Candidate[]): string[] {
  return books.filter(book => book.baseline && book.selection === 'leave_out').map(book => book.id);
}
