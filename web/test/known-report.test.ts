// A live read made before Door43's catalog has read a new project, or its latest
// commit, answers "no metadata" (E28, E45); it does not erase what tC Admin just
// wrote and reported (bench round 2 on #141, #26).
import { describe, expect, test } from 'vitest';
import { ProjectReport } from '@tc-admin/shared/schema';
import { withKnownClassification } from '../src/known-report';
import { projectOf } from './support/mounted';

const created = ProjectReport.parse({
  ...projectOf('tc-admin-qa', 'id_tcai1633', 'bible'),
  coverage: { present: 0, target: 27, scope: 'nt', basis: 'archive', units: [] },
  health: { state: 'never_checked', severity_raw: null, ref: 'master', checked_at: null, issue_count: null, issues: null, source: 'door43' },
  latest_full_release: null,
  default_branch_head: { sha: 'a'.repeat(40), committed_at: '2026-10-08T12:00:00Z' },
  active_preparation: null,
  setup: { state: 'complete', failed_step: null },
  freshness: { read_at: '2026-10-08T12:00:00Z', source: 'live', age_seconds: 0 },
});
const notYetRead = ProjectReport.parse({
  ...created,
  project_type: 'other',
  metadata_format: 'none',
  editability: { state: 'unsupported', reason: 'Door43 found no project metadata it recognizes. Release and editing are not available.' },
  coverage: { present: null, target: null, scope: 'unknown', basis: 'catalog', units: [] },
  health: { state: 'checking', severity_raw: null, ref: 'master', checked_at: '2026-10-08T12:00:05Z', issue_count: null, issues: null, source: 'door43' },
  freshness: { read_at: '2026-10-08T12:00:05Z', source: 'live', age_seconds: 0 },
});

describe('#26: a read before the catalog has caught up', () => {
  test('E28, E45: a known Scripture Burrito project read as "no metadata" keeps its type, format, editability, and coverage; the rest is the read\'s', () => {
    const { report, catalogPending } = withKnownClassification(created, notYetRead);
    expect(catalogPending).toBe(true);
    expect(report).toMatchObject({ project_type: 'bible', metadata_format: 'sb', editability: { state: 'editable' }, coverage: created.coverage });
    expect(report.health).toEqual(notYetRead.health);
    expect(report.freshness).toEqual(notYetRead.freshness);
  });

  test('H1: a read that says something definite is taken whole: Door43 reads another format, or the view knew nothing better', () => {
    const otherFormat = ProjectReport.parse({ ...notYetRead, metadata_format: 'rc', project_type: 'bible' });
    expect(withKnownClassification(created, otherFormat)).toEqual({ report: otherFormat, catalogPending: false });
    const known = withKnownClassification(created, created);
    expect(known).toEqual({ report: created, catalogPending: false });
    expect(withKnownClassification(notYetRead, notYetRead)).toEqual({ report: notYetRead, catalogPending: false });
  });
});
