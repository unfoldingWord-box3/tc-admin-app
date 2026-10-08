// A project the manager lost write access to leaves the portfolio (A2, #14).
// The Worker re-reads the push permission before every mutation and answers
// `permission_denied` when it is gone; whichever view made the call shows the
// refusal in place, and the client tells the portfolio here, by the project
// the route names, so the project is dropped from the list without every view
// carrying a callback. Pure functions and an in-memory list of listeners, as
// the CSRF token is kept (A4): nothing is stored, and a reload reads the
// portfolio from Door43 again.

/** A project as the portfolio keys it. */
export interface ProjectKey {
  owner: string;
  repo: string;
}

/** The key the portfolio compares by: the owner in any case (Door43's logins are case-insensitive), the repository as named. */
export const projectKey = (project: ProjectKey): string => `${project.owner.toLowerCase()}/${project.repo}`;

/** The project a route names, `/api/projects/<owner>/<repo>[/…]`; `null` for any other route. */
export function projectOfPath(url: string): ProjectKey | null {
  const path = url.split(/[?#]/)[0]!;
  const match = /^\/api\/projects\/([^/]+)\/([^/]+)(?:\/|$)/.exec(path);
  if (!match) return null;
  try {
    return { owner: decodeURIComponent(match[1]!), repo: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}

type Listener = (project: ProjectKey) => void;
const listeners = new Set<Listener>();

/** Listens for projects the Worker refused for permission; returns the way to stop. */
export function onPermissionDenied(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tells every listener that the route's project was refused for permission,
 * only when the refusal's details name that same project: a refusal of another
 * repository the operation read (an import's source, whose 403 carries only
 * `door43_status`) is not the project's push right, and tells nobody. A route
 * that names no project tells nobody.
 */
export function reportPermissionDenied(url: string, details: Readonly<Record<string, unknown>>): void {
  const project = projectOfPath(url);
  if (!project) return;
  const { owner, repo } = details;
  if (typeof owner !== 'string' || typeof repo !== 'string' || projectKey({ owner, repo }) !== projectKey(project)) return;
  for (const listener of [...listeners]) listener(project);
}

/** The groups without the revoked projects, and without a group left empty by them. */
export function withoutRevoked<Group extends { projects: readonly { ref: ProjectKey }[] }>(groups: readonly Group[], revoked: ReadonlySet<string>): Group[] {
  if (revoked.size === 0) return [...groups];
  return groups.flatMap(group => {
    const projects = group.projects.filter(project => !revoked.has(projectKey(project.ref)));
    if (projects.length === 0 && group.projects.length > 0) return [];
    return [{ ...group, projects }];
  });
}
