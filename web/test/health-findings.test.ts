// Door43's health-check findings on the page (#124): the safe subset of
// Door43's Markdown and HTML over its recorded answers (E16, E60), the order
// of the findings, the summary above them, and the severity words (H4).
import type { Health, HealthIssue } from '@tc-admin/shared/schema';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { door43Href, door43Tokens, plainText } from '../src/door43-text';
import { HealthFindings } from '../src/HealthFindings';
import { findingsGate, findingsSummary, orderedIssues, severityBadge } from '../src/health-findings';

const QA = 'https://qa.door43.org';

// Door43's answers as recorded (E60: fixtures/door43/qa.door43.org/2026-10-07/obs-health/healthcheck-master-after-q32.json;
// E16: fixtures/door43/qa.door43.org/2026-09-21/healthcheck/, and the rehearsal's v1.2.1 branch, 2026-10-07/rehearsal/).
const STORIES_MISSING = 'The following stories are missing: **`05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50`**';
const NOT_LISTED = 'The following stories are not listed in the **`ingredients`** of metadata.json: **`04`**';
const ACTS = "The title for the project '**`act`**' is still in English: **`Acts`**";
const ACTS_SUGGESTION =
  'Edit the <a href="/bahtraku/Perjanjian-Baru-Pendau/src/branch/temp-tca-release/v1.2.1/metadata.json" target="_blank">metadata.json</a> file and translate the **`title`** of the projects. For example, translate **\'Acts\'** to the resource\'s language.';
const RELEASE_SUGGESTION = 'Fix all the errors above. Then make a release with <a href="https://gateway-admin.netlify.app/" target="_blank">gatewayAdmin</a>.';

const issue = (severity: string, code: string, title = code, details = '', suggestion = ''): HealthIssue => ({ code, rule: null, severity, title, details, suggestion });

describe("Door43's text (H1: displayed, never rewritten)", () => {
  test('H1: bold around code renders as bold code, with no asterisk or backtick left (E60)', () => {
    expect(door43Tokens(NOT_LISTED, QA)).toEqual([
      { kind: 'text', text: 'The following stories are not listed in the ' },
      { kind: 'bold', children: [{ kind: 'code', text: 'ingredients' }] },
      { kind: 'text', text: ' of metadata.json: ' },
      { kind: 'bold', children: [{ kind: 'code', text: '04' }] },
    ]);
    const missing = door43Tokens(STORIES_MISSING, QA);
    expect(missing).toHaveLength(2);
    expect(missing[1]).toEqual({ kind: 'bold', children: [{ kind: 'code', text: STORIES_MISSING.slice(STORIES_MISSING.indexOf('`') + 1, -3) }] });
    expect(plainText(missing)).toBe('The following stories are missing: 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50');
  });

  test("H1: the Acts warning keeps Door43's quotes around the bold code, and bold plain text is bold (E16)", () => {
    expect(door43Tokens(ACTS, QA)).toEqual([
      { kind: 'text', text: "The title for the project '" },
      { kind: 'bold', children: [{ kind: 'code', text: 'act' }] },
      { kind: 'text', text: "' is still in English: " },
      { kind: 'bold', children: [{ kind: 'code', text: 'Acts' }] },
    ]);
    expect(plainText(door43Tokens(ACTS, QA))).toBe("The title for the project 'act' is still in English: Acts");
  });

  test("H1: Door43's HTML link resolves against the Door43 host and keeps its text (E16)", () => {
    const tokens = door43Tokens(ACTS_SUGGESTION, QA);
    expect(tokens[0]).toEqual({ kind: 'text', text: 'Edit the ' });
    expect(tokens[1]).toEqual({ kind: 'link', href: 'https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/src/branch/temp-tca-release/v1.2.1/metadata.json', children: [{ kind: 'text', text: 'metadata.json' }] });
    expect(tokens[3]).toEqual({ kind: 'bold', children: [{ kind: 'code', text: 'title' }] });
    expect(tokens[5]).toEqual({ kind: 'bold', children: [{ kind: 'text', text: "'Acts'" }] });
    expect(plainText(tokens)).toBe("Edit the metadata.json file and translate the title of the projects. For example, translate 'Acts' to the resource's language.");
  });

  test('H1: an absolute https link and a Markdown link render as links', () => {
    expect(door43Tokens(RELEASE_SUGGESTION, QA)[1]).toEqual({ kind: 'link', href: 'https://gateway-admin.netlify.app/', children: [{ kind: 'text', text: 'gatewayAdmin' }] });
    expect(door43Tokens('See [the **metadata**](/o/r/src/branch/master/metadata.json).', QA)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', href: 'https://qa.door43.org/o/r/src/branch/master/metadata.json', children: [{ kind: 'text', text: 'the ' }, { kind: 'bold', children: [{ kind: 'text', text: 'metadata' }] }] },
      { kind: 'text', text: '.' },
    ]);
  });

  test('H1: a javascript: link, an <img onerror>, and any other tag are text, exactly as Door43 wrote them', () => {
    const script = 'Click <a href="javascript:alert(1)">here</a> or [here](javascript:alert(1)).';
    expect(door43Tokens(script, QA)).toEqual([{ kind: 'text', text: script }]);
    const image = 'Bad <img src=x onerror="alert(1)"> and <b>bold</b> and <script>alert(1)</script>';
    expect(door43Tokens(image, QA)).toEqual([{ kind: 'text', text: image }]);
    expect(door43Tokens('<a href="data:text/html,x">x</a>', QA)).toEqual([{ kind: 'text', text: '<a href="data:text/html,x">x</a>' }]);
  });

  test('H1: only http(s) or a path on the Door43 host may be opened', () => {
    expect(door43Href('/o/r', QA)).toBe('https://qa.door43.org/o/r');
    expect(door43Href('https://git.door43.org/o/r', QA)).toBe('https://git.door43.org/o/r');
    expect(door43Href('javascript:alert(1)', QA)).toBeNull();
    expect(door43Href('JavaScript:alert(1)', QA)).toBeNull();
    expect(door43Href('//evil.example/x', QA)).toBeNull();
    expect(door43Href('/\\evil.example/x', QA)).toBeNull();
    expect(door43Href('metadata.json', QA)).toBeNull();
    expect(door43Href('/o/r', null)).toBeNull();
  });

  test('H1: unmatched markers stay as text', () => {
    expect(door43Tokens('a ** b ` c [d] (e)', QA)).toEqual([{ kind: 'text', text: 'a ** b ` c [d] (e)' }]);
  });
});

