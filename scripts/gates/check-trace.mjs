#!/usr/bin/env node
// Requirement traceability (NFR-MNT-008; sdd.md rules 4, 6, 15; testing.md rules 5, 6).
//   check-trace.mjs                      unknown IDs in test titles / backlog Req cells; matrix drift
//   check-trace.mjs --milestone M<n>     + every M-priority requirement the matrix assigns to M<n> has a test
//   check-trace.mjs --increment R<k>     + every M-priority requirement of increment R<k> has a test
//   … --priority M,S                     with --milestone/--increment: check these priorities instead of Must only (M12.46)
//   check-trace.mjs --write              refill the matrix Tests column from test titles
//   check-trace.mjs --dir <root>         check another checkout (tests)
// A running test "names" a requirement when the ID appears in its own title or a describe title
// (vitest, node:test and Playwright all use describe/it/test).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { REPO_ROOT } from './lib.mjs';
import { testTitles } from './test-titles.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = opt('dir') ? resolve(opt('dir')) : REPO_ROOT;
const REQ_DIR = join(root, 'docs', 'requirements');
const MATRIX = join(REQ_DIR, '40-traceability.md');
const ID = /\b(?:FR|NFR)-[A-Z][A-Z0-9]*-\d{3}\b/g;
const errors = [];

// requirement tables: | ID | Pri | Inc | … in every numbered requirement file except the matrix
const reqs = new Map();
for (const f of readdirSync(REQ_DIR).filter((n) => /^[1-3]\d-.*\.md$/.test(n))) {
  for (const line of readFileSync(join(REQ_DIR, f), 'utf8').split(/\r?\n/)) {
    const m = /^\|\s*((?:FR|NFR)-[A-Z][A-Z0-9]*-\d{3})\s*\|\s*([MSC])\s*\|\s*(R\d+)\s*\|/.exec(line);
    if (!m) continue;
    if (reqs.has(m[1])) errors.push(`${m[1]} is defined twice (${reqs.get(m[1]).file}, ${f})`);
    reqs.set(m[1], { pri: m[2], inc: m[3], file: f });
  }
}

// matrix rows: | ID | Pri | Inc | Milestone(s) | Source | Tests |
const matrixLines = readFileSync(MATRIX, 'utf8').split(/\r?\n/);
const matrix = new Map();
for (const line of matrixLines) {
  const cells = line.split('|').map((c) => c.trim());
  if (!/^(?:FR|NFR)-[A-Z][A-Z0-9]*-\d{3}$/.test(cells[1] ?? '')) continue;
  matrix.set(cells[1], { pri: cells[2], inc: cells[3], milestones: cells[4].split(/[,\s]+/).filter(Boolean) });
}
for (const [id, r] of reqs) {
  const m = matrix.get(id);
  if (!m) errors.push(`${id} (${r.file}) is missing from 40-traceability.md`);
  else if (m.pri !== r.pri || m.inc !== r.inc) errors.push(`${id}: matrix says ${m.pri}/${m.inc}, ${r.file} says ${r.pri}/${r.inc}`);
}
for (const id of matrix.keys()) if (!reqs.has(id)) errors.push(`${id} is in 40-traceability.md but no requirement file defines it`);
// summary rows: | R<k> | Must | Should | Could | Total |, one per increment (M1.13 review F4)
const summarised = new Set();
for (const line of matrixLines) {
  const m = /^\|\s*(R\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|$/.exec(line.trim());
  if (!m) continue;
  summarised.add(m[1]);
  const rows = [...reqs.values()].filter((r) => r.inc === m[1]);
  const want = ['M', 'S', 'C'].map((p) => rows.filter((r) => r.pri === p).length);
  const have = [m[2], m[3], m[4]].map(Number);
  if (want.join() !== have.join() || Number(m[5]) !== rows.length) {
    errors.push(`40-traceability.md summary ${m[1]}: says ${have.join('/')}/${m[5]}, requirement files give ${want.join('/')}/${rows.length}`);
  }
}
for (const inc of new Set([...reqs.values()].map((r) => r.inc))) {
  if (!summarised.has(inc)) errors.push(`40-traceability.md summary has no row for increment ${inc}`);
}

// test titles
// Vitest 5 benches are tests (`context.bench` inside `test`), so their titles trace too (M3.25)
const TEST_FILE = /\.(test|spec|bench)\.[cm]?[jt]sx?$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.tsbuild', 'coverage', '.git', 'fixtures', '__fixtures__']);
function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) yield* walk(join(dir, e.name));
    } else if (TEST_FILE.test(e.name)) yield join(dir, e.name);
  }
}
// titles come from a scanner that knows strings, comments and regex literals; a skipped or todo
// test still has its IDs checked but does not count as covering them (M1.25, M1 cp2 F1)
const cited = new Map(); // id -> Set(file)
for (const top of ['tests', 'e2e', 'eval', 'packages', 'packs', 'apps']) {
  for (const file of walk(join(root, top))) {
    const rel = relative(root, file).split(sep).join('/');
    for (const { title, runs } of testTitles(readFileSync(file, 'utf8'))) {
      for (const [id] of title.matchAll(ID)) {
        if (!reqs.has(id)) errors.push(`${rel}: test title cites unknown requirement ${id}`);
        else if (runs) cited.set(id, (cited.get(id) ?? new Set()).add(rel));
      }
    }
  }
}

