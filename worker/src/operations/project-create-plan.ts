// `project.create.plan` (operations.md §4): everything `project.create.apply`
// will write, computed and shown before anything is written (ADR 0011). The
// signed-in account is read live from Door43; the owner must be one of the
// account's organizations in which a team of the account may create
// repositories (`GET /user/teams`, E43; A2 fails closed), or the account
// itself; the repository name is derived from the language and the
// abbreviation and must be free in the owner (`name_taken`). The metadata and
// the files come from the model (W1, R10) and are stored with the plan in
// Workers KV for thirty minutes, so the apply writes exactly what was shown.
// Open Bible Stories projects are #82: the flavor's required `currentScope`
// cannot be empty (E44), and what a new one carries is open in Q4.

import { CatalogError } from '@tc-admin/shared/schema';
import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import type { Door43Client } from '../door43/api';
import { readAccount } from '../door43/auth';
import { creationRights, repositoryExists } from '../door43/repos';
import { newBibleProjectFiles, repositoryName, validRepositoryName } from '../model/burrito';
import type { NewBibleProject, ProjectFile } from '../model/burrito';
import type { OperationContext } from './context';
import { signedIn } from './context';
import { PLAN_SECONDS, newPlanId } from './plans';

export type ProjectCreatePlan = OperationOutput<'project.create.plan'>;

/** Who the repository is created under: an organization through `POST /orgs/{org}/repos`, or the account through `POST /user/repos` (E26). */
export interface PlannedOwner {
  login: string;
  kind: 'organization' | 'account';
}

/** What the apply needs from the plan: the owner, the name, and the exact files. The apply marks the plan once the repository exists (#31). */
export interface ProjectCreatePayload {
  owner: PlannedOwner;
  repo_name: string;
  project: NewBibleProject;
  files: { path: string; content: string }[];
  repository_created?: boolean;
}

const validation = (field: string, message: string) => new CatalogError('validation_failed', { message: `${field}: ${message}`, details: { fields: [{ path: field, message }] } });

/**
 * A BCP 47 tag as the Scripture Burrito schema accepts it: `languageTag` in
 * `common.schema.json` (E44), so a tag that passes here validates in
 * `metadata.json` (W1). Door43's list spells them `id`, `es-419`, `el-x-koine` (E25).
 */
const LANGUAGE_TAG =
  /^(((en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|(art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|zh-min|zh-min-nan|zh-xiang))|((([A-Za-z]{2,3}(-([A-Za-z]{3}(-[A-Za-z]{3}){0,2}))?)|[A-Za-z]{4}|[A-Za-z]{5,8})(-([A-Za-z]{4}))?(-([A-Za-z]{2}|[0-9]{3}))?(-([A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(-([0-9A-WY-Za-wy-z](-[A-Za-z0-9]{2,8})+))*(-(x(-[A-Za-z0-9]{1,8})+))?)|(x(-[A-Za-z0-9]{1,8})+))$/u;

/** A `localizedText` value as the schema accepts it: `trimmedText` (E44), which also refuses a line break inside the text. */
const TRIMMED_TEXT = /^\S(.*\S)?$/u;

/**
 * The owner to create in, or `permission_denied`. The account itself cannot be
 * checked ahead of the write (Q28): Door43 answers at apply. An organization is
 * allowed only when a team of the account there may create repositories (E43):
 * any one such team is enough, whatever order Door43 lists the teams in.
 */
export async function ownerForCreation(client: Door43Client, accountLogin: string, owner: string): Promise<PlannedOwner> {
  if (owner.toLowerCase() === accountLogin.toLowerCase()) return { login: accountLogin, kind: 'account' };
  const rights = await creationRights(client);
  const right = rights.find(entry => entry.can_create && entry.organization.toLowerCase() === owner.toLowerCase());
  if (!right) throw new CatalogError('permission_denied', { details: { reason: 'the account may not create repositories in this owner', owner } });
  return { login: right.organization, kind: 'organization' };
}

export async function projectCreatePlan(input: ParsedInput<'project.create.plan'>, context: OperationContext): Promise<ProjectCreatePlan> {
  const client = signedIn(context);

  // The inputs are checked before Door43 is asked anything, so an invalid input
  // is `validation_failed` even when Door43 is unavailable (X2).
  if (input.project_type === 'obs') throw validation('project_type', 'Open Bible Stories projects cannot be created yet.');
  const title = input.title.trim();
  if (!title) throw validation('title', 'Give the project a title.');
  if (!TRIMMED_TEXT.test(title)) throw validation('title', 'Write the title on one line.');
  const abbreviation = input.abbreviation.trim();
  if (!abbreviation) throw validation('abbreviation', 'Give the project an abbreviation, such as ULT.');
  if (!TRIMMED_TEXT.test(abbreviation)) throw validation('abbreviation', 'Use letters, digits, hyphens, underscores, and dots only.');
  if (!LANGUAGE_TAG.test(input.language.code.trim())) throw validation('language.code', 'Choose a language from the list.');
  if (!TRIMMED_TEXT.test(input.language.title.trim())) throw validation('language.title', 'Choose a language from the list.');
  if (!input.testament_scope) throw validation('testament_scope', 'Choose a testament scope for a Bible project.');
  const repo_name = repositoryName(input.language.code, abbreviation);
  if (!validRepositoryName(repo_name)) throw validation('abbreviation', 'Use letters, digits, hyphens, underscores, and dots only.');

  const { account } = await readAccount(client);
  const owner = await ownerForCreation(client, account.login, input.owner.trim());
  if (await repositoryExists(client, owner.login, repo_name)) throw new CatalogError('name_taken', { values: { repo_name, owner: owner.login }, details: { owner: owner.login, repo_name } });

  const project: NewBibleProject = {
    owner: owner.login,
    repo_name,
    title,
    abbreviation,
    language: { code: input.language.code.trim(), title: input.language.title.trim(), direction: input.language.direction ?? null },
    testament_scope: input.testament_scope,
    license: input.license,
  };
  const now = context.now();
  const { metadata, files } = newBibleProjectFiles(project, { ...context.application, user: account }, now);
  const target = `${owner.login}/${repo_name}`;
  const plan: ProjectCreatePlan = {
    id: newPlanId(),
    operation: 'project.create.plan',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PLAN_SECONDS * 1000).toISOString(),
    bound_to: { default_branch_sha: null, release_tag: null, release_tag_sha: null },
    preview: { repo_name, metadata_json: metadata, files: files.map(({ path, size, md5 }: ProjectFile) => ({ path, size, md5 })) },
    would_write: [
      { kind: 'repo', target },
      { kind: 'commit', target: `${target}@master` },
    ],
    warnings: [],
  };
  const payload: ProjectCreatePayload = { owner, repo_name, project, files: files.map(({ path, content }) => ({ path, content })) };
  await context.plans.putPlan({ plan, payload, account: account.login });
  return plan;
}
