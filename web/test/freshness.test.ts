// How old what is shown is (P3, #26): the age in words, and the freshness
// line that says where a reading came from, when, and how long ago.
import { describe, expect, test } from 'vitest';
import { ageLabel, freshnessLabel } from '../src/freshness';

const T = Date.parse('2026-10-08T12:00:00.000Z');
const at = (msBefore: number) => new Date(T - msBefore).toISOString();

describe('the age', () => {
  test('P3: a reading reads as just now, then minutes, hours, and days ago', () => {
    expect(ageLabel(at(0), T)).toBe('just now');
    expect(ageLabel(at(44_000), T)).toBe('just now');
    expect(ageLabel(at(60_000), T)).toBe('1 minute ago');
    expect(ageLabel(at(3 * 60_000), T)).toBe('3 minutes ago');
    expect(ageLabel(at(60 * 60_000), T)).toBe('1 hour ago');
    expect(ageLabel(at(5 * 60 * 60_000), T)).toBe('5 hours ago');
    expect(ageLabel(at(48 * 60 * 60_000), T)).toBe('2 days ago');
  });

  test('a time in the future is just now, and a time that is not one is unknown, never "just now"', () => {
    expect(ageLabel(at(-60_000), T)).toBe('just now');
    expect(ageLabel('not a time', T)).toBe('at an unknown time');
  });
});

describe('the freshness line', () => {
  test('P3: a live reading says Door43 and its age; a cached one says it is tC Admin\'s copy and counts its age from when the cache read it', () => {
    expect(freshnessLabel({ read_at: at(3 * 60_000), source: 'live', age_seconds: 0 }, T)).toMatch(/^Read from Door43 at .+ · 3 minutes ago\.$/);
    expect(freshnessLabel({ read_at: at(60_000), source: 'cache', age_seconds: 600 }, T)).toMatch(/^Read from tC Admin's copy of Door43 at .+ · 11 minutes ago\.$/);
  });
});
