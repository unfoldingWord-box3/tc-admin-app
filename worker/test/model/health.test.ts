// Door43 severity to health state; the prototype's health tests, carried over (#7).
import { HEALTH_STATES } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import { healthFromSeverity } from '../../src/model/health';

describe('health from the Door43 severity (E15)', () => {
  test('H1: each Door43 severity maps to its own state, and an error is failing', () => {
    expect(['success', 'info', 'warning', 'error'].map(healthFromSeverity)).toEqual(['healthy', 'info', 'warning', 'failing']);
  });

  test('H3: a missing or unknown severity is never_checked, never healthy', () => {
    for (const severity of [null, undefined, '', 'unknown', 'SUCCESS']) expect(healthFromSeverity(severity)).toBe('never_checked');
  });

  test('every mapped value is a health state identifier', () => {
    for (const severity of ['success', 'info', 'warning', 'error', null]) expect(HEALTH_STATES).toContain(healthFromSeverity(severity));
  });
});
