// Contract tests over the recorded QA runs of project creation (E45 a Bible,
// E47 Open Bible Stories; ADR 0012): the file committed is the one the writer
// generates for the same inputs and time (W1, R10); the plan and the receipt
// recorded are the catalog's shapes; Door43 read each new repository as a
// Scripture Burrito project of its type.
import { readFileSync } from 'node:fs';
import { OPERATIONS } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { projectCatalog } from '../../src/door43/catalog';
import type { Door43Repository } from '../../src/door43/catalog';
import { METADATA_PATH, newProjectFiles } from '../../src/model/burrito';
import { healthFromSeverity } from '../../src/model/health';
import { classifyProject } from '../../src/model/project';

const runs = new URL('../../../fixtures/door43/qa.door43.org/2026-10-05/project-create/', import.meta.url);
const run = new URL('tc-admin-qa-org/', runs);
const read = (name: string, dir = run) => readFileSync(new URL(name, dir), 'utf8');
const recorded = <T>(name: string, dir = run): T => (JSON.parse(read(name, dir)) as { response: { json: T } }).response.json;
const GENERATOR = { name: 'tC Admin', version: '0.1.0', user: { login: 'tc-admin-qa', name: 'tc-admin-qa' } };

describe('the recorded QA creation (E45)', () => {
  const summary = JSON.parse(read('summary.json')) as { input: { owner: string; title: string; abbreviation: string; language: { code: string; title: string; direction: 'ltr' }; testament_scope: 'nt' } };
  const plan = OPERATIONS['project.create.plan'].output.parse(JSON.parse(read('plan.json')));
  const receipt = OPERATIONS['project.create.apply'].output.parse(JSON.parse(read('receipt.json')));
  const committed = read('metadata.json');

  test('W1: the metadata.json committed is byte for byte what the writer generates for the recorded inputs and time', () => {
    const generated = newProjectFiles(
      {
        owner: summary.input.owner,
        repo_name: plan.preview.repo_name,
        project_type: 'bible',
        title: summary.input.title,
        abbreviation: summary.input.abbreviation,
        language: summary.input.language,
        testament_scope: summary.input.testament_scope,
        license: 'cc-by-sa-4.0',
      },
      GENERATOR,
      new Date((JSON.parse(committed) as { meta: { dateCreated: string } }).meta.dateCreated),
    );
    expect(generated.files.find(file => file.path === METADATA_PATH)!.content).toBe(committed);
    expect(generated.metadata).toEqual(plan.preview.metadata_json);
  });

  test('R10: the sizes Door43 recorded for the committed files are the plan\'s sizes', () => {
    const commit = recorded<{ files: { path: string; size: number }[] }>('08-POST-repos_tc-admin-qa-org_id_tcap1856_contents.json');
    expect(commit.files.map(file => [file.path, file.size])).toEqual(plan.preview.files.map(file => [file.path, file.size]));
  });

  test('W5: the receipt lists the repository and exactly one commit, and equals the plan\'s would_write', () => {
    expect(receipt.wrote.map(({ kind, target }) => ({ kind, target }))).toEqual(plan.would_write);
    expect(receipt.wrote.filter(write => write.kind === 'commit')).toHaveLength(1);
    expect(receipt.warnings).toEqual([]);
    expect(receipt.result.setup).toEqual({ state: 'complete', failed_step: null });
  });

  test('A3: Door43 attributed the commit to the token\'s user', () => {
    const commit = recorded<{ commit: { author: { name: string }; committer: { name: string } } }>('08-POST-repos_tc-admin-qa-org_id_tcap1856_contents.json');
    expect(commit.commit.author.name).toBe('tc-admin-qa');
    expect(commit.commit.committer.name).toBe('tc-admin-qa');
  });

  test('Door43 read the new repository as a Scripture Burrito Bible, editable, with no books yet', () => {
    const view = recorded<Door43Repository>('10-GET-repos_catalog-view.json');
    const classified = classifyProject(projectCatalog(view));
    expect(classified).toMatchObject({ project_type: 'bible', metadata_format: 'sb', editability: { state: 'editable' } });
    // Door43 answers `ingredients: null` for a project without books, and the search carries no currentScope (E32): from the catalog alone the coverage is unknown, never zero (H3), until books arrive or the catalog metadata is read (E20, #24).
    expect(classified.coverage).toMatchObject({ present: null, scope: 'unknown', target: null, basis: 'catalog' });
    expect(receipt.result.coverage).toMatchObject({ present: 0, scope: 'nt', target: 27, basis: 'archive' });
  });

  test('H1: the health result of the new repository is info, with the one note every unreleased repository carries (E28)', () => {
    const health = recorded<{ data: { overall_severity_level: string; issues: Record<string, unknown[]>; severity_level_count: Record<string, number> } }>('09-health-master.json');
    expect(health.data.overall_severity_level).toBe('info');
    expect(Object.entries(health.data.issues).filter(([, issues]) => issues.length).map(([rule]) => rule)).toEqual(['release_needed']);
    expect(health.data.severity_level_count).toEqual({ info: 1, warning: 0, error: 0, success: 0 });
    expect(healthFromSeverity(health.data.overall_severity_level)).toBe('info');
    const entry = recorded<{ is_valid: boolean; is_healthy: boolean; is_healthy_without_warnings: boolean; metadata_type: string; flavor: string }>('11-GET-catalog_entry_master.json');
    expect(entry).toMatchObject({ is_valid: true, is_healthy: true, is_healthy_without_warnings: true, metadata_type: 'sb', flavor: 'textTranslation' });
  });

  test('Q28: creating in the user\'s own namespace was refused for the write:user scope and written nothing', () => {
    const refused = JSON.parse(readFileSync(new URL('../tc-admin-qa-refused/05-POST-user_repos.json', run), 'utf8')) as { response: { status: number; json: { message: string } } };
    expect(refused.response.status).toBe(403);
    expect(refused.response.json.message).toContain('required=[write:user]');
    const summaryUser = JSON.parse(readFileSync(new URL('../tc-admin-qa-refused/summary.json', run), 'utf8')) as { apply_error: { code: string } };
    expect(summaryUser.apply_error.code).toBe('permission_denied');
  });
});

