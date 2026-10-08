// What a live read may and may not replace (#26, bench round 2 on #141). Door43's
// catalog reads a new repository, or a new commit, a few seconds after it is made
// (E28, E45), so a `project.read` just after a creation or an upload can answer
// "no metadata Door43 recognizes" for a project tC Admin has just written as
// Scripture Burrito. The receipt knew better: it reported what was written. A
// read that says only that the catalog has not caught up keeps the known
// classification (type, format, editability, coverage) and takes everything else
// from the read; a read that says something definite about the format, Door43
// having read the repository, is taken whole. Pure.

import type { ProjectReport, ProjectSummary } from '@tc-admin/shared/schema';

/** The read, with the known classification kept while Door43's catalog has not read the project yet. */
export function withKnownClassification(known: ProjectSummary | ProjectReport, read: ProjectReport): { report: ProjectReport; catalogPending: boolean } {
  const knewScriptureBurrito = known.metadata_format === 'sb' && known.editability.state === 'editable';
  const catalogPending = knewScriptureBurrito && read.metadata_format === 'none';
  if (!catalogPending) return { report: read, catalogPending: false };
  return {
    report: { ...read, project_type: known.project_type, metadata_format: known.metadata_format, editability: known.editability, coverage: known.coverage },
    catalogPending: true,
  };
}
