// Door43's language lists (E25): the full list, `GET /languages/langnames.json`,
// and the languages an owner has repositories in, `GET /catalog/list/languages`,
// both in the same entry shape, mapped to glossary names here. Door43's field
// names stop in this module.

import { readDoor43 } from './api';
import type { Door43Client } from './api';

/** One entry of either list (E25). Only the fields tC Admin reads; each is checked, since the list is data, not a contract. */
interface Door43Language {
  /** The tag, `id`, `es-419`, `el-x-koine`. */
  lc?: unknown;
  /** The native name. */
  ln?: unknown;
  /** The English name; empty for a few hundred entries. */
  ang?: unknown;
  /** The script direction, `ltr` or `rtl`. */
  ld?: unknown;
  /** Alternate names. */
  alt?: unknown;
}

/** A language as the wizard offers it, in glossary spelling. */
export interface Language {
  code: string;
  title: string;
  english: string;
  direction: 'ltr' | 'rtl' | null;
  alternates: string[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The entry in glossary spelling, or `null` when it has no tag or no native name and so cannot be offered. */
export function languageEntry(entry: Door43Language): Language | null {
  const code = text(entry.lc);
  const title = text(entry.ln);
  if (!code || !title) return null;
  return {
    code,
    title,
    english: text(entry.ang),
    direction: entry.ld === 'ltr' || entry.ld === 'rtl' ? entry.ld : null,
    alternates: Array.isArray(entry.alt) ? entry.alt.map(text).filter(Boolean) : [],
  };
}

/** Every language Door43 lists (`GET /languages/langnames.json`, E25), in Door43's order. */
export async function readLanguages(client: Door43Client): Promise<Language[]> {
  const list = await readDoor43<unknown>(client, '/languages/langnames.json');
  if (!Array.isArray(list)) return [];
  return list.flatMap(entry => (entry && typeof entry === 'object' ? (languageEntry(entry as Door43Language) ?? []) : []));
}

/**
 * The tags of the languages an owner has repositories in on their default branches
 * (`GET /catalog/list/languages?owner=&stage=latest`, E25). An owner Door43 does not
 * know answers `data: null`, which is no languages.
 */
export async function readOwnerLanguageCodes(client: Door43Client, owner: string): Promise<string[]> {
  const body = await readDoor43<{ data?: unknown }>(client, '/catalog/list/languages', { owner, stage: 'latest' });
  if (!Array.isArray(body?.data)) return [];
  return body.data.flatMap(entry => (entry && typeof entry === 'object' ? (languageEntry(entry as Door43Language)?.code ?? []) : []));
}
