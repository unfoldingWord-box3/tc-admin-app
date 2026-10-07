// Unknown and administrative files (#20, product spec §8, domain model §4):
// what each file of a ref is, given the ref's Scripture Burrito metadata and
// its tree. A book or story is an ingredient with that unit (the reader
// classifies entries); an administrative file is an ingredient listed without
// a scope, a root file, or a `.gitea/` file, all always carried from the
// default branch (R1, Q22); the metadata file itself is rewritten by every
// release; everything else on disk is unknown, listed for the manager and
// included only after explicit confirmation (S5). Door43 checks that listed
// ingredients exist, not the reverse, so this is tC Admin's rule. Pure.

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
  /** Whether the metadata lists the file; a listed file with no unit is administrative, an unlisted root or `.gitea/` file is too. */
  listed: boolean;
}

export interface Classification {
  files: ClassifiedFile[];
  /** The books or stories on disk, by unit id. */
  units: Map<string, ClassifiedFile>;
  /** Paths always carried from the default branch (R1). */
  administrative: string[];
  /** Paths on disk that are neither a unit nor listed nor a root or `.gitea/` file: included only after explicit confirmation. */
  unknown: string[];
  /** Ingredients the metadata lists that are not on disk: what Door43's health check reports as missing. */
  missing: string[];
}

export const METADATA_FILE = 'metadata.json';

/** A root file (no directory) or a `.gitea/` workflow file: carried with every release, whatever the metadata says (Q22). */
export const isRootOrWorkflow = (path: string) => !path.includes('/') || path.startsWith('.gitea/');

/** What one path is, given the metadata. */
export function roleOf(path: string, metadata: ProjectMetadata): Pick<ClassifiedFile, 'role' | 'unit' | 'listed'> {
  if (path === METADATA_FILE) return { role: 'metadata', unit: null, listed: false };
  const ingredient = metadata.ingredients.find(entry => entry.path === path);
  if (ingredient?.kind === 'book' || ingredient?.kind === 'story') return { role: ingredient.kind, unit: ingredient.unit, listed: true };
  if (ingredient) return { role: 'administrative', unit: null, listed: true };
  if (isRootOrWorkflow(path)) return { role: 'administrative', unit: null, listed: false };
  return { role: 'unknown', unit: null, listed: false };
}

/** Every file of the ref classified, with the units, the administrative and unknown paths, and the listed ingredients that are not there. */
export function classifyFiles(metadata: ProjectMetadata, paths: readonly RefPath[]): Classification {
  const files = paths.map(({ path }): ClassifiedFile => ({ path, ...roleOf(path, metadata) }));
  const units = new Map<string, ClassifiedFile>();
  for (const file of files) if (file.unit !== null && !units.has(file.unit)) units.set(file.unit, file);
  const onDisk = new Set(files.map(file => file.path));
  return {
    files,
    units,
    administrative: files.filter(file => file.role === 'administrative').map(file => file.path).sort(),
    unknown: files.filter(file => file.role === 'unknown').map(file => file.path).sort(),
    missing: metadata.ingredients.filter(ingredient => !onDisk.has(ingredient.path)).map(ingredient => ingredient.path).sort(),
  };
}
