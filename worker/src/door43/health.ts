// The Door43 health check of one ref (E15, E28): `GET /repos/{owner}/{repo}/
// healthcheck?ref=`, read once per call. Door43 runs the check on every push
// and tag; there is no trigger. The 422 "no metadata found" for a ref it has
// not checked is a pending read, not an error; a result's issues are kept as
// Door43 wrote them, for the manager (H2). Door43's shapes stop here.

import { CatalogError } from '@tc-admin/shared/schema';
import type { HealthIssue } from '@tc-admin/shared/schema';
import type { HealthRead } from '../model/health';
import { door43Request } from './api';
import type { Door43Client } from './api';

/** The answer: `{ ok, data }` on 200, `{ ok: false, error }` on 422 (E15). */
interface Door43HealthAnswer {
  ok?: unknown;
  error?: unknown;
  data?: Door43HealthResult | null;
}

/** The `data` of a 200 answer (E15). */
interface Door43HealthResult {
  issues?: Record<string, Door43HealthIssue[] | null> | null;
  overall_severity_level?: unknown;
  severity_level_count?: Record<string, number>;
}

interface Door43HealthIssue {
  issue_code?: unknown;
  rule?: unknown;
  severity_level?: unknown;
  positive_title?: unknown;
  negative_title?: unknown;
  details?: unknown;
  suggestion?: unknown;
}

const PENDING = /no metadata found/i;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Every issue Door43 listed, in tC Admin's field names, in the order Door43 gave them. */
function issuesOf(result: Door43HealthResult): HealthIssue[] {
  return Object.entries(result.issues ?? {}).flatMap(([code, list]) =>
    (list ?? []).map(issue => ({
      code: text(issue.issue_code) || code,
      rule: typeof issue.rule === 'string' && issue.rule ? issue.rule : null,
      severity: text(issue.severity_level),
      title: text(issue.negative_title) || text(issue.positive_title),
      details: text(issue.details),
      suggestion: text(issue.suggestion),
    })),
  );
}

/**
 * One read of the health check for `ref`. A 422 "no metadata found" is pending; a
 * network failure or a 5xx is unavailable; 401 is `session_expired`; any other answer,
 * or one without a severity, is an error the read reports rather than a result.
 */
export async function readHealth(client: Door43Client, owner: string, repo: string, ref: string): Promise<HealthRead> {
  const url = new URL(`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/healthcheck`, client.host.origin);
  url.searchParams.set('ref', ref);
  let response: Response;
  try {
    response = await door43Request(client.host, url.href, { headers: { accept: 'application/json', authorization: `Bearer ${client.token}` } }, client.fetch);
  } catch (error) {
    if (error instanceof CatalogError && error.code === 'door43_unavailable') return { kind: 'unavailable', reason: String(error.details.reason ?? 'Door43 could not be reached') };
    throw error;
  }
  if (response.status === 401) throw new CatalogError('session_expired', { details: { door43_status: 401 } });
  if (response.status >= 500) return { kind: 'unavailable', reason: `Door43 answered ${response.status}` };
  let body: Door43HealthAnswer | null;
  try {
    body = (await response.json()) as Door43HealthAnswer | null;
  } catch {
    return { kind: 'error', reason: 'the health check answer was not JSON', status: response.status };
  }
  if (response.status === 422 && PENDING.test(text(body?.error))) return { kind: 'pending' };
  if (response.status !== 200 || body?.ok !== true || !body.data) return { kind: 'error', reason: text(body?.error) || `Door43 answered ${response.status}`, status: response.status };
  const severity = body.data.overall_severity_level;
  if (typeof severity !== 'string' || !severity) return { kind: 'error', reason: 'the health check answer named no severity', status: response.status };
  return { kind: 'result', severity, issues: issuesOf(body.data) };
}
