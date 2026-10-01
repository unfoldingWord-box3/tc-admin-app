// Door43's health severity to a health state (domain model §5, E15, Q21),
// carried over from the prototype. A pure mapping: Door43 decides the result
// (H1), and anything other than a known severity is `never_checked`, never
// `healthy` (H3). The states that need more than a severity (`checking`,
// `door43_unavailable`, `health_error`, `unsupported`) are #25 and #36.

import type { HealthState } from '@tc-admin/shared/schema';

const STATE_BY_SEVERITY: Readonly<Record<string, HealthState>> = {
  success: 'healthy',
  info: 'info',
  warning: 'warning',
  error: 'failing',
};

export function healthFromSeverity(severity: string | null | undefined): HealthState {
  return (severity && STATE_BY_SEVERITY[severity]) || 'never_checked';
}
