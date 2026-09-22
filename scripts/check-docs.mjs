#!/usr/bin/env node
// Checks the document tower for broken relative links and dangling identifiers.
// Runs with no dependencies: `node scripts/check-docs.mjs`. Exit code 1 on any failure.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const skip = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const failures = [];

function markdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

const files = markdownFiles(root);
const text = Object.fromEntries(files.map(f => [f, readFileSync(f, 'utf8')]));
const rel = f => relative(root, f);

// 1. Relative links resolve to a file or directory.
for (const [file, body] of Object.entries(text)) {
  for (const match of body.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    if (!existsSync(resolve(dirname(file), target))) failures.push(`${rel(file)}: broken link → ${target}`);
  }
}

// 2. Identifiers referenced anywhere are defined where they belong.
function defined(file, pattern) {
  const body = text[join(root, file)] ?? '';
  return new Set([...body.matchAll(pattern)].map(m => m[1]));
}
const invariants = defined('docs/invariants.md', /^### ([RHAWPX]\d{1,2}) —/gm);
const evidence = defined('docs/evidence.md', /^### ([EQ]\d{1,3}) —/gm);
const scenarios = defined('docs/product-spec.md', /^### (S\d) —/gm);
if (invariants.size === 0) failures.push('docs/invariants.md: no invariant headings found');
if (evidence.size === 0) failures.push('docs/evidence.md: no evidence or question headings found');
if (scenarios.size === 0) failures.push('docs/product-spec.md: no scenario headings found');

const referenceFiles = files.filter(f => !rel(f).startsWith('fixtures/'));
for (const file of referenceFiles) {
  const body = text[file];
  // Strip fenced code blocks and inline code, where identifiers may be illustrative.
  const prose = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of prose.matchAll(/(?<![A-Za-z0-9_\/-])([RHAWPX]\d{1,2})(?![A-Za-z0-9_])/g)) {
    if (!invariants.has(m[1])) failures.push(`${rel(file)}: invariant ${m[1]} is referenced but not defined in docs/invariants.md`);
  }
  for (const m of prose.matchAll(/(?<![A-Za-z0-9_\/-])([EQ]\d{1,3})(?![A-Za-z0-9_])/g)) {
    if (!evidence.has(m[1])) failures.push(`${rel(file)}: ${m[1]} is referenced but not defined in docs/evidence.md`);
  }
  for (const m of prose.matchAll(/(?<![A-Za-z0-9_\/-])(S\d)(?![A-Za-z0-9_])/g)) {
    if (!scenarios.has(m[1])) failures.push(`${rel(file)}: scenario ${m[1]} is referenced but not defined in docs/product-spec.md §13`);
  }
}

// 3. Every invariant appears in the traceability matrix at least once.
const traceability = text[join(root, 'docs/traceability.md')] ?? '';
for (const id of invariants) {
  if (!new RegExp(`(?<![A-Za-z0-9_])${id}(?![0-9])`).test(traceability)) failures.push(`docs/traceability.md: invariant ${id} appears in no row`);
}

if (failures.length) {
  console.error(`check-docs: ${failures.length} problem(s)`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`check-docs: ${files.length} markdown files, ${invariants.size} invariants, ${evidence.size} evidence entries and questions, ${scenarios.size} scenarios. All references resolve.`);
