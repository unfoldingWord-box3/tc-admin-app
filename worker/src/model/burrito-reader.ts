// The Scripture Burrito reader (#17, ADR 0008): a project's `metadata.json`
// as tC Admin reads it, whichever tool wrote it, Scribe (E17), Door43's
// converter (E2), or tC Admin itself. It reads the identification, languages,
// type with flavor and scope, and every ingredient with the size and checksum
// as written, which may be stale (E5): a release recomputes both from the
// bytes and never trusts these (R10). Each ingredient is classified: a book
// carries a scope naming one book; a story is `ingredients/content/<NN>.md`,
// whose scope names the passages the story draws on, not the story (E36); an
// administrative ingredient, such as a license or versification file, has no
// scope. The document itself is kept, for the fields a release merge carries
// whole (#35, Q8). Pure: no I/O, no Door43 shape.

import type { ProjectType } from '@tc-admin/shared/schema';
import { bookId, storyId } from './books';
import { projectTypeFromFlavor } from './project';

export type LocalizedText = Readonly<Record<string, string>>;
export type Scope = Readonly<Record<string, readonly string[]>>;

export type IngredientKind = 'book' | 'story' | 'administrative' | 'other';

export interface MetadataIngredient {
  path: string;
  /** As written; possibly stale (E5), never used in place of a recomputation (R10). */
  size: number | null;
  md5: string | null;
  mime_type: string | null;
  role: string | null;
  scope: Scope | null;
  kind: IngredientKind;
  /** The book or story id of a book or story ingredient; `null` otherwise. */
  unit: string | null;
}

export interface ProjectMetadata {
  format: string;
  flavor_type: string;
  flavor: string;
  project_type: ProjectType;
  generator: { name: string; version: string } | null;
  identification: {
    name: LocalizedText;
    abbreviation: LocalizedText;
    description: LocalizedText;
    /** The one primary id: its authority, id, and revision (`identification.primary` holds exactly one authority, E44). */
    primary: { authority: string; id: string; revision: string | null; timestamp: string | null } | null;
  };
  languages: { tag: string; name: LocalizedText; direction: 'ltr' | 'rtl' | null }[];
  /** `type.flavorType.currentScope` as written: book codes, uppercase, to chapter or verse ranges. */
  current_scope: Scope;
  ingredients: MetadataIngredient[];
  /** The document as parsed, whole: what a release merge keeps from the default branch (Q8) and what the reader does not model. */
  document: Readonly<Record<string, unknown>>;
}

/** A document that is not Scripture Burrito as tC Admin needs it; the operation that read it says what that means (X2). */
export class MetadataError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`metadata.json: ${reason}`);
    this.name = 'MetadataError';
    this.reason = reason;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const localized = (value: unknown): LocalizedText => (isRecord(value) ? Object.fromEntries(Object.entries(value).flatMap(([key, v]) => (typeof v === 'string' ? [[key, v]] : []))) : {});

function scopeOf(value: unknown): Scope | null {
  if (!isRecord(value)) return null;
  return Object.fromEntries(Object.entries(value).map(([book, ranges]) => [book, Array.isArray(ranges) ? ranges.filter((range): range is string => typeof range === 'string') : []]));
}

/** The story a path under `ingredients/content/` names (E36): `01.md` or `1.md` for story 1. */
const STORY_PATH = /^ingredients\/content\/(\d{1,2})\.md$/;

/**
 * What an ingredient is (CONTEXT.md "Ingredient"): in a Bible, a book when its scope
 * names exactly one book; in Open Bible Stories, a story when its path is a numbered
 * story file, whatever its scope says; administrative when it has no scope; `other`
 * when it has a scope that names no one book, such as a whole-Bible file.
 */
export function classifyIngredient(path: string, scope: Scope | null, projectType: ProjectType): { kind: IngredientKind; unit: string | null } {
  if (projectType === 'obs') {
    const match = STORY_PATH.exec(path);
    const story = match ? storyId(match[1]!.padStart(2, '0')) : null;
    if (story) return { kind: 'story', unit: story };
  }
  if (scope === null) return { kind: 'administrative', unit: null };
  const books = Object.keys(scope);
  const book = books.length === 1 ? bookId(books[0]!) : null;
  if (projectType === 'bible' && book) return { kind: 'book', unit: book };
  if (projectType === 'obs') return { kind: 'administrative', unit: null };
  return { kind: 'other', unit: null };
}

