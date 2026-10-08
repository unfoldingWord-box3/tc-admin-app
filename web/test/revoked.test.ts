// A project the manager lost write access to leaves the portfolio (A2, #14):
// the project a route names, the listeners the client tells, and the groups
// without the revoked projects.
import { describe, expect, test, vi } from 'vitest';
import { onPermissionDenied, projectKey, projectOfPath, reportPermissionDenied, withoutRevoked } from '../src/revoked';
import { projectOf } from './support/mounted';

describe('the project a route names', () => {
  test('A2: every project route names its project, decoded; any other route names none', () => {
    expect(projectOfPath('/api/projects/tc-admin-qa/id_tcai1633/imports')).toEqual({ owner: 'tc-admin-qa', repo: 'id_tcai1633' });
    expect(projectOfPath('/api/projects/bahtraku/Perjanjian-Baru-Pendau/preparations?x=1')).toEqual({ owner: 'bahtraku', repo: 'Perjanjian-Baru-Pendau' });
    expect(projectOfPath('/api/projects/a%20b/c%2Fd/uploads/plan')).toEqual({ owner: 'a b', repo: 'c/d' });
    expect(projectOfPath('/api/projects/o/r')).toEqual({ owner: 'o', repo: 'r' });
    expect(projectOfPath('/api/portfolio')).toBeNull();
    expect(projectOfPath('/api/projects/new')).toBeNull();
    expect(projectOfPath('/api/projects/%E0%A4%A/r')).toBeNull();
  });

  test('the owner is compared in any case, the repository as named', () => {
    expect(projectKey({ owner: 'BahtraKu', repo: 'id_tb1' })).toBe(projectKey({ owner: 'bahtraku', repo: 'id_tb1' }));
    expect(projectKey({ owner: 'bahtraku', repo: 'ID_TB1' })).not.toBe(projectKey({ owner: 'bahtraku', repo: 'id_tb1' }));
  });
});

describe('telling the portfolio', () => {
  test('A2: a refusal on a project route reaches every listener until it stops; one on any other route reaches none', () => {
    const heard = vi.fn<(project: { owner: string; repo: string }) => void>();
    const stop = onPermissionDenied(heard);
    reportPermissionDenied('/api/projects/o/r/releases', { owner: 'O', repo: 'r' });
    reportPermissionDenied('/api/portfolio', { owner: 'o', repo: 'r' });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith({ owner: 'o', repo: 'r' });
    stop();
    reportPermissionDenied('/api/projects/o/r/releases', { owner: 'o', repo: 'r' });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test('A2: a refusal that does not name the route\'s project (an import source\'s 403) reaches no listener', () => {
    const heard = vi.fn<(project: { owner: string; repo: string }) => void>();
    const stop = onPermissionDenied(heard);
    reportPermissionDenied('/api/projects/o/r/imports', { door43_status: 403 });
    reportPermissionDenied('/api/projects/o/r/imports', { owner: 'bahtraku', repo: 'id_tb1' });
    expect(heard).not.toHaveBeenCalled();
    reportPermissionDenied('/api/projects/o/r/imports', { owner: 'o', repo: 'r' });
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('robustness', () => {
  test('A2: a listener that throws neither stops the others nor escapes to the caller', () => {
    const heard = vi.fn<(project: { owner: string; repo: string }) => void>();
    const stopThrowing = onPermissionDenied(() => {
      throw new Error('a broken listener');
    });
    const stop = onPermissionDenied(heard);
    expect(() => reportPermissionDenied('/api/projects/o/r/releases', { owner: 'o', repo: 'r' })).not.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    stopThrowing();
  });

  test('two projects whose names would join to the same text keep different keys', () => {
    expect(projectKey({ owner: 'a/b', repo: 'c' })).not.toBe(projectKey({ owner: 'a', repo: 'b/c' }));
  });
});

describe('the portfolio without the revoked projects', () => {
  test('A2: a revoked project is dropped, its owner\'s group too when it held only that project; nothing changes without a revocation', () => {
    const groups = [
      { name: 'bahtraku', projects: [projectOf('bahtraku', 'id_tb1', 'bible'), projectOf('bahtraku', 'Perjanjian-Baru-Pendau', 'bible')] },
      { name: 'tc-admin-qa', projects: [projectOf('tc-admin-qa', 'id_tcai1633', 'bible')] },
    ];
    const revoked = new Set([projectKey({ owner: 'Bahtraku', repo: 'id_tb1' }), projectKey({ owner: 'tc-admin-qa', repo: 'id_tcai1633' })]);
    expect(withoutRevoked(groups, revoked).map(group => [group.name, group.projects.map(project => project.ref.repo)])).toEqual([['bahtraku', ['Perjanjian-Baru-Pendau']]]);
    expect(withoutRevoked(groups, new Set())).toEqual(groups);
  });
});
