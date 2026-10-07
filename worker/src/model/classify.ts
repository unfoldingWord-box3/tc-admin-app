// Unknown and administrative files (#20, product spec §8, domain model §4):
// what each file of a ref is, given the ref's Scripture Burrito metadata and
// its tree. A book or story is an ingredient with that unit (the reader
// classifies entries); an administrative file is an ingredient listed without
// a scope, a root file, or a `.gitea/` file, all always carried from the
// default branch (R1, Q22); the metadata file itself is rewritten by every
// release; everything else on disk is unknown, listed for the manager and
// included only after explicit confirmation (S5). Door43 checks that listed
// ingredients exist, not the reverse, so this is tC Admin's rule. Pure.

import { MetadataError } from './burrito-reader';
import type { ProjectMetadata } from './burrito-reader';

/** A file of a ref, as its git tree lists it (E19) or its archive holds it. */
export interface RefPath {
  path: string;
}

export type FileRole = 'metadata' | 'book' | 'story' | 'administrative' | 'unknown';

export interface ClassifiedFile {
  path: string;
  role: FileRole;
  /** The book or story id, for a book or story. */
  unit: string | null;
  /** Whether the metadata lists the file. A listed file without a scope is administrative, a listed one whose scope names no one book is unknown, and an unlisted root or `.gitea/` file is administrative. */
  listed: boolean;
}

export interface Classification {
  files: ClassifiedFile[];
  /** The books or stories on disk, by unit id. */
  units: Map<string, ClassifiedFile>;
  /** Paths always carried from the default branch (R1). */
  administrative: string[];
  /** Paths on disk that are neither a unit nor administrative (a listed `other` ingredient is unknown): included only after explicit confirmation. */
  unknown: string[];
  /** Ingredients the metadata lists that are not on disk: what Door43's health check reports as missing. */
  missing: string[];
}

export const METADATA_FILE = 'metadata.json';

/** No backslash, NUL, or leading slash, and no empty, `.` or `..` segment: a path that names one file inside the ref. */
export const wellFormed = (path: string) => !path.includes('\\') && !path.includes('\0') && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');

/** A root file (no directory) or a `.gitea/` workflow file: carried with every release, whatever the metadata says (Q22). A malformed path is neither. */
export const isRootOrWorkflow = (path: string) => wellFormed(path) && (!path.includes('/') || path.startsWith('.gitea/'));

/** What one path is, given the metadata. A path that cannot name one file inside the ref is unknown whatever the metadata says, so it is never carried and never a unit. */
export function roleOf(path: string, metadata: ProjectMetadata): Pick<ClassifiedFile, 'role' | 'unit' | 'listed'> {
  if (path === METADATA_FILE) return { role: 'metadata', unit: null, listed: false };
  if (!wellFormed(path)) return { role: 'unknown', unit: null, listed: false };
  const ingredient = metadata.ingredients.find(entry => entry.path === path);
  if (ingredient?.kind === 'book' || ingredient?.kind === 'story') return { role: ingredient.kind, unit: ingredient.unit, listed: true };
  // A listed ingredient with a scope that names no one book (`other`) is not administrative: it is unknown (S5).
  if (ingredient) return { role: ingredient.kind === 'administrative' ? 'administrative' : 'unknown', unit: null, listed: true };
  if (isRootOrWorkflow(path)) return { role: 'administrative', unit: null, listed: false };
  return { role: 'unknown', unit: null, listed: false };
}

/**
 * Every file of the ref classified, with the units, the administrative and unknown
 * paths, and the listed ingredients that are not there. Metadata that lists a path
 * that cannot name one file inside the ref is refused here, the first place that
 * reads ingredient paths, before any caller can open or write one (bench rounds 2
 * and 3 of #99, deferred from #97).
 */
export function classifyFiles(metadata: ProjectMetadata, paths: readonly RefPath[]): Classification {
  const malformed = metadata.ingredients.find(ingredient => !wellFormed(ingredient.path));
  if (malformed) throw new MetadataError(`the metadata lists ${JSON.stringify(malformed.path)}, which cannot name one file inside the project`);
  const files = paths.map(({ path }): ClassifiedFile => ({ path, ...roleOf(path, metadata) }));
  const units = new Map<string, ClassifiedFile>();
  // A unit is held by at most one on-disk file: a second is refused here, never kept first-wins or dropped unreported (bench round 2).
  for (const file of files) {
    if (file.unit === null) continue;
    const held = units.get(file.unit);
    if (held) throw new MetadataError(`${file.unit} is held by two files, ${held.path} and ${file.path}`);
    units.set(file.unit, file);
  }
  const onDisk = new Set(files.map(file => file.path));
  return {
    files,
    units,
    administrative: files.filter(file => file.role === 'administrative').map(file => file.path).sort(),
    unknown: files.filter(file => file.role === 'unknown').map(file => file.path).sort(),
    missing: metadata.ingredients.filter(ingredient => !onDisk.has(ingredient.path)).map(ingredient => ingredient.path).sort(),
  };
}
