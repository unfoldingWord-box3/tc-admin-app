// The Scripture Burrito writer (ADR 0008): the only module that writes
// project metadata (W1). Here, the metadata and files of a new project, a
// Bible (`scripture/textTranslation`, #29) or Open Bible Stories
// (`gloss/textStories`, #82); the merge for a release snapshot is #35. Pure:
// no I/O, no Door43 shape. Every ingredient entry carries the size and md5
// computed from the bytes that will be written (R10). What the schema
// requires is E37; the recorded schema is `fixtures/scripture-burrito/2026-10-05/`
// (E44), and the test in `worker/test/model/burrito.test.ts` validates the
// output against it.

import type { ProjectType } from '@tc-admin/shared/schema';
import { BIBLE_BOOKS, NEW_TESTAMENT, OLD_TESTAMENT } from './books';
import { CC_BY_SA_4_0_TEXT } from './license-cc-by-sa-4.0';
import { md5 } from './md5';
import { OBS_SCOPE } from './obs-scope';

/**
 * The `dcs` id authority every project tC Admin writes declares, as Door43's own
 * converter writes it (`go-rc2sb`, E17, E46): without a trailing slash, settled by #29
 * and confirmed by Rich (E24). The id names the authority, not the host, so it is the
 * same on QA and production.
 */
export const DCS_AUTHORITY = { id: 'https://git.door43.org', name: { en: 'Door43 Content Service' } } as const;

export const METADATA_PATH = 'metadata.json';
export const LICENSE_PATH = 'ingredients/license.md';
export const README_PATH = 'README.md';

/** The license texts by the wizard's identifier (Q20: CC BY-SA 4.0 only in Milestone 1). */
export const LICENSE_TEXTS: Readonly<Record<'cc-by-sa-4.0', string>> = { 'cc-by-sa-4.0': CC_BY_SA_4_0_TEXT };

export type TestamentScope = 'nt' | 'ot' | 'full';

/** The project types tC Admin creates: the two flavors translationCore 4 edits. */
export type CreatableProjectType = Exclude<ProjectType, 'other'>;

/** The flavor each project type is written as (CONTEXT.md "Project type"). */
export const FLAVOR_BY_TYPE: Readonly<Record<CreatableProjectType, { flavorType: 'scripture' | 'gloss'; flavor: 'textTranslation' | 'textStories' }>> = {
  bible: { flavorType: 'scripture', flavor: 'textTranslation' },
  obs: { flavorType: 'gloss', flavor: 'textStories' },
};

/** The glossary term for each project type, for the README. */
export const TYPE_TERM: Readonly<Record<CreatableProjectType, string>> = { bible: 'Bible', obs: 'Open Bible Stories' };

interface NewProjectBase {
  owner: string;
  repo_name: string;
  title: string;
  abbreviation: string;
  language: { code: string; title: string; direction?: 'ltr' | 'rtl' | null | undefined };
  license: 'cc-by-sa-4.0';
}

/** What a new project is made from: the wizard's inputs plus the owner and repository name. A Bible has a testament scope; Open Bible Stories has none (Q25). */
export type NewProject = NewProjectBase & ({ project_type: 'bible'; testament_scope: TestamentScope } | { project_type: 'obs'; testament_scope: null });

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

/** The `currentScope` a new project is written with: the testament scope for a Bible; for Open Bible Stories the fixed scope Door43 writes (E46, Q4). */
export function projectScope(project: NewProject): Record<string, readonly string[]> {
  return project.project_type === 'bible' ? currentScope(project.testament_scope) : OBS_SCOPE;
}

export function projectFile(path: string, content: string): ProjectFile {
  const bytes = new TextEncoder().encode(content);
  return { path, content, bytes, size: bytes.length, md5: md5(bytes) };
}

/** The repository's README: the project in glossary words; not an ingredient. */
export function readme(project: NewProject): string {
  const units = project.project_type === 'bible' ? 'books' : 'stories';
  return `# ${project.title}\n\n${project.abbreviation} · ${project.language.title} (${project.language.code}) · ${TYPE_TERM[project.project_type]}\n\nA Scripture Burrito project created with tC Admin. \`${METADATA_PATH}\` describes it and lists its files; its ${units} will live under \`ingredients/\` as they are added.\n`;
}

/** The `type` of the metadata: the flavor, and the scope (E37, E44). */
function projectTypeBlock(project: NewProject): Record<string, unknown> {
  const { flavorType } = FLAVOR_BY_TYPE[project.project_type];
  // The textTranslation flavor's required `projectType`, `translationType`, and `audience` are the defaults recorded in Q4; textStories takes only its name.
  const flavor =
    project.project_type === 'bible'
      ? { name: 'textTranslation', projectType: 'standard', translationType: 'firstTranslation', audience: 'common', usfmVersion: '3.0' }
      : { name: 'textStories' };
  return { flavorType: { name: flavorType, flavor, currentScope: projectScope(project) } };
}

/**
 * The `metadata.json` of a new project (E37): tC Admin as generator, the
 * flavor of the project type, the scope, the license as the one ingredient,
 * and no `relationships` until an import adds one (E24).
 */
export function newProjectMetadata(project: NewProject, generator: Generator, now: Date, license: ProjectFile): Record<string, unknown> {
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
    type: projectTypeBlock(project),
    copyright: { licenses: [{ ingredient: license.path }] },
    ingredients: {
      [license.path]: { checksum: { md5: license.md5 }, mimeType: 'text/markdown', size: license.size, role: 'x-license' },
    },
  };
}

/** The files of a new project's first commit, in the order they are listed: the metadata, the license ingredient, the README (W5). */
export function newProjectFiles(project: NewProject, generator: Generator, now: Date): { metadata: Record<string, unknown>; files: ProjectFile[] } {
  const license = projectFile(LICENSE_PATH, LICENSE_TEXTS[project.license]);
  const metadata = newProjectMetadata(project, generator, now, license);
  return {
    metadata,
    files: [projectFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`), license, projectFile(README_PATH, readme(project))],
  };
}
