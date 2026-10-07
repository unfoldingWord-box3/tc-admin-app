// The draft of a release's notes (#38, product spec §10): what was added,
// revised, removed, and carried forward, the unknown files included, the
// version, and the source commit, in markdown for Door43's release page. The
// manager reviews and edits it before the release is created. Pure.

export interface NamedUnit {
  id: string;
  /** Door43's title for the book or story; empty when it gives none. */
  title: string;
}

export interface NotesInput {
  owner: string;
  repo: string;
  version: string;
  baseline_tag: string | null;
  source: { branch: string; sha: string };
  /** `books` for a Bible, `stories` for Open Bible Stories. */
  units: 'books' | 'stories';
  added: readonly NamedUnit[];
  revised: readonly NamedUnit[];
  removed: readonly NamedUnit[];
  carried_forward: readonly NamedUnit[];
  unknown_included: readonly string[];
}

const name = (unit: NamedUnit) => (unit.title ? `${unit.title} (${unit.id.toUpperCase()})` : unit.id.toUpperCase());
const list = (units: readonly NamedUnit[]) => (units.length ? units.map(unit => `- ${name(unit)}`).join('\n') : '- None');

export function releaseNotesDraft(input: NotesInput): string {
  const carried = input.carried_forward.length ? `${input.carried_forward.length} ${input.units} unchanged from ${input.baseline_tag ?? 'the previous release'}: ${input.carried_forward.map(unit => unit.id.toUpperCase()).join(', ')}` : 'None';
  const unknown = input.unknown_included.length ? input.unknown_included.map(path => `- ${path}`).join('\n') : '- None';
  return [
    `## ${input.repo} ${input.version}`,
    '',
    `Source: ${input.owner}/${input.repo} at ${input.source.sha.slice(0, 10)} on ${input.source.branch}.`,
    input.baseline_tag ? `Previous release: ${input.baseline_tag}.` : 'First release.',
    '',
    '### Added',
    list(input.added),
    '',
    '### Revised',
    list(input.revised),
    '',
    '### Removed',
    list(input.removed),
    '',
    '### Carried forward',
    carried,
    '',
    '### Unknown files included',
    unknown,
    '',
  ].join('\n');
}
