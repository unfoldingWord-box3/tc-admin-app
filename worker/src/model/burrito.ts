// The Scripture Burrito writer (ADR 0008): the only module that writes
// project metadata (W1). Here, the metadata and files of a new Bible project,
// `scripture/textTranslation` (#29); the merge for a release snapshot is #35
// and an Open Bible Stories project is #82. Pure: no I/O, no Door43 shape.
// Every ingredient entry carries the size and md5 computed from the bytes
// that will be written (R10). What the schema requires is E37; the recorded
// schema is `fixtures/scripture-burrito/2026-10-05/` (E44), and the test in
// `worker/test/model/burrito.test.ts` validates the output against it.

import { BIBLE_BOOKS, NEW_TESTAMENT, OLD_TESTAMENT } from './books';
import { CC_BY_SA_4_0_TEXT } from './license-cc-by-sa-4.0';
import { md5 } from './md5';

/**
 * The `dcs` id authority every project tC Admin writes declares, as Door43's own
 * converter writes it (`go-rc2sb`, E17): without a trailing slash. translationCore 4
 * writes `https://git.door43.org/`; the two spellings are settled here (E24, #29).
 * The id names the authority, not the host, so it is the same on QA and production.
 */
export const DCS_AUTHORITY = { id: 'https://git.door43.org', name: { en: 'Door43 Content Service' } } as const;

export const METADATA_PATH = 'metadata.json';
export const LICENSE_PATH = 'ingredients/license.md';
export const README_PATH = 'README.md';

/** The license texts by the wizard's identifier (Q20: CC BY-SA 4.0 only in Milestone 1). */
export const LICENSE_TEXTS: Readonly<Record<'cc-by-sa-4.0', string>> = { 'cc-by-sa-4.0': CC_BY_SA_4_0_TEXT };

export type TestamentScope = 'nt' | 'ot' | 'full';

/** What a new Bible project is made from: the wizard's inputs plus the owner and repository name. */
export interface NewBibleProject {
  owner: string;
  repo_name: string;
  title: string;
  abbreviation: string;
  language: { code: string; title: string; direction?: 'ltr' | 'rtl' | null | undefined };
  testament_scope: TestamentScope;
  license: 'cc-by-sa-4.0';
}

/** Who generated the metadata: tC Admin, with its version, as the signed-in manager (`meta.generator`). */
export interface Generator {
  name: string;
  version: string;
  user: { login: string; name: string };
}

/** A file the first commit writes, with the size and md5 of its bytes (R10). */
export interface ProjectFile {
  path: string;
  content: string;
  bytes: Uint8Array;
  size: number;
  md5: string;
}

const BOOKS_BY_SCOPE: Readonly<Record<TestamentScope, readonly string[]>> = { nt: NEW_TESTAMENT, ot: OLD_TESTAMENT, full: BIBLE_BOOKS };

/** The repository name: `<language>_<abbreviation>` in lowercase, as in `en_ult` (product spec §6). */
export function repositoryName(languageCode: string, abbreviation: string): string {
  return `${languageCode.trim().toLowerCase()}_${abbreviation.trim().toLowerCase()}`;
}

/** Door43 accepts letters, digits, `.`, `-`, and `_`, not starting with a dot and not a git suffix. */
export function validRepositoryName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) && !/\.(git|wiki)$/i.test(name) && name !== '..';
}

/** `currentScope` for a testament scope: every book of the scope, in canonical order, with no chapter restriction (product spec §6). */
export function currentScope(scope: TestamentScope): Record<string, []> {
  return Object.fromEntries(BOOKS_BY_SCOPE[scope].map(book => [book.toUpperCase(), []]));
}

export function projectFile(path: string, content: string): ProjectFile {
  const bytes = new TextEncoder().encode(content);
  return { path, content, bytes, size: bytes.length, md5: md5(bytes) };
}

/** The repository's README: the project in glossary words; not an ingredient. */
export function readme(project: NewBibleProject): string {
  return `# ${project.title}\n\n${project.abbreviation} · ${project.language.title} (${project.language.code}) · Bible\n\nA Scripture Burrito project created with tC Admin. Its books are listed in \`${METADATA_PATH}\` and kept in \`ingredients/\`.\n`;
}

/**
 * The `metadata.json` of a new Bible project (E37): tC Admin as generator,
 * the flavor `scripture/textTranslation`, `currentScope` from the testament
 * scope, the license as the one ingredient, and no `relationships` until an
 * import adds one (E24). The flavor's `projectType`, `translationType`, and
 * `audience` are the schema's required fields the wizard does not ask for;
 * their values are the defaults recorded in Q4 and editable in Milestone 2.
 */
export function newBibleMetadata(project: NewBibleProject, generator: Generator, now: Date, license: ProjectFile): Record<string, unknown> {
  const timestamp = now.toISOString();
  const language: Record<string, unknown> = { tag: project.language.code, name: { en: project.language.title } };
  if (project.language.direction) language.scriptDirection = project.language.direction;
  return {
    format: 'scripture burrito',
    meta: {
      version: '1.0.0',
      category: 'source',
      generator: {
        softwareName: generator.name,
        softwareVersion: generator.version,
        userId: `dcs::${generator.user.login}`,
        userName: generator.user.name,
      },
      defaultLocale: 'en',
      dateCreated: timestamp,
      normalization: 'NFC',
    },
    idAuthorities: { dcs: DCS_AUTHORITY },
    identification: {
      name: { en: project.title },
      abbreviation: { en: project.abbreviation },
      primary: { dcs: { [`${project.owner}/${project.repo_name}`]: { revision: 'master', timestamp } } },
    },
    confidential: false,
    languages: [language],
    type: {
      flavorType: {
        name: 'scripture',
        flavor: { name: 'textTranslation', projectType: 'standard', translationType: 'firstTranslation', audience: 'common', usfmVersion: '3.0' },
        currentScope: currentScope(project.testament_scope),
      },
    },
    copyright: { licenses: [{ ingredient: license.path }] },
    ingredients: {
      [license.path]: { checksum: { md5: license.md5 }, mimeType: 'text/markdown', size: license.size, role: 'x-license' },
    },
  };
}

/** The files of a new Bible project's first commit, in the order they are listed: the metadata, the license ingredient, the README (W5). */
export function newBibleProjectFiles(project: NewBibleProject, generator: Generator, now: Date): { metadata: Record<string, unknown>; files: ProjectFile[] } {
  const license = projectFile(LICENSE_PATH, LICENSE_TEXTS[project.license]);
  const metadata = newBibleMetadata(project, generator, now, license);
  return {
    metadata,
    files: [projectFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`), license, projectFile(README_PATH, readme(project))],
  };
}
