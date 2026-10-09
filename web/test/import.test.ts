// The import screen's logic (#81, product spec §8): the owners offered (own
// first, once each), the units sent to the plan (`all` for every book and for
// a source Door43 does not itemize), the wording of a source, the summary and
// the gate of the plan of record, and the way forward after a refusal.
import { describe, expect, test } from 'vitest';
import {
  canConfirmImport,
  importAction,
  importBlockers,
  importConfirmLabel,
  importSummary,
  importWayForward,
  importWayForwardText,
  ownerChoices,
  ownerLabel,
  relationshipText,
  revisionOf,
  sourceFacts,
  sourceMatches,
  importableSources,
  filteredSources,
  listedFacts,
  noSourceText,
  unitsInput,
} from '../src/import';
import { overwriteKey } from '../src/upload';
import { book, importPlanOf, ownersOf, sourceOf } from './support/import';

describe('owners', () => {
  test('the account\'s organizations come first and always, and an owner the search also matched is listed once, among them', () => {
    const answer = ownersOf([{ login: 'tc-admin-qa-org', name: 'tC Admin QA' }, { login: 'bahtraku', name: 'Yayasan BahtraKu' }], [{ login: 'Bahtraku', name: 'Yayasan BahtraKu' }, { login: 'bahasa-org', name: '' }, { login: 'bahasa-org', name: '' }]);
    const { own, matches } = ownerChoices(answer);
    expect(own.map(account => account.login)).toEqual(['tc-admin-qa-org', 'bahtraku']);
    expect(matches.map(account => account.login)).toEqual(['bahasa-org']);
  });

  test('an owner reads by its display name with its login, or by its login alone', () => {
    expect(ownerLabel({ login: 'bahtraku', name: 'Yayasan BahtraKu' })).toBe('Yayasan BahtraKu (bahtraku)');
    expect(ownerLabel({ login: 'bahasa-org', name: 'bahasa-org' })).toBe('bahasa-org');
    expect(ownerLabel({ login: 'bahasa-org', name: '' })).toBe('bahasa-org');
  });
});

describe('sources', () => {
  test('E35, Q25: a source shows its type, its format, whether it was ever released, and the revision offered', () => {
    expect(sourceFacts(sourceOf('bahtraku', 'id_tb1', { stage: 'prod' }))).toEqual(['Bible', 'Resource Container', 'Released', 'release 1974']);
    expect(sourceFacts(sourceOf('bahtraku', 'id_gst', { format: 'tc', released: false }))).toEqual(['Bible', 'translationCore', 'Never released', 'branch master']);
    expect(revisionOf(sourceOf('bahtraku', 'id_tb1', { stage: 'prod' }))).toBe('1974');
    expect(revisionOf(sourceOf('bahtraku', 'id_tb1'))).toBe('master');
  });

  test('#151: only sources of the project\'s type are listed, in any format; the rest are counted, not shown', () => {
    expect(sourceMatches(sourceOf('unfoldingWord', 'en_obs', { type: 'obs' }), 'bible')).toBe(false);
    expect(sourceMatches(sourceOf('bahtraku', 'id_tb1'), 'bible')).toBe(true);
    const list = [sourceOf('unfoldingWord', 'en_ult', { format: 'rc' }), sourceOf('unfoldingWord', 'en_obs', { type: 'obs' }), sourceOf('bahtraku', 'id_tb1', { format: 'sb' })];
    expect(importableSources(list, 'bible')).toEqual({ listed: [list[0], list[2]], leftOut: 1 });
    expect(importableSources(list, 'obs')).toEqual({ listed: [list[1]], leftOut: 2 });
  });

  test('#151: the filter matches the title, the language code, or the repository name, in any case; an empty filter keeps all', () => {
    const french = { ...sourceOf('unfoldingWord', 'fr_ulb', { title: 'French ULB' }), language: { code: 'fr', title: 'Français' } };
    const list = [sourceOf('bahtraku', 'id_tb1', { title: 'Alkitab Terjemahan Baru' }), french];
    expect(filteredSources(list, '  ')).toEqual(list);
    expect(filteredSources(list, 'alkitab')).toEqual([list[0]]);
    expect(filteredSources(list, 'FR')).toEqual([french]);
    expect(filteredSources(list, 'unfoldingword/fr_')).toEqual([french]);
    expect(filteredSources(list, 'none')).toEqual([]);
    expect(listedFacts(french)).toEqual(['Resource Container', 'Released', 'branch master']);
  });

  test('#151: with nothing of this type, the screen says so, and how many of the other type are not listed', () => {
    expect(noSourceText('bahtraku', 'latest', 'bible', 0)).toBe('bahtraku has no Bible repository at its latest content.');
    expect(noSourceText('bahtraku', 'prod', 'obs', 1)).toBe('bahtraku has no Open Bible Stories repository at its last release. One Bible repository is not listed, since it cannot be imported here.');
  });

  test('E35: the units sent are the chosen ids, `all` only when Door43 itemizes none, and none when nothing is chosen', () => {
    const source = sourceOf('bahtraku', 'id_tb1');
    expect(unitsInput(source, new Set(['gen', 'exo']))).toEqual(['gen', 'exo']);
    // Every listed book chosen is still the list: the Worker's `all` is the archive's every book, which may be more than Door43 itemizes.
    expect(unitsInput(source, new Set(['gen', 'exo', 'mat']))).toEqual(['gen', 'exo', 'mat']);
    expect(unitsInput(source, new Set())).toBeNull();
    expect(unitsInput(sourceOf('unfoldingWord', 'en_obs', { type: 'obs', books: null }), new Set())).toBe('all');
  });
});