describe('the findings (H2, H4)', () => {
  test('H4: each severity has its own word beside its icon; a severity Door43 has not been seen to use keeps its own word', () => {
    expect(['error', 'warning', 'info'].map(severityBadge)).toEqual([
      { tone: 'error', word: 'Error' },
      { tone: 'warning', word: 'Warning' },
      { tone: 'info', word: 'Information' },
    ]);
    expect(severityBadge('critical')).toEqual({ tone: 'other', word: 'critical' });
  });

  test("H1: errors, then warnings, then information, in Door43's order within each; none is dropped", () => {
    const issues = [issue('info', 'release_needed'), issue('warning', 'w1'), issue('error', 'e1'), issue('critical', 'x'), issue('warning', 'w2'), issue('error', 'e2')];
    expect(orderedIssues(issues).map(entry => entry.code)).toEqual(['e1', 'e2', 'w1', 'w2', 'release_needed', 'x']);
  });

  test('H2, H4: a blocked release says so above the findings, with the number of errors and warnings', () => {
    const recorded = [issue('warning', 'sb_ingredient_mismatch'), issue('error', 'obs_story_missing'), issue('error', 'obs_story_missing'), issue('info', 'release_needed')];
    expect(findingsSummary(recorded, 'blocked')).toEqual({ tone: 'error', text: "Release blocked: 2 errors from Door43's health check · 1 warning" });
    expect(findingsSummary([issue('error', 'obs_story_missing')], 'blocked')).toEqual({ tone: 'error', text: "Release blocked: 1 error from Door43's health check" });
    expect(findingsSummary([], 'blocked')).toEqual({ tone: 'error', text: "Release blocked until Door43's health check passes" });
  });

  test('H2: a health-blocked preparation is blocked; a warning ready for release waits for confirmation; anything else neither', () => {
    const health: Health = { state: 'warning', severity_raw: 'warning', ref: null, checked_at: null, issue_count: 1, issues: [], source: 'door43' };
    expect(findingsGate({ state: 'health_blocked', health: { ...health, state: 'failing' }, requires_acknowledgement: false })).toBe('blocked');
    expect(findingsGate({ state: 'ready_for_release', health, requires_acknowledgement: true })).toBe('acknowledge');
    expect(findingsGate({ state: 'retryable_failure', health, requires_acknowledgement: true })).toBe('acknowledge');
    expect(findingsGate({ state: 'ready_for_release', health: { ...health, state: 'info' }, requires_acknowledgement: false })).toBe('none');
    expect(findingsGate({ state: 'health_checking', health: { ...health, state: 'checking' }, requires_acknowledgement: false })).toBe('none');
    expect(findingsGate({ state: 'full_release', health, requires_acknowledgement: true })).toBe('none');
  });

  test('H2: a warning asks for confirmation; a release neither blocked nor waiting has no summary', () => {
    expect(findingsSummary([issue('warning', 'ingredient_title_is_en'), issue('info', 'release_needed')], 'acknowledge')).toEqual({ tone: 'warning', text: "1 warning from Door43's health check: confirm below before releasing" });
    expect(findingsSummary([issue('warning', 'a'), issue('warning', 'b')], 'acknowledge')?.text).toBe("2 warnings from Door43's health check: confirm below before releasing");
    expect(findingsSummary([issue('info', 'release_needed')], 'none')).toBeNull();
  });

  test('H1, H4: the rendered findings carry the summary, badge words, details, and suggestion, and insert no HTML of their own', () => {
    const issues = [
      issue('warning', 'ingredient_title_is_en', 'Project title is still in English', ACTS, ACTS_SUGGESTION),
      issue('error', 'obs_story_missing', 'Not all 50 stories are present', NOT_LISTED, 'Bad <img src=x onerror="alert(1)">'),
    ];
    const html = renderToStaticMarkup(createElement(HealthFindings, { issues, gate: 'blocked', origin: QA }));
    expect(html).toContain("Release blocked: 1 error from Door43&#x27;s health check · 1 warning");
    expect(html.indexOf('>Error<')).toBeGreaterThan(-1);
    expect(html.indexOf('>Error<')).toBeLessThan(html.indexOf('>Warning<'));
    expect(html).toContain('<strong><code>04</code></strong>');
    expect(html).toContain('<a href="https://qa.door43.org/bahtraku/Perjanjian-Baru-Pendau/src/branch/temp-tca-release/v1.2.1/metadata.json" target="_blank" rel="noopener noreferrer">metadata.json</a>');
    expect(html).toContain('Bad &lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/\*\*|`/);
  });

  test('H4: nothing is rendered when there is no finding and nothing to say', () => {
    expect(renderToStaticMarkup(createElement(HealthFindings, { issues: null, gate: 'none', origin: QA }))).toBe('');
  });
});
