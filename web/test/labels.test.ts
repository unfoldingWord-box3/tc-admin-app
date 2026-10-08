// Every identifier in its glossary words (#8, AGENTS.md rule 1): each label
// map covers exactly the values the shared schema enumerates, which
// shared/test/catalog.test.ts holds to CONTEXT.md's "Identifiers" table, so no
// value can reach the interface as a raw identifier; every label is words in sentence case, with no emoji; and every
// health state has its own words (H4).
import {
  CANDIDATE_GROUPS,
  COVERAGE_BASES,
  COVERAGE_SCOPES,
  EDITABILITY_STATES,
  FRESHNESS_SOURCES,
  HEALTH_STATES,
  INCLUSION_STATES,
  METADATA_FORMATS,
  PREPARATION_STATES,
  PROJECT_TYPES,
  SELECTION_STATES,
  SETUP_STATES,
  VERSION_RULES,
  WRITE_KINDS,
} from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { HEALTH_LABELS } from '../src/portfolio-labels';
import { IDENTIFIER_LABELS, WRITE_LABELS } from '../src/labels';

const schemaValues: Readonly<Record<string, readonly string[]>> = {
  project_type: PROJECT_TYPES,
  metadata_format: METADATA_FORMATS,
  'editability.state': EDITABILITY_STATES,
  'coverage.scope': COVERAGE_SCOPES,
  'coverage.basis': COVERAGE_BASES,
  'health.state': HEALTH_STATES,
  inclusion: INCLUSION_STATES,
  selection: SELECTION_STATES,
  group: CANDIDATE_GROUPS,
  'preparation.state': PREPARATION_STATES,
  'version.rule_applied': VERSION_RULES,
  'setup.state': SETUP_STATES,
  'freshness.source': FRESHNESS_SOURCES,
};

describe('#8: every identifier has its glossary words', () => {
  test('#8: there is a label map for every identifier with values, and for nothing else; CONTEXT.md holds the same list, checked against the schema in shared/test/catalog.test.ts', () => {
    expect(Object.keys(IDENTIFIER_LABELS).sort()).toEqual([...Object.keys(schemaValues), 'flavor'].sort());
  });

  test('#8: the translation details are named by their three fields', () => {
    expect(Object.keys(IDENTIFIER_LABELS.flavor!).sort()).toEqual(['audience', 'projectType', 'translationType']);
  });

  test.each(Object.entries(schemaValues))('#8: %s: the map covers exactly the schema\'s enumeration', (identifier, values) => {
    expect(Object.keys(IDENTIFIER_LABELS[identifier]!).sort()).toEqual([...values].sort());
  });

  test('#8: every write kind a receipt names has its word', () => {
    expect(Object.keys(WRITE_LABELS).sort()).toEqual([...WRITE_KINDS].sort());
  });

  test('#8: every label is words: not empty, not the identifier itself, starting with a capital or a lowercase phrase, with no emoji', () => {
    const all = [...Object.entries(IDENTIFIER_LABELS).flatMap(([identifier, map]) => Object.entries(map).map(([value, label]) => ({ identifier, value, label }))), ...Object.entries(WRITE_LABELS).map(([value, label]) => ({ identifier: 'write', value, label }))];
    for (const { identifier, value, label } of all) {
      expect(label.trim(), `${identifier}.${value}`).not.toBe('');
      if (value.includes('_')) expect(label, `${identifier}.${value}`).not.toContain(value);
      expect(/\p{Extended_Pictographic}/u.test(label), `${identifier}.${value}`).toBe(false);
      // Sentence case: no word after the first is capitalized unless it is a name (Door43, Bible, Testament, Stories, OBS, tC Admin, Scripture Burrito, Resource Container).
      const rest = label.split(/\s+/).slice(1).filter(word => /^[A-Z][a-z]/.test(word));
      expect(rest.filter(word => !/^(Door43|Door43's|Bible|Old|New|Testament|Open|Stories|Scripture|Burrito|Container|Admin|Admin's|Study)$/.test(word)), `${identifier}.${value}: ${label}`).toEqual([]);
    }
  });
});

describe('H4: health is never color alone', () => {
  test('H4: every health state has words of its own, so no two states read alike', () => {
    const labels = HEALTH_STATES.map(state => HEALTH_LABELS[state]);
    expect(labels.every(label => label.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(HEALTH_STATES.length);
  });
});
