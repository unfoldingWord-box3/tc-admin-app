// The creation wizard's logic (#28): owners, the form's defaults, the plan input,
// which field a failure is shown at (X2), the language search (Q20, Q30), the
// words for the translation details, and the project just created in the portfolio.
import { ERROR_CATALOG, TEXT_TRANSLATION_AUDIENCES, TEXT_TRANSLATION_PROJECT_TYPES, TEXT_TRANSLATION_TYPES, WRITE_KINDS } from '@tc-admin/shared/schema';
import type { OperationErrorShape, ProjectSummary } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import {
  CREATE_HASH,
  DETAIL_LABELS,
  DETAIL_OPTIONS,
  DETAIL_VALUE_LABELS,
  TESTAMENT_SCOPE_LABELS,
  WRITE_LABELS,
  fieldErrors,
  languageLabel,
  missing,
  newForm,
  ownersFromPortfolio,
  ownersFromSearch,
  planInput,
  repositoryNameOf,
  retireCreated,
  searchLanguages,
  tagRefused,
  withCreated,
  withProjectType,
} from '../src/create-project';
import type { Form, Language } from '../src/create-project';
import { hashRef } from '../src/portfolio-labels';

const me = { login: 'tc-admin-qa', name: 'QA Tester' };
const language = (extra: Partial<Language>): Language => ({ code: 'id', title: 'Bahasa Indonesia', english: 'Indonesian', direction: 'ltr', alternates: [], tag_accepted: true, ...extra });
const indonesian = language({});
const pendau = language({ code: 'ums', title: 'Pendau', english: 'Pendau', alternates: ['Ndaoe', 'Ndau', 'Umalasa'] });
const arabic = language({ code: 'ar', title: 'العربية', english: 'Arabic', direction: 'rtl' });
const dayakLaur = language({ code: 'xdy-x-dayaklaur', title: 'Dayak Laur', english: 'Dayak Laur', tag_accepted: false });
const idu = language({ code: 'idu', title: 'Idoma', english: 'Idoma' });
const ind = language({ code: 'inb', title: 'Inga', english: 'Inga', alternates: ['Indonesian Inga'] });
const list = [arabic, dayakLaur, indonesian, idu, ind, pendau];
const filled = (extra: Partial<Form> = {}): Form => ({ ...newForm('tc-admin-qa-org'), title: 'Alkitab Percobaan', abbreviation: 'TCAP', language: indonesian, testament_scope: 'nt', ...extra });
const error = (extra: Partial<OperationErrorShape>): OperationErrorShape => ({ code: 'validation_failed', message: 'x', retryable: false, next_action: 'fix the input', request_id: 'r1', details: {}, invariant: null, ...extra });

describe('the owners offered', () => {
  test('from the portfolio: its organizations first, then the account, whose own group is not an organization', () => {
    const owners = ownersFromPortfolio([{ name: 'bahtraku' }, { name: 'TC-Admin-QA' }, { name: 'unfoldingWord' }], me);
    expect(owners).toEqual([
      { login: 'bahtraku', name: 'bahtraku', kind: 'organization' },
      { login: 'unfoldingWord', name: 'unfoldingWord', kind: 'organization' },
      { login: 'tc-admin-qa', name: 'QA Tester', kind: 'account' },
    ]);
    expect(ownersFromPortfolio([], me)).toEqual([{ login: 'tc-admin-qa', name: 'QA Tester', kind: 'account' }]);
  });

  test("from owner.search's own list: the organizations by login with their names, then the account", () => {
    expect(ownersFromSearch([{ login: 'tc-admin-qa-org', name: '' }, { login: 'unfoldingWord', name: 'unfoldingWord®' }], me)).toEqual([
      { login: 'tc-admin-qa-org', name: 'tc-admin-qa-org', kind: 'organization' },
      { login: 'unfoldingWord', name: 'unfoldingWord®', kind: 'organization' },
      { login: 'tc-admin-qa', name: 'QA Tester', kind: 'account' },
    ]);
  });

  test('the wizard address is one segment, so it is never read as a project', () => {
    expect(CREATE_HASH).toBe('#/new');
    expect(hashRef(CREATE_HASH)).toBeNull();
  });
});

