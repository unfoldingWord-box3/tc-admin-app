// Every identifier in CONTEXT.md "Identifiers" in its glossary words (#8,
// AGENTS.md rule 1: identifiers in code, glossary terms in the interface). The
// maps that already lived beside the screens that use them are gathered here
// with the ones no screen had yet, so one test holds every map to the
// schema's enumeration and to CONTEXT.md's list, and a new value cannot reach
// the interface as a raw identifier. Copy follows the design system rules:
// sentence case, no emoji (#8).

import type { CoverageBasis, EditabilityState, FreshnessSource, InclusionState, SetupState, VersionRule } from '@tc-admin/shared/schema';
import { DETAIL_LABELS, WRITE_LABELS } from './create-project';
import { FORMAT_LABELS, HEALTH_LABELS, SCOPE_LABELS, TYPE_LABELS } from './portfolio-labels';
import { GROUP_LABELS, SELECTION_LABELS, STATE_LABELS } from './release-stepper';

export const EDITABILITY_LABELS: Readonly<Record<EditabilityState, string>> = {
  editable: 'Editable',
  unsupported: 'Unsupported',
};

export const BASIS_LABELS: Readonly<Record<CoverageBasis, string>> = {
  catalog: "Counted from Door43's catalog",
  archive: "Counted from the project's files",
};

/** The content inclusion states (domain model §4): what a release does with each file. */
export const INCLUSION_LABELS: Readonly<Record<InclusionState, string>> = {
  unreleased: 'Not released yet',
  released: 'Released',
  changed_released: 'Changed since the last release',
  selected: 'Selected for this release',
  carried_forward: 'Carried forward',
  excluded: 'Left out',
  removed: 'Removed',
  administrative: 'Administrative file',
  unknown: 'Unknown file',
};

/** Why the calculated version is what it is (domain model §7, R9). */
export const VERSION_RULE_LABELS: Readonly<Record<VersionRule, string>> = {
  first: 'first release',
  removal: 'a book is removed, so a new major version',
  new_books: 'new books, so a new minor version',
  revisions: 'revisions only, so a new patch version',
};

export const SETUP_LABELS: Readonly<Record<SetupState, string>> = {
  complete: 'Setup complete',
  incomplete: 'Setup incomplete',
};

export const FRESHNESS_LABELS: Readonly<Record<FreshnessSource, string>> = {
  live: 'Read from Door43',
  cache: "Read from tC Admin's copy of Door43",
};

/** Each identifier CONTEXT.md lists with its values, by the identifier as written there, to the words the interface shows. */
export const IDENTIFIER_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  project_type: TYPE_LABELS,
  metadata_format: FORMAT_LABELS,
  'editability.state': EDITABILITY_LABELS,
  'coverage.scope': SCOPE_LABELS,
  flavor: DETAIL_LABELS,
  'coverage.basis': BASIS_LABELS,
  'health.state': HEALTH_LABELS,
  inclusion: INCLUSION_LABELS,
  selection: SELECTION_LABELS,
  group: GROUP_LABELS,
  'preparation.state': STATE_LABELS,
  'version.rule_applied': VERSION_RULE_LABELS,
  'setup.state': SETUP_LABELS,
  'freshness.source': FRESHNESS_LABELS,
};

export { WRITE_LABELS };
