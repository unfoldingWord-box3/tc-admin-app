// The shared schema against the documents it is the executable form of:
// the operation catalog (docs/operations.md §3, §5, §6, §7) and the glossary
// identifiers (CONTEXT.md). A change to either side fails here until the other
// follows.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  CANDIDATE_GROUPS,
  COVERAGE_BASES,
  COVERAGE_SCOPES,
  EDITABILITY_STATES,
  ERROR_CATALOG,
  ERROR_CODES,
  FRESHNESS_SOURCES,
  HEALTH_STATES,
  INCLUSION_STATES,
  METADATA_FORMATS,
  OPERATIONS,
  OPERATION_NAMES,
  PREPARATION_STATES,
  PROJECT_TYPES,
  SELECTION_STATES,
  SETUP_STATES,
  VERSION_RULES,
  catalogMessage,
  formatMessage,
  routeParams,
} from '../schema';
import type { ErrorEntry, OperationDefinition } from '../schema';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const operationsDoc = read('docs/operations.md');
const contextDoc = read('CONTEXT.md');

/** The rows of the first markdown table after `heading`, as arrays of trimmed cells. */
function table(doc: string, heading: string): string[][] {
  const start = doc.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const lines = doc.slice(start).split('\n');
  const first = lines.findIndex(line => line.startsWith('|'));
  const rows: string[][] = [];
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.slice(1, -1).split('|').map(cell => cell.trim()));
  }
  return rows;
}
const code = (cell: string) => cell.replace(/`/g, '').replace(/\s*\(.*\)$/, '').trim();
const values = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map(match => match[1]);

describe('the operation catalog (operations.md §3)', () => {
  const rows = table(operationsDoc, '## 3. Catalog');

  test('every operation in the document is in the schema with its kind and milestone, and nothing else is', () => {
    const documented = rows.map(([name, kind, milestone]) => [code(name!), kind, Number(milestone)]);
    const schema = OPERATION_NAMES.map(name => {
      const definition: OperationDefinition = OPERATIONS[name];
      return [name, definition.kind, definition.milestone];
    });
    expect(schema).toEqual(documented);
  });

  test('every Milestone 1 operation has a route and input and output schemas; Milestone 2 waits for its issue', () => {
    for (const name of OPERATION_NAMES) {
      const definition: OperationDefinition = OPERATIONS[name];
      const specified = definition.milestone === 1;
      expect([definition.route !== null, definition.input !== null, definition.output !== null], name).toEqual([specified, specified, specified]);
    }
  });

  test('plans and applies are POST', () => {
    const writes = OPERATION_NAMES.map(name => [name, OPERATIONS[name] as OperationDefinition] as const).filter(([, d]) => d.route && d.kind !== 'read');
    expect(writes.length).toBeGreaterThan(0);
    for (const [name, definition] of writes) expect(definition.route?.method, name).toBe('POST');
  });
});

describe('the HTTP projection (operations.md §7)', () => {
  const block = operationsDoc.slice(operationsDoc.indexOf('## 7. Projections'));
  const documented = [...block.matchAll(/^(GET|POST)\s+(\S+)\s+([a-z.]+)$/gm)].map(([, method, path, name]) => ({
    name,
    method,
    path: path!.replace(/\?.*$/, ''),
  }));

  test('the document lists exactly the routes the schema defines', () => {
    const routed = OPERATION_NAMES.flatMap(name => {
      const route = (OPERATIONS[name] as OperationDefinition).route;
      return route ? [{ name, method: route.method, path: route.path }] : [];
    });
    const byName = (a: { name: string | undefined }, b: { name: string | undefined }) => String(a.name).localeCompare(String(b.name));
    expect(documented.sort(byName)).toEqual(routed.sort(byName));
  });

  test('no two routes with the same method match the same path', () => {
    const shapes = OPERATION_NAMES.flatMap(name => {
      const route = (OPERATIONS[name] as OperationDefinition).route;
      return route ? [`${route.method} ${route.path.replace(/\{[a-z_]+\}/g, '{}')}`] : [];
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  test('every path field of a route is a field of the operation input', () => {
    for (const name of OPERATION_NAMES) {
      const definition: OperationDefinition = OPERATIONS[name];
      if (!definition.route || !definition.input) continue;
      const shape = (definition.input as unknown as { shape: Record<string, unknown> }).shape;
      for (const param of routeParams(definition.route.path)) expect(Object.keys(shape), `${name} {${param}}`).toContain(param);
    }
  });
});

describe('the error catalog (operations.md §6)', () => {
  const rows = table(operationsDoc, '## 6. Error catalog');

  test('X2: every documented code is in the schema with its HTTP status and retryability, and nothing else is', () => {
    const documented = new Map<string, [number | null, boolean]>();
    for (const [cell, http, retryable] of rows) {
      documented.set(code(cell!), [http === 'warning' ? null : Number(http), retryable !== 'no']);
    }
    expect(ERROR_CODES).toEqual([...documented.keys()]);
    for (const [name, [http, retryable]] of documented) {
      const entry: ErrorEntry = ERROR_CATALOG[name as keyof typeof ERROR_CATALOG];
      expect([entry.http, entry.retryable], name).toEqual([http, retryable]);
    }
  });

  test('X2: every fixed message is quoted from the document, not paraphrased', () => {
    for (const [cell, , , message] of rows) {
      const name = code(cell!) as keyof typeof ERROR_CATALOG;
      const entry: ErrorEntry = ERROR_CATALOG[name];
      const quoted = /^"(.*)"$/.exec(message!)?.[1];
      const fixed = cell!.includes('(') ? entry.variants?.[cell!.replace(/^.*\((.*)\).*$/, '$1')] : entry.message;
      expect(fixed ?? null, name).toBe(quoted ?? null);
    }
  });

  test('a message fills its placeholders and keeps one that has no value', () => {
    expect(catalogMessage('name_taken', undefined, { repo_name: 'en_ult', owner: 'unfoldingWord' })).toBe(
      'A repository named en_ult already exists in unfoldingWord. Change the abbreviation.',
    );
    expect(catalogMessage('invalid_version', 'removal', { major: 'v2.0.0' })).toBe('Removing a book needs a new major version, at least v2.0.0.');
    expect(formatMessage('Commit failed: <error message>.')).toBe('Commit failed: <error message>.');
  });
});

describe('the state identifiers (operations.md §5, CONTEXT.md "Identifiers")', () => {
  const schema: Record<string, readonly string[]> = {
    project_type: PROJECT_TYPES,
    metadata_format: METADATA_FORMATS,
    'coverage.basis': COVERAGE_BASES,
    'editability.state': EDITABILITY_STATES,
    'coverage.scope': COVERAGE_SCOPES,
    'health.state': HEALTH_STATES,
    'candidate group': CANDIDATE_GROUPS,
    'content inclusion': INCLUSION_STATES,
    selection: SELECTION_STATES,
    'preparation.state': PREPARATION_STATES,
    'version.rule_applied': VERSION_RULES,
    'setup.state': SETUP_STATES,
    'freshness.source': FRESHNESS_SOURCES,
  };

  test('every field in the operation catalog §5 has exactly the schema values', () => {
    const rows = table(operationsDoc, '## 5. State identifiers');
    const documented = Object.fromEntries(rows.map(([field, cell]) => [code(field!), values(cell!)]));
    expect(documented).toEqual(Object.fromEntries(Object.entries(schema).map(([field, list]) => [field, [...list]])));
  });

  test('every identifier with values in CONTEXT.md has exactly the schema values', () => {
    const rows = table(contextDoc, '## Identifiers');
    const byIdentifier: Record<string, string> = { inclusion: 'content inclusion', group: 'candidate group' };
    for (const [, identifier, cell] of rows) {
      const field = byIdentifier[code(identifier!)] ?? code(identifier!);
      if (!(field in schema)) continue;
      expect(values(cell!), field).toEqual([...schema[field]!]);
    }
  });
});