describe('the form', () => {
  test('starts as a Bible with the defaults preselected for the translation details (Q4) and nothing else chosen', () => {
    expect(newForm('tc-admin-qa-org')).toEqual({
      owner: 'tc-admin-qa-org',
      project_type: 'bible',
      title: '',
      abbreviation: '',
      language: null,
      testament_scope: null,
      details: { projectType: 'standard', translationType: 'firstTranslation', audience: 'common' },
    });
  });

  test('Open Bible Stories defaults the abbreviation to OBS and has no testament scope; a written abbreviation is kept (#82, Q25)', () => {
    const obs = withProjectType(filled({ abbreviation: '' }), 'obs');
    expect(obs).toMatchObject({ project_type: 'obs', abbreviation: 'OBS', testament_scope: null });
    expect(withProjectType(obs, 'bible')).toMatchObject({ project_type: 'bible', abbreviation: '', testament_scope: null });
    expect(withProjectType(filled({ abbreviation: 'TCAP' }), 'obs')).toMatchObject({ abbreviation: 'TCAP', testament_scope: null });
    expect(withProjectType(withProjectType(filled({ abbreviation: 'obs ' }), 'obs'), 'bible').abbreviation).toBe('');
  });

  test('shows the repository name the Worker will derive, <language>_<abbreviation> in lowercase, once both are given', () => {
    expect(repositoryNameOf(filled({ abbreviation: ' ULT ' }))).toBe('id_ult');
    expect(repositoryNameOf(filled({ language: language({ code: 'es-419' }) }))).toBe('es-419_tcap');
    expect(repositoryNameOf(filled({ language: null }))).toBeNull();
    expect(repositoryNameOf(filled({ abbreviation: '  ' }))).toBeNull();
  });

  test("says what is missing in the Worker's words, and a language whose tag is refused cannot be submitted (Q30)", () => {
    expect(missing(filled())).toEqual({});
    expect(missing(newForm(''))).toEqual({
      owner: 'Choose an owner.',
      title: 'Give the project a title.',
      abbreviation: 'Give the project an abbreviation, such as ULT.',
      language: 'Choose a language from the list.',
      testament_scope: 'Choose a testament scope for a Bible project.',
    });
    expect(missing(withProjectType(filled({ testament_scope: null }), 'obs'))).toEqual({});
    expect(missing(filled({ language: dayakLaur }))).toEqual({ language: tagRefused('xdy-x-dayaklaur') });
    expect(tagRefused('xdy-x-dayaklaur')).toContain('xdy-x-dayaklaur');
  });

  test('sends a Bible with its testament scope and translation details, and Open Bible Stories with neither, trimmed', () => {
    expect(planInput({ ...filled({ title: ' Alkitab Percobaan ', abbreviation: 'TCAP ' }), language: indonesian })).toEqual({
      owner: 'tc-admin-qa-org',
      project_type: 'bible',
      title: 'Alkitab Percobaan',
      abbreviation: 'TCAP',
      language: { code: 'id', title: 'Bahasa Indonesia', direction: 'ltr' },
      testament_scope: 'nt',
      flavor: { projectType: 'standard', translationType: 'firstTranslation', audience: 'common' },
      license: 'cc-by-sa-4.0',
    });
    const obs = withProjectType(filled({ details: { projectType: 'daughter', translationType: 'revision', audience: 'literary' } }), 'obs');
    expect(planInput({ ...obs, language: pendau })).toMatchObject({ project_type: 'obs', abbreviation: 'TCAP', testament_scope: null, flavor: null, language: { code: 'ums' } });
  });
});