describe('the plan of record', () => {
  test('wording: the actions name the write', () => {
    expect(importAction('bible')).toBe('Import books');
    expect(importAction('obs')).toBe('Import stories');
    expect(importConfirmLabel('bible', 2)).toBe('Import 2 books');
    expect(importConfirmLabel('obs', 1)).toBe('Import 1 story');
  });

  test('W5, E24: the summary names the one commit, the new and the replaced books, the entries, and the source; the relationship is said', () => {
    const plan = importPlanOf('p1', [book('gen'), book('exo'), book('mat', true, null)]);
    expect(importSummary(plan, 'bible')).toBe('One commit to tc-admin-qa/id_tcai1633@master: 2 new books (GEN, EXO) · 1 book replaced (MAT) · 3 ingredient entries in metadata.json · from bahtraku/id_tb1 at 1974.');
    expect(relationshipText(plan)).toBe('Source recorded in metadata.json: bahtraku/id_tb1 at 1974.');
  });

  test('the gate: an overwrite needs its own confirmation; a plan of nothing cannot be confirmed', () => {
    const plan = importPlanOf('p1', [book('gen'), book('mat', true, '@@ -1 +1 @@\n-old\n+new\n')]);
    expect(importBlockers(plan, new Set())).toEqual(['Confirm that ingredients/MAT.usfm is replaced.']);
    expect(canConfirmImport(plan, new Set([overwriteKey(plan, plan.preview.files[1]!)]))).toBe(true);
    const empty = importPlanOf('p2', []);
    expect(canConfirmImport(empty, new Set())).toBe(false);
  });
});

describe('refusals', () => {
  test('X1: after an apply that failed the way forward is a new plan, never the same apply again; a refused choice is chosen again; a lost right goes back', () => {
    expect(importWayForward('commit_failed', 'apply')).toBe('plan_again');
    expect(importWayForward('source_changed', 'apply')).toBe('plan_again');
    expect(importWayForward('door43_unavailable', 'apply')).toBe('plan_again');
    expect(importWayForward('validation_failed', 'plan')).toBe('choose_again');
    expect(importWayForward('validation_failed', 'apply')).toBe('plan_again');
    expect(importWayForward('not_found', 'apply')).toBe('plan_again');
    expect(importWayForward('not_found', 'plan')).toBe('choose_again');
    expect(importWayForward('permission_denied', 'plan')).toBe('back');
    expect(importWayForward('door43_unavailable', 'owners')).toBe('try_again');
    expect(importWayForwardText({ code: 'commit_failed', during: 'apply' })).toContain('does not send the import again by itself');
    expect(importWayForwardText({ code: 'source_changed', during: 'apply' })).toContain('The project or the source changed');
    // The sentence follows the button: an apply's way forward is a new plan, whatever the code (X1).
    expect(importWayForward('source_unavailable', 'apply')).toBe('plan_again');
    expect(importWayForwardText({ code: 'source_unavailable', during: 'apply' })).toContain('plan again');
    expect(importWayForwardText({ code: 'validation_failed', during: 'apply' })).toContain('Plan again');
    expect(importWayForwardText({ code: 'not_found', during: 'apply' })).toContain('Plan again');
  });
});