/** The metadata from its parsed document. Throws `MetadataError` when the document is not a Scripture Burrito tC Admin can read. */
export function readMetadata(document: unknown): ProjectMetadata {
  if (!isRecord(document)) throw new MetadataError('not a JSON object');
  if (document.format !== 'scripture burrito') throw new MetadataError(`format is ${JSON.stringify(document.format)}, not "scripture burrito"`);
  const type = isRecord(document.type) && isRecord(document.type.flavorType) ? document.type.flavorType : null;
  const flavorType = text(type?.name);
  const flavor = isRecord(type?.flavor) ? text(type.flavor.name) : null;
  if (!flavorType || !flavor) throw new MetadataError('no type.flavorType.name or flavor.name');
  if (!isRecord(document.ingredients)) throw new MetadataError('no ingredients');
  const project_type = projectTypeFromFlavor(flavor);

  const identification = isRecord(document.identification) ? document.identification : {};
  let primary: ProjectMetadata['identification']['primary'] = null;
  if (isRecord(identification.primary)) {
    const [authority, ids] = Object.entries(identification.primary)[0] ?? [];
    const [id, detail] = isRecord(ids) ? (Object.entries(ids)[0] ?? []) : [];
    if (authority && id) primary = { authority, id, revision: text(isRecord(detail) ? detail.revision : null), timestamp: text(isRecord(detail) ? detail.timestamp : null) };
  }

  const meta = isRecord(document.meta) ? document.meta : {};
  const generator = isRecord(meta.generator) && text(meta.generator.softwareName) ? { name: text(meta.generator.softwareName)!, version: text(meta.generator.softwareVersion) ?? '' } : null;

  const languages = (Array.isArray(document.languages) ? document.languages : []).flatMap(language => {
    if (!isRecord(language) || !text(language.tag)) return [];
    const direction: 'ltr' | 'rtl' | null = language.scriptDirection === 'ltr' ? 'ltr' : language.scriptDirection === 'rtl' ? 'rtl' : null;
    return [{ tag: text(language.tag)!, name: localized(language.name), direction }];
  });

  const ingredients = Object.entries(document.ingredients).flatMap(([path, entry]): MetadataIngredient[] => {
    if (!isRecord(entry)) return [];
    const scope = scopeOf(entry.scope);
    const checksum = isRecord(entry.checksum) ? entry.checksum : {};
    return [
      {
        path,
        size: typeof entry.size === 'number' && Number.isInteger(entry.size) && entry.size >= 0 ? entry.size : null,
        md5: text(checksum.md5),
        mime_type: text(entry.mimeType),
        role: text(entry.role),
        scope,
        ...classifyIngredient(path, scope, project_type),
      },
    ];
  });

  return {
    format: 'scripture burrito',
    flavor_type: flavorType,
    flavor,
    project_type,
    generator,
    identification: { name: localized(identification.name), abbreviation: localized(identification.abbreviation), description: localized(identification.description), primary },
    languages,
    current_scope: scopeOf(type?.currentScope) ?? {},
    ingredients,
    document,
  };
}

/** The metadata from the file's bytes or text. Throws `MetadataError` for text that is not JSON. */
export function parseMetadata(file: Uint8Array | string): ProjectMetadata {
  const source = typeof file === 'string' ? file : new TextDecoder().decode(file);
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch (cause) {
    throw new MetadataError(`not JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return readMetadata(document);
}

/** The book or story ingredients by unit id, each once (the first listed wins). */
export function unitIngredients(metadata: ProjectMetadata): Map<string, MetadataIngredient> {
  const units = new Map<string, MetadataIngredient>();
  for (const ingredient of metadata.ingredients) {
    if (ingredient.unit !== null && !units.has(ingredient.unit)) units.set(ingredient.unit, ingredient);
  }
  return units;
}

/** The administrative ingredients, in the order listed (R1: always carried forward). */
export const administrativeIngredients = (metadata: ProjectMetadata): MetadataIngredient[] => metadata.ingredients.filter(ingredient => ingredient.kind === 'administrative');