describe('where a failure is shown (X2)', () => {
  test('a validation_failed is shown at the field each of its details.fields names, a language or flavor path at its field', () => {
    const fields = [
      { path: 'language.code', message: 'Choose a language from the list.' },
      { path: 'flavor.audience', message: 'Invalid option' },
      { path: 'testament_scope', message: 'Choose a testament scope for a Bible project.' },
      { path: 'title', message: 'Write the title on one line.' },
      { path: 'something_else', message: 'ignored' },
    ];
    expect(fieldErrors(error({ details: { fields } }))).toEqual({
      language: 'Choose a language from the list.',
      details: 'Invalid option',
      testament_scope: 'Choose a testament scope for a Bible project.',
      title: 'Write the title on one line.',
    });
    expect(fieldErrors(error({ message: 'The request body is not valid JSON.' }))).toBeNull();
    expect(fieldErrors(error({ details: { fields: [{ path: 'abbreviation' }] }, message: 'abbreviation: bad' }))).toEqual({ abbreviation: 'abbreviation: bad' });
  });

  test('name_taken is answered at the abbreviation and permission_denied at the owner, with the catalog message; the rest is not a field\'s', () => {
    const taken = 'A repository named id_tcap already exists in tc-admin-qa-org. Change the abbreviation.';
    expect(fieldErrors(error({ code: 'name_taken', message: taken }))).toEqual({ abbreviation: taken });
    expect(fieldErrors(error({ code: 'permission_denied', message: ERROR_CATALOG.permission_denied.message }))).toEqual({ owner: ERROR_CATALOG.permission_denied.message });
    expect(fieldErrors(error({ code: 'door43_unavailable', message: ERROR_CATALOG.door43_unavailable.message }))).toBeNull();
    expect(fieldErrors(error({ code: 'plan_expired', message: ERROR_CATALOG.plan_expired.message }))).toBeNull();
  });
});

describe('the language search (Q20)', () => {
  test('finds by tag, native name, English name, and alternate name, case-insensitively', () => {
    expect(searchLanguages(list, 'ums', null).map(l => l.code)).toEqual(['ums']);
    expect(searchLanguages(list, 'bahasa', null).map(l => l.code)).toEqual(['id']);
    expect(searchLanguages(list, 'ARABIC', null).map(l => l.code)).toEqual(['ar']);
    expect(searchLanguages(list, 'ndau', null).map(l => l.code)).toEqual(['ums']);
    expect(searchLanguages(list, 'nothing-like-it', null)).toEqual([]);
  });

  test("an exact tag comes first, then the owner's languages, then the closer match, each in Door43's order", () => {
    expect(searchLanguages(list, 'id', null).map(l => l.code)).toEqual(['id', 'idu']);
    expect(searchLanguages(list, 'id', ['idu']).map(l => l.code)).toEqual(['id', 'idu']);
    // "Indonesian" and the tag "inb" both start with "in": the same rank, Door43's order; an owner's language goes first.
    expect(searchLanguages(list, 'in', null).map(l => l.code)).toEqual(['id', 'inb']);
    expect(searchLanguages(list, 'in', ['inb']).map(l => l.code)).toEqual(['inb', 'id']);
  });

  test("with no query, the owner's own languages alone, and nothing without an owner", () => {
    expect(searchLanguages(list, '  ', ['ums', 'ID']).map(l => l.code)).toEqual(['id', 'ums']);
    expect(searchLanguages(list, '', null)).toEqual([]);
    expect(searchLanguages(list, '', [])).toEqual([]);
  });

  test('Q30: a language whose tag the schema refuses is found too, so the wizard can say why it cannot be chosen', () => {
    expect(searchLanguages(list, 'dayak', null)).toEqual([dayakLaur]);
    expect(dayakLaur.tag_accepted).toBe(false);
  });

  test('is limited', () => {
    const many = Array.from({ length: 30 }, (_, i) => language({ code: `aa${i}`, title: `Alpha ${i}` }));
    expect(searchLanguages(many, 'alpha', null)).toHaveLength(20);
    expect(searchLanguages(many, 'alpha', null, 5)).toHaveLength(5);
  });

  test('labels a language by native name, English name when it differs, tag, and direction when right to left', () => {
    expect(languageLabel(indonesian)).toBe('Bahasa Indonesia · Indonesian · id');
    expect(languageLabel(pendau)).toBe('Pendau · ums');
    expect(languageLabel(arabic)).toBe('العربية · Arabic · ar · right to left');
    expect(languageLabel(language({ english: '' }))).toBe('Bahasa Indonesia · id');
  });
});

