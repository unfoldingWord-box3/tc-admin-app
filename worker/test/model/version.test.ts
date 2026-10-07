// The version rules (R9, #37): loose tags coerced, bare years and no release
// baselined at v1.0.0, and the increment by what the selection changes.
import { describe, expect, test } from 'vitest';
import { compareVersions, formatVersion, parseVersion, proposeVersion } from '../../src/model/version';

const none = { removed: false, added: false, revised: false };

describe('coercion', () => {
  test('R9: loose tags are coerced to semver; a bare year or no version has no baseline (Q19, E9)', () => {
    expect(parseVersion('v105')).toEqual({ major: 105, minor: 0, patch: 0 });
    expect(parseVersion('v1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
    expect(parseVersion(' v2 ')).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseVersion('1974')).toBeNull();
    expect(parseVersion('2')).toBeNull();
    expect(parseVersion('release-2020')).toBeNull();
    expect(parseVersion('')).toBeNull();
    // Semver build metadata does not order versions; the baseline keeps its numbers.
    expect(parseVersion('v2.4.5+build.7')).toEqual({ major: 2, minor: 4, patch: 5 });
    expect(parseVersion('1974+build')).toBeNull();
    expect(parseVersion('v2.4.5+')).toBeNull();
    expect(formatVersion({ major: 1, minor: 2, patch: 0 })).toBe('v1.2.0');
    expect(compareVersions({ major: 1, minor: 2, patch: 1 }, { major: 1, minor: 2, patch: 0 })).toBeGreaterThan(0);
    expect(compareVersions({ major: 1, minor: 10, patch: 0 }, { major: 1, minor: 9, patch: 9 })).toBeGreaterThan(0);
    expect(compareVersions({ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 0, patch: 0 })).toBe(0);
  });
});

describe('the proposal', () => {
  test.each([
    ['no release', null, none, 'v1.0.0', 'first'],
    ['a bare year, 1974 (id_tb1, E9)', '1974', { ...none, added: true }, 'v1.0.0', 'first'],
    ['a tag that is no version', 'release-2020', { ...none, revised: true }, 'v1.0.0', 'first'],
    ['v1.2 with a revision only (Pendau, E9)', 'v1.2', { ...none, revised: true }, 'v1.2.1', 'revisions'],
    ['v1.2 with a new book', 'v1.2', { ...none, added: true }, 'v1.3.0', 'new_books'],
    ['v1.2 with a new book and a revision: the higher wins', 'v1.2', { ...none, added: true, revised: true }, 'v1.3.0', 'new_books'],
    ['v1.2 with a released book left out: a consumer loses a book (ADR 0013)', 'v1.2', { removed: true, added: true, revised: true }, 'v2.0.0', 'removal'],
    ['v105 with a new book', 'v105', { ...none, added: true }, 'v105.1.0', 'new_books'],
    ['v1.2.3 with nothing included: metadata only, a patch', 'v1.2.3', none, 'v1.2.4', 'revisions'],
    ['v2.4.5+build.7 with a revision: build metadata keeps the baseline', 'v2.4.5+build.7', { ...none, revised: true }, 'v2.4.6', 'revisions'],
  ])('R9: %s', (_case, baseline, changes, proposed, rule) => {
    expect(proposeVersion(baseline, changes)).toEqual({ baseline_tag: baseline, proposed, rule_applied: rule });
  });
});
