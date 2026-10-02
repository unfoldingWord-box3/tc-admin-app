// The portfolio's words for a project summary's identifiers (CONTEXT.md).
import { HEALTH_STATES } from '@tc-admin/shared/schema';
import type { Coverage } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { canOpen, coverageLabel, formatLabel, hashRef, healthLabel, projectHash, typeLabel } from '../src/portfolio-labels';

const coverage = (extra: Partial<Coverage>): Coverage => ({ present: 0, target: 27, scope: 'nt', basis: 'catalog', units: [], ...extra });

describe('coverage', () => {
  test('H5: books or stories present against the testament-scope target', () => {
    expect(coverageLabel({ project_type: 'bible', coverage: coverage({ present: 27 }) })).toBe('27 of 27 books · New Testament');
    expect(coverageLabel({ project_type: 'bible', coverage: coverage({ present: 3, target: 66, scope: 'full' }) })).toBe('3 of 66 books · Old and New Testament');
    expect(coverageLabel({ project_type: 'obs', coverage: coverage({ present: 12, target: 50, scope: 'obs' }) })).toBe('12 of 50 stories · Open Bible Stories');
  });

  test('H3: unknown coverage reads as unknown, never as zero or complete', () => {
    expect(coverageLabel({ project_type: 'obs', coverage: coverage({ present: null, target: 50, scope: 'obs' }) })).toBe('Coverage unknown');
    expect(coverageLabel({ project_type: 'bible', coverage: coverage({ present: null, target: null, scope: 'unknown' }) })).toBe('Coverage unknown');
  });

  test('a type tC Admin does not manage shows no coverage', () => {
    expect(coverageLabel({ project_type: 'other', coverage: coverage({ present: null, target: null, scope: 'unknown' }) })).toBe('');
  });
});

describe('labels', () => {
  test('H3: every health state has its own text, and only healthy reads as Healthy', () => {
    const labels = HEALTH_STATES.map(healthLabel);
    expect(new Set(labels).size).toBe(HEALTH_STATES.length);
    expect(HEALTH_STATES.filter(state => healthLabel(state) === 'Healthy')).toEqual(['healthy']);
  });

  test('types and formats use the glossary names', () => {
    expect([typeLabel('bible'), typeLabel('obs')]).toEqual(['Bible', 'Open Bible Stories']);
    expect([formatLabel('sb'), formatLabel('rc'), formatLabel('ts'), formatLabel('tc')]).toEqual(['Scripture Burrito', 'Resource Container', 'translationStudio', 'translationCore']);
  });
});

describe('opening a project', () => {
  test('P1: only an editable project opens; an unsupported one does not', () => {
    expect(canOpen({ editability: { state: 'editable', reason: '' } })).toBe(true);
    expect(canOpen({ editability: { state: 'unsupported', reason: '' } })).toBe(false);
  });

  test('the address names the open project and reads back', () => {
    const hash = projectHash({ ref: { owner: 'team a', repo: 'en/obs', id: 1, url: '' } });
    expect(hash).toBe('#/team%20a/en%2Fobs');
    expect(hashRef(hash)).toEqual({ owner: 'team a', repo: 'en/obs' });
    expect(hashRef('')).toBeNull();
    expect(hashRef('#/only-owner')).toBeNull();
    expect(hashRef('#/%E0%A4/x')).toBeNull();
  });
});
