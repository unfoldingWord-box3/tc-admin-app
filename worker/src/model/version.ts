// The version rules (R9, domain model §7, Q19): the baseline is the latest full
// release tag on Door43, whichever tool made it, coerced to semver; no release,
// a bare year such as `1974`, or a tag that is not a version at all has no
// semantic baseline and yields `v1.0.0`. A released book left out is a major
// increment, a new book a minor one, a revision or metadata-only change a patch,
// the highest wins. Pure.

import type { VersionRule } from '@tc-admin/shared/schema';

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** A tag with a leading `v`, one to three dotted numbers: `v1.2`, `v105`, `1.2.3`. A bare number without a `v` is a year, not a version (Q19). */
const LOOSE_VERSION = /^(v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

/** The tag as semver, coerced: `v105` is 105.0.0, `v1.2` is 1.2.0; `null` when the tag is a bare year or no version. */
export function parseVersion(tag: string): Semver | null {
  const match = LOOSE_VERSION.exec(tag.trim());
  if (!match) return null;
  const [, v, major, minor, patch] = match;
  // Digits alone, without a `v` or a dot, are a bare year such as `1974` (E9, Q19).
  if (!v && minor === undefined) return null;
  return { major: Number(major), minor: Number(minor ?? 0), patch: Number(patch ?? 0) };
}

export const formatVersion = (version: Semver): string => `v${version.major}.${version.minor}.${version.patch}`;

/** Negative when `a` is before `b`, zero when equal, positive after. */
export function compareVersions(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** What a selection changes against the baseline, for the increment. */
export interface Changes {
  /** A released unit left out (R2): a consumer loses it. */
  removed: boolean;
  /** A new unit included. */
  added: boolean;
  /** A changed released unit included; otherwise the release is metadata only, which is also a patch. */
  revised: boolean;
}

export interface Proposal {
  baseline_tag: string | null;
  proposed: string;
  rule_applied: VersionRule;
}

/** The proposed version for a release on top of the baseline (R9). */
export function proposeVersion(baselineTag: string | null, changes: Changes): Proposal {
  const baseline = baselineTag === null ? null : parseVersion(baselineTag);
  if (!baseline) return { baseline_tag: baselineTag, proposed: 'v1.0.0', rule_applied: 'first' };
  if (changes.removed) return { baseline_tag: baselineTag, proposed: formatVersion({ major: baseline.major + 1, minor: 0, patch: 0 }), rule_applied: 'removal' };
  if (changes.added) return { baseline_tag: baselineTag, proposed: formatVersion({ major: baseline.major, minor: baseline.minor + 1, patch: 0 }), rule_applied: 'new_books' };
  return { baseline_tag: baselineTag, proposed: formatVersion({ ...baseline, patch: baseline.patch + 1 }), rule_applied: 'revisions' };
}
