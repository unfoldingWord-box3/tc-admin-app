// How old what is shown is (P3, #26, architecture §4 "stale data must be
// labeled"): every operation output carries its `freshness`, and the interface
// says when it was read and how long ago, so a manager never mistakes an old
// reading for the current state. Pure.

import type { Freshness } from '@tc-admin/shared/schema';

/** The age of a reading in words, from its time and `now`: "just now", "1 minute ago", "3 hours ago". */
export function ageLabel(readAt: string, now: number): string {
  const read = new Date(readAt).getTime();
  if (Number.isNaN(read)) return 'at an unknown time';
  const seconds = Math.max(0, Math.floor((now - read) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * The freshness line: where the reading came from, when, and its age. A reading from tC Admin's cache says so (P3);
 * its age counts from when the cache read it, which `age_seconds` adds to.
 */
export function freshnessLabel(freshness: Freshness, now: number): string {
  const read = new Date(freshness.read_at).getTime() - (freshness.source === 'cache' ? freshness.age_seconds * 1000 : 0);
  const at = Number.isNaN(read) ? null : new Date(read);
  const source = freshness.source === 'cache' ? "Read from tC Admin's copy of Door43" : 'Read from Door43';
  return `${source}${at ? ` at ${at.toLocaleTimeString()}` : ''} · ${ageLabel(at ? at.toISOString() : freshness.read_at, now)}.`;
}