describe('the words', () => {
  test('every translation detail value the schema enumerates has a label, and the fields are not called project type (CONTEXT.md)', () => {
    expect(DETAIL_OPTIONS).toEqual({ projectType: TEXT_TRANSLATION_PROJECT_TYPES, translationType: TEXT_TRANSLATION_TYPES, audience: TEXT_TRANSLATION_AUDIENCES });
    for (const field of ['projectType', 'translationType', 'audience'] as const) {
      expect(Object.keys(DETAIL_VALUE_LABELS[field]).sort()).toEqual([...DETAIL_OPTIONS[field]].sort());
      expect(Object.values(DETAIL_VALUE_LABELS[field]).every(label => label.length > 0)).toBe(true);
      expect(DETAIL_LABELS[field].toLowerCase()).not.toBe('project type');
    }
  });

  test('H5: the testament scopes say how many books they cover, and every write kind has a word', () => {
    expect(TESTAMENT_SCOPE_LABELS).toEqual({ nt: 'New Testament (27 books)', ot: 'Old Testament (39 books)', full: 'Old and New Testament (66 books)' });
    expect(Object.keys(WRITE_LABELS).sort()).toEqual([...WRITE_KINDS].sort());
  });
});

describe('the project just created in the portfolio (S1)', () => {
  const summary = (owner: string, repo: string): ProjectSummary => ({
    ref: { owner, repo, id: 1, url: '' },
    title: repo,
    description: '',
    default_branch: 'master',
    language: { code: 'id', title: 'Bahasa Indonesia' },
    project_type: 'bible',
    metadata_format: 'sb',
    editability: { state: 'editable', reason: '' },
    coverage: { present: 0, target: 27, scope: 'nt', basis: 'archive', units: [] },
    health: { state: 'never_checked', severity_raw: null, ref: null, checked_at: null, issue_count: null, source: 'door43' },
    permissions: { push: true, admin: true, checked_at: '' },
  });
  const portfolio = [
    { name: 'bahtraku', projects: [summary('bahtraku', 'id_tb1'), summary('bahtraku', 'ums_pb')] },
    { name: 'tc-admin-qa', projects: [summary('tc-admin-qa', 'id_tcap')] },
  ];

  test('is added to its owner\'s group in name order, or in a new group before the account\'s own, and never twice', () => {
    expect(withCreated(portfolio, null, 'tc-admin-qa')).toBe(portfolio);
    const inGroup = withCreated(portfolio, summary('bahtraku', 'id_ult'), 'tc-admin-qa');
    expect(inGroup[0]!.projects.map(p => p.ref.repo)).toEqual(['id_tb1', 'id_ult', 'ums_pb']);
    const newGroup = withCreated(portfolio, summary('tc-admin-qa-org', 'id_obs'), 'tc-admin-qa');
    expect(newGroup.map(group => group.name)).toEqual(['bahtraku', 'tc-admin-qa-org', 'tc-admin-qa']);
    const own = withCreated([portfolio[0]!], summary('TC-Admin-QA', 'id_new'), 'tc-admin-qa');
    expect(own.map(group => group.name)).toEqual(['bahtraku', 'TC-Admin-QA']);
    expect(withCreated(portfolio, summary('bahtraku', 'id_tb1'), 'tc-admin-qa')).toBe(portfolio);
  });

  test('is retired once a read lists it, so a later read that leaves it out is not overridden (absent, listed, absent)', () => {
    const created = summary('bahtraku', 'id_ult');
    // Absent: Door43's catalog does not list it yet, so it is kept and shown.
    const kept = retireCreated(portfolio, created);
    expect(kept).toBe(created);
    expect(withCreated(portfolio, kept, 'tc-admin-qa')[0]!.projects.map(p => p.ref.repo)).toContain('id_ult');
    // Listed: the read rules from now on.
    const listed = [{ name: 'bahtraku', projects: [...portfolio[0]!.projects, { ...created, permissions: { push: true, admin: false, checked_at: '' } }] }, portfolio[1]!];
    const retired = retireCreated(listed, kept);
    expect(retired).toBeNull();
    // Absent again (access removed): the project stays out.
    expect(withCreated(portfolio, retired, 'tc-admin-qa')).toBe(portfolio);
    expect(retireCreated(portfolio, null)).toBeNull();
  });
});
