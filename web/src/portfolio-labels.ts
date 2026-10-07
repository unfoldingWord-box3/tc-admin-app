// The portfolio's words: how a project summary's identifiers read in the
// interface, in glossary language (CONTEXT.md). Health is always text, never
// color alone, and unknown health or coverage never reads as good or as zero
// (H3).

import type { Coverage, HealthState, MetadataFormat, ProjectSummary, ProjectType } from '@tc-admin/shared/schema';

const TYPE_LABELS: Readonly<Record<ProjectType, string>> = {
  bible: 'Bible',
  obs: 'Open Bible Stories',
  other: 'Other type',
};

const FORMAT_LABELS: Readonly<Record<MetadataFormat, string>> = {
  sb: 'Scripture Burrito',
  rc: 'Resource Container',
  ts: 'translationStudio',
  tc: 'translationCore',
  none: 'No recognized metadata',
};

/** The health states of product spec §5. */
const HEALTH_LABELS: Readonly<Record<HealthState, string>> = {
  healthy: 'Healthy',
  info: 'Information',
  warning: 'Warning',
  failing: 'Failing',
  never_checked: 'Never checked',
  checking: 'Health check running',
  door43_unavailable: 'Door43 unavailable',
  health_error: 'Unexpected health-check error',
  unsupported: 'Unsupported project type',
};

const SCOPE_LABELS: Readonly<Record<Coverage['scope'], string>> = {
  nt: 'New Testament',
  ot: 'Old Testament',
  full: 'Old and New Testament',
  obs: 'Open Bible Stories',
  unknown: '',
};

export const typeLabel = (type: ProjectType) => TYPE_LABELS[type];
export const formatLabel = (format: MetadataFormat) => FORMAT_LABELS[format];
export const healthLabel = (state: HealthState) => HEALTH_LABELS[state];

/** Coverage as books or stories present against the target; empty for a type tC Admin does not manage. */
export function coverageLabel(project: Pick<ProjectSummary, 'project_type' | 'coverage'>): string {
  if (project.project_type === 'other') return '';
  const { present, target, scope } = project.coverage;
  const unit = project.project_type === 'obs' ? 'stories' : 'books';
  if (present === null) return 'Coverage unknown';
  if (target === null) return `${present} ${unit}`;
  return `${present} of ${target} ${unit} · ${SCOPE_LABELS[scope]}`;
}

/** Only an editable project can be opened; an unsupported one shows its reason instead (P1). */
export const canOpen = (project: Pick<ProjectSummary, 'editability'>) => project.editability.state === 'editable';

/** A project's address in the interface, `#/<owner>/<repo>`, so a reload keeps the project open. */
export const projectHash = (project: Pick<ProjectSummary, 'ref'>) => `#/${encodeURIComponent(project.ref.owner)}/${encodeURIComponent(project.ref.repo)}`;

/** The owner and repository a hash names, or `null`. */
export const releaseHash = (project: Pick<ProjectSummary, 'ref'>) => `${projectHash(project)}/release`;

export function hashRef(hash: string): { owner: string; repo: string; view: 'project' | 'release' } | null {
  const match = /^#\/([^/]+)\/([^/]+)(\/release)?$/.exec(hash);
  if (!match) return null;
  try {
    return { owner: decodeURIComponent(match[1]!), repo: decodeURIComponent(match[2]!), view: match[3] ? 'release' : 'project' };
  } catch {
    return null;
  }
}
