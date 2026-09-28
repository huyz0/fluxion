#!/usr/bin/env node
// Kind-switch gate (FR-EXT-001; 03-core-engine §4): element kinds are extensible (plugins add
// `<plugin>:<name>`), so code outside the registries must look a kind up in a registry, never
// branch on it. Flags, in the shipped sources of the packages that consume kinds:
//   switch (<anything>.kind) / switch (kind)                       a switch on a kind
//   two or more comparisons of a kind with a literal within 10 lines (if / else-if / early-return
//   chains, ternary chains, either operand order)                  an if-chain on a kind
// One comparison alone (a guard such as `if (el.kind === 'connector')`) is allowed. A line carrying
// `// kind-switch-allow: <reason>` is exempt (a closed union such as a path command's kind).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFiles, repoPath } from './lib.mjs';

const PACKAGES = ['core', 'render', 'editor', 'player', 'exporters'];
const SOURCE = /\.tsx?$/;
const TEST = /\.(test|spec|stories|bench)\.tsx?$|\/__fixtures__\//;
const ALLOW = /\/\/\s*kind-switch-allow:\s*\S/;
/** Comparisons further apart than this are separate guards, not a chain. */
const CHAIN_LINES = 10;

// comments blanked; strings keep their quotes but lose their content, so a kind inside either
// cannot match while a comparison with a literal still can
const blank = (text) =>
  text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (m) =>
    m.startsWith('/') ? m.replace(/[^\n]/g, ' ') : `${m[0]}${m.slice(1, -1).replace(/[^\n]/g, ' ')}${m.at(-1)}`,
  );

// the subject may hold calls or indexing: switch (store.get(id).kind), switch (els[i].kind)
const SWITCH = /\bswitch\s*\((?:[^()]|\([^()]*\))*?\bkind\s*\)/;
const COMPARE_SOURCE = String.raw`\bkind\s*[!=]==?\s*['"\`]|['"\`]\s*[!=]==?\s*[\w$.?[\]()]*\bkind\b`;
const COMPARE = new RegExp(COMPARE_SOURCE, 'g');
// an else-if whose condition compares a kind is a chain however long the branches are (M3.15 review r2 F1)
const ELSE_IF = new RegExp(String.raw`\belse\s+if\s*\([^\n]*?(?:${COMPARE_SOURCE})`);
// el['kind'] / el["kind"] read as el.kind, before string contents are blanked (M3.15 review r2 F2)
const computedKind = (text) => text.replace(/\[\s*(['"`])kind\1\s*\]/g, '.kind');

/** Violations in one file: [line number, what]. */
function scan(text) {
  const raw = text.split(/\r?\n/);
  const code = blank(computedKind(text)).split(/\r?\n/);
  const out = [];
  const compares = [];
  code.forEach((line, i) => {
    if (ALLOW.test(raw[i] ?? '')) return;
    if (SWITCH.test(line)) out.push([i + 1, 'switch on a kind']);
    else if (ELSE_IF.test(line)) out.push([i + 1, 'if-chain on a kind']);
    for (const _ of line.matchAll(COMPARE)) compares.push(i + 1);
  });
  for (let k = 1; k < compares.length; k++) {
    const [prev, line] = [compares[k - 1], compares[k]];
    if (line - prev <= CHAIN_LINES && !out.some(([l]) => l === line)) out.push([line, 'if-chain on a kind']);
  }
  return out.sort(([a], [b]) => a - b);
}

const files = PACKAGES.flatMap((p) => listFiles(join('packages', p, 'src'))).filter((f) => SOURCE.test(f) && !TEST.test(f));
const violations = [];
for (const file of files) {
  for (const [line, what] of scan(readFileSync(repoPath(file), 'utf8')))
    violations.push(`${file}:${line}: ${what}; look the kind up in a registry (FR-EXT-001)`);
}
if (violations.length) {
  for (const v of violations) console.error(`kind-switch: ${v}`);
  process.exit(1);
}
console.log(`kind-switch: ${files.length} source files in ${PACKAGES.join(', ')}, no switch on a kind`);
