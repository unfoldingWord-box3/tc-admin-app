// One project's report, from the portfolio's summary (`#/<owner>/<repo>`) or
// the report the creation receipt carries. Health is text, never color alone
// (H4), and unknown coverage reads as unknown (H3). The full project report
// (`project.read`) is #25.

import type { ProjectSummary } from '@tc-admin/shared/schema';
import { useState } from 'react';
import { coverageLabel, healthLabel, releaseHash, releaseTagHash, typeLabel } from './portfolio-labels';

export function ProjectView({ project }: { project: ProjectSummary }) {
  const { coverage } = project;
  const [tag, setTag] = useState('');
  return (
    <section>
      <p>
        <a href="#">All projects</a>
      </p>
      <h2>{project.title}</h2>
      <p className="muted">
        {project.ref.owner}/{project.ref.repo} ·{' '}
        <a href={project.ref.url} target="_blank" rel="noreferrer">
          View on Door43
        </a>
      </p>
      <dl className="report">
        <dt>Project type</dt>
        <dd>{typeLabel(project.project_type)}</dd>
        <dt>Language</dt>
        <dd>{[project.language.title, project.language.code].filter(Boolean).join(' · ') || 'Not stated'}</dd>
        <dt>Coverage</dt>
        <dd>{coverageLabel(project)}</dd>
        <dt>Health</dt>
        <dd>{healthLabel(project.health.state)}</dd>
      </dl>
      <p className="actions">
        <a className="button" href={releaseHash(project)}>
          Prepare a release
        </a>
      </p>
      <form
        className="actions"
        onSubmit={event => {
          event.preventDefault();
          if (tag.trim()) window.location.assign(releaseTagHash(project, tag.trim()));
        }}
      >
        <label className="field" htmlFor="release-tag">
          A release by its tag, to see it or promote a pre-release
          <input id="release-tag" value={tag} onChange={event => setTag(event.target.value)} placeholder="v1.3.0" />
        </label>
        <button type="submit" className="secondary" disabled={!tag.trim()}>
          Open the release
        </button>
      </form>
      {coverage.units.length > 0 && (
        <ul className="units" aria-label="Books and stories in scope">
          {coverage.units.map(unit => (
            <li key={unit.id} className={unit.present ? 'present' : 'absent'}>
              {unit.id.toUpperCase()} <span className="muted">{unit.present ? 'present' : 'not present'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