describe('the recorded QA creation of an Open Bible Stories project (E47)', () => {
  const obs = new URL('tc-admin-qa-org-obs/', runs);
  const summary = JSON.parse(read('summary.json', obs)) as { input: { owner: string; title: string; abbreviation: string; language: { code: string; title: string; direction: 'ltr' } } };
  const plan = OPERATIONS['project.create.plan'].output.parse(JSON.parse(read('plan.json', obs)));
  const receipt = OPERATIONS['project.create.apply'].output.parse(JSON.parse(read('receipt.json', obs)));
  const committed = read('metadata.json', obs);

  test('W1: the metadata.json committed is byte for byte what the writer generates, with tC Admin as generator and the fixed scope (E46)', () => {
    const generated = newProjectFiles(
      {
        owner: summary.input.owner,
        repo_name: plan.preview.repo_name,
        project_type: 'obs',
        title: summary.input.title,
        abbreviation: summary.input.abbreviation,
        language: summary.input.language,
        testament_scope: null,
        license: 'cc-by-sa-4.0',
      },
      GENERATOR,
      new Date((JSON.parse(committed) as { meta: { dateCreated: string } }).meta.dateCreated),
    );
    expect(generated.files.find(file => file.path === METADATA_PATH)!.content).toBe(committed);
    const written = JSON.parse(committed) as { meta: { generator: { softwareName: string; softwareVersion: string } }; type: { flavorType: { name: string; flavor: object; currentScope: object } } };
    expect(written.meta.generator).toMatchObject({ softwareName: 'tC Admin', softwareVersion: '0.1.0' });
    expect(written.type.flavorType).toMatchObject({ name: 'gloss', flavor: { name: 'textStories' } });
    expect(Object.keys(written.type.flavorType.currentScope)).toHaveLength(33);
  });

  test('W5: the receipt lists the repository and exactly one commit, equal to the plan, and the report counts 0 of 50 stories (H5)', () => {
    expect(receipt.wrote.map(({ kind, target }) => ({ kind, target }))).toEqual(plan.would_write);
    expect(receipt.wrote.filter(write => write.kind === 'commit')).toHaveLength(1);
    expect(receipt.result).toMatchObject({ project_type: 'obs', metadata_format: 'sb', coverage: { present: 0, target: 50, scope: 'obs', basis: 'archive' }, setup: { state: 'complete' } });
  });

  test('H3: Door43 read it as a Scripture Burrito Open Bible Stories project and lists only the stories container, which is unknown coverage, never zero or fifty', () => {
    const view = recorded<Door43Repository>('10-GET-repos_catalog-view.json', obs);
    expect(view).toMatchObject({ metadata_type: 'sb', flavor_type: 'gloss', flavor: 'textStories', subject: 'Open Bible Stories' });
    expect(view.ingredients).toEqual([expect.objectContaining({ identifier: 'obs', is_dir: true, exists: true })]);
    const classified = classifyProject(projectCatalog(view));
    expect(classified).toMatchObject({ project_type: 'obs', metadata_format: 'sb', editability: { state: 'editable' }, coverage: { present: null, target: 50, scope: 'obs', basis: 'catalog' } });
  });

  test('H1: the health result is info with only the release_needed note, and the catalog entry is valid', () => {
    const health = recorded<{ data: { overall_severity_level: string; issues: Record<string, unknown[]>; severity_level_count: Record<string, number> } }>('09-health-master.json', obs);
    expect(health.data.overall_severity_level).toBe('info');
    expect(Object.entries(health.data.issues).filter(([, issues]) => issues.length).map(([rule]) => rule)).toEqual(['release_needed']);
    expect(health.data.severity_level_count).toEqual({ info: 1, warning: 0, error: 0, success: 0 });
    expect(recorded<{ is_valid: boolean; flavor: string }>('11-GET-catalog_entry_master.json', obs)).toMatchObject({ is_valid: true, flavor: 'textStories' });
  });
});