// backlog Req cells (column 3): known IDs or HARNESS
const backlog = join(root, 'docs', 'backlog', 'current.md');
if (existsSync(backlog)) {
  for (const line of readFileSync(backlog, 'utf8').split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    if (!/^M\d+\.\d+$/.test(cells[1] ?? '')) continue;
    const ids = [...(cells[3] ?? '').matchAll(ID)].map((m) => m[0]);
    if (ids.length === 0 && !/HARNESS/.test(cells[3] ?? '')) errors.push(`backlog ${cells[1]}: Req cell cites no requirement ID (or HARNESS)`);
    for (const id of ids) if (!reqs.has(id)) errors.push(`backlog ${cells[1]}: cites unknown requirement ${id}`);
  }
}

// coverage of a milestone's or an increment's requirements: Must only, unless --priority names more (M12 cp1 F2)
const PRIORITY = { M: 'Must', S: 'Should', C: 'Could' };
const priorities = (opt('priority') ?? 'M')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);
for (const p of priorities) if (!(p in PRIORITY)) errors.push(`--priority ${p}: not one of ${Object.keys(PRIORITY).join(', ')}`);
const priorityWords = priorities.map((p) => PRIORITY[p] ?? p).join(' or ');
const scope = opt('milestone') ? ['milestone', opt('milestone')] : opt('increment') ? ['increment', opt('increment')] : null;
if (scope) {
  const [kind, value] = scope;
  const inScope = [...reqs].filter(
    ([id, r]) => priorities.includes(r.pri) && (kind === 'increment' ? r.inc === value : matrix.get(id)?.milestones.includes(value)),
  );
  if (inScope.length === 0) errors.push(`no ${priorityWords} requirement is assigned to ${kind} ${value}`);
  for (const [id, r] of inScope) if (!cited.has(id)) errors.push(`${id} (${PRIORITY[r.pri]}, ${kind} ${value}) has no test naming it`);
}

// the matrix Tests column is generated: --write refills it, otherwise a stale column fails (M1.36, cp3 F5)
const cell = (id) => {
  const files = [...(cited.get(id) ?? [])].sort();
  return files.length === 0 ? '—' : files.length <= 2 ? files.map((f) => `\`${f}\``).join(', ') : `\`${files[0]}\` +${files.length - 1}`;
};
const refreshed = matrixLines.map((line) => {
  const cells = line.split('|');
  const id = cells[1]?.trim();
  if (!matrix.has(id)) return line;
  cells[6] = ` ${cell(id)} `;
  return cells.join('|');
});
const stale = refreshed.filter((line, i) => line !== matrixLines[i]).map((line) => line.split('|')[1].trim());
if (argv.includes('--write')) writeFileSync(MATRIX, refreshed.join('\n'));
else if (stale.length) {
  errors.push(
    `40-traceability.md Tests column is stale for ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ` (+${stale.length - 5})` : ''}: run check-trace.mjs --write`,
  );
}

if (errors.length) {
  for (const e of errors) console.error(`trace: ${e}`);
  process.exit(1);
}
const traced = [...cited.keys()].length;
console.log(`trace: ${reqs.size} requirements, ${traced} named by tests${scope ? `, every ${priorityWords} of ${scope[1]} covered` : ''}`);
