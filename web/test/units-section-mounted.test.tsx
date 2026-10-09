// @vitest-environment jsdom
// The project's books or stories, a section of their own (#158): after the
// release preparations, under "Books in this project" or "Stories in this
// project", each with "present" or "not present". Coverage Door43's catalog
// does not itemize says so under the heading; it never reads as none (H5).
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProjectReport } from '@tc-admin/shared/schema';
import { forgetCsrfToken } from '../src/api/client';
import { ProjectView } from '../src/ProjectView';
import { freshness, heldWorker, projectOf } from './support/mounted';

let worker: ReturnType<typeof heldWorker>;

beforeEach(() => {
  worker = heldWorker();
  vi.stubGlobal('fetch', worker.fetch);
  forgetCsrfToken();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reportOf = (summary: ReturnType<typeof projectOf>, coverage: ProjectReport['coverage']): ProjectReport =>
  ProjectReport.parse({
    ...summary,
    coverage,
    health: { state: 'healthy', severity_raw: 'success', ref: 'master', checked_at: freshness.read_at, issue_count: 0, issues: [], source: 'door43' },
    latest_full_release: null,
    default_branch_head: { sha: '2'.repeat(40), committed_at: freshness.read_at },
    active_preparation: null,
    setup: { state: 'complete', failed_step: null },
    freshness,
  });

async function opened(summary: ReturnType<typeof projectOf>, coverage: ProjectReport['coverage']) {
  const { owner, repo } = summary.ref;
  render(<ProjectView project={summary} onFailure={() => {}} />);
  await worker.answer('GET', `/api/projects/${owner}/${repo}`, reportOf(summary, coverage));
  await worker.answer('GET', `/api/projects/${owner}/${repo}/preparations`, { preparations: [], freshness });
}

describe('#158: the project\'s books or stories have a section of their own', () => {
  test('#158: a Bible lists its books under "Books in this project", after the release preparations and outside them, each present or not', async () => {
    const pendau = projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible');
    await opened(pendau, { present: 1, target: 2, scope: 'nt', basis: 'catalog', units: [{ id: 'mat', present: true }, { id: 'mrk', present: false }] });
    const section = screen.getByRole('region', { name: 'Books in this project' });
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe('Books in this project');
    expect(within(section).getAllByRole('listitem').map(item => item.textContent)).toEqual(['MAT present', 'MRK not present']);
    const preparations = screen.getByRole('region', { name: 'Release preparations' });
    expect(preparations.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A sibling, not inside the preparations (bench round 1 on #159).
    expect(preparations.contains(section)).toBe(false);
    expect(section.parentElement).toBe(preparations.parentElement);
  });

  test('#158, H5: Open Bible Stories whose stories Door43 does not itemize says so under "Stories in this project", never none', async () => {
    const stories = projectOf('tc-admin-qa-org', 'id_obs1948', 'obs');
    await opened(stories, { present: null, target: 50, scope: 'obs', basis: 'catalog', units: [] });
    const section = screen.getByRole('region', { name: 'Stories in this project' });
    expect(within(section).queryByRole('list')).toBeNull();
    expect(section.textContent).toContain("Door43's catalog does not list this project's stories, so which are present is not known.");
  });

  test('#158, H5: a Bible whose books Door43 does not list says so in its own words; one that counts none says it has none yet', async () => {
    const unknown = projectOf('bahtraku', 'id_unknown', 'bible');
    await opened(unknown, { present: null, target: 27, scope: 'nt', basis: 'catalog', units: [] });
    expect(screen.getByRole('region', { name: 'Books in this project' }).textContent).toContain("Door43's catalog does not list this project's books, so which are present is not known.");
    cleanup();
    // Door43 lists ingredients but no book: the count is a known 0, never "not known" (bench round 1 on #159).
    const empty = projectOf('bahtraku', 'id_empty', 'bible');
    await opened(empty, { present: 0, target: null, scope: 'unknown', basis: 'catalog', units: [] });
    const section = screen.getByRole('region', { name: 'Books in this project' });
    expect(section.textContent).toContain('No books are in this project yet.');
    expect(section.textContent).not.toContain('not known');
  });
});