describe('the recorded creation under the signed-in account (E48, Q28)', () => {
  const own = new URL('tc-admin-qa-oauth/', runs);
  const plan = OPERATIONS['project.create.plan'].output.parse(JSON.parse(read('plan.json', own)));
  const receipt = OPERATIONS['project.create.apply'].output.parse(JSON.parse(read('receipt.json', own)));
  const committed = read('metadata.json', own);

  test('W1: the metadata.json committed under the account is byte for byte what the writer generates', () => {
    const written = JSON.parse(committed) as { meta: { dateCreated: string }; identification: { name: { en: string }; abbreviation: { en: string } } };
    const generated = newProjectFiles(
      {
        owner: 'tc-admin-qa',
        repo_name: plan.preview.repo_name,
        project_type: 'bible',
        title: written.identification.name.en,
        abbreviation: written.identification.abbreviation.en,
        language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' },
        testament_scope: 'nt',
        license: 'cc-by-sa-4.0',
      },
      GENERATOR,
      new Date(written.meta.dateCreated),
    );
    expect(generated.files.find(file => file.path === METADATA_PATH)!.content).toBe(committed);
  });

  test('A3: the receipt wrote the repository and one commit under tc-admin-qa, and Door43 recorded that user as author', () => {
    expect(receipt.wrote.map(({ kind, target }) => ({ kind, target }))).toEqual([
      { kind: 'repo', target: 'tc-admin-qa/id_tcap2002' },
      { kind: 'commit', target: 'tc-admin-qa/id_tcap2002@master' },
    ]);
    expect(receipt.wrote).toEqual(plan.would_write.map(write => expect.objectContaining(write)));
    expect(receipt.result.ref).toMatchObject({ owner: 'tc-admin-qa', repo: 'id_tcap2002' });
    const commit = recorded<{ commit: { author: { name: string }; committer: { name: string } } }>('02-GET-git_commit.json', own);
    expect(commit.commit.author.name).toBe('tc-admin-qa');
    expect(commit.commit.committer.name).toBe('tc-admin-qa');
  });

  test('Door43 read the project under the account as a Scripture Burrito Bible with health info and only release_needed', () => {
    const view = recorded<Door43Repository & { owner: { login: string } }>('01-GET-repos_catalog-view.json', own);
    expect(view.owner.login).toBe('tc-admin-qa');
    expect(classifyProject(projectCatalog(view))).toMatchObject({ project_type: 'bible', metadata_format: 'sb', editability: { state: 'editable' } });
    const health = recorded<{ data: { overall_severity_level: string; issues: Record<string, unknown[]> } }>('03-GET-healthcheck_master.json', own);
    expect(health.data.overall_severity_level).toBe('info');
    expect(Object.entries(health.data.issues).filter(([, issues]) => issues.length).map(([rule]) => rule)).toEqual(['release_needed']);
    expect(recorded<{ is_valid: boolean }>('04-GET-catalog_entry_master.json', own).is_valid).toBe(true);
  });
});
