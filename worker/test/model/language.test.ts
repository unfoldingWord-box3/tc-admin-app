// The language tag rule (W1): the pattern tC Admin checks is the recorded
// Scripture Burrito schema's `languageTag` (E44), so what passes here is what
// validates in metadata.json; and Door43's list carries tags it refuses (Q30).
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_TAG, validLanguageTag } from '../../src/model/language';

const common = JSON.parse(readFileSync(new URL('../../../fixtures/scripture-burrito/2026-10-05/schema/common.schema.json', import.meta.url), 'utf8')) as {
  definitions: { languageTag: { pattern: string } };
};

describe('the language tag rule', () => {
  test('E44: the pattern is the recorded schema\'s languageTag, character for character', () => {
    expect(LANGUAGE_TAG.source).toBe(common.definitions.languageTag.pattern);
  });

  test('accepts the tags Door43 spells (E25) and refuses what the schema refuses', () => {
    for (const tag of ['id', 'es-419', 'el-x-koine', 'zh-Hant-TW', 'ums', 'bkr-x-pajuepat']) expect(validLanguageTag(tag), tag).toBe(true);
    // A private-use subtag over eight characters, an empty subtag, a space, and an extension subtag over eight: all in Door43's list (Q30).
    for (const tag of ['xdy-x-dayaklaur', 'aaz-x-amarasibarat', 'iba-x-', 'hni-x-bu4du1 hani', 'alk-alakatapue', '-x-', '', 'not a tag']) expect(validLanguageTag(tag), tag).toBe(false);
  });
});
