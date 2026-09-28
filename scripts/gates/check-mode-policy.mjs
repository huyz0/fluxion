#!/usr/bin/env node
// Mode-policy gate (04 §2.6, ADR-0015): edit, present and export are one renderer, and every mode
// difference is an entry of packages/render/src/mode-policy.ts. So no other render source branches
// on the mode: it passes `mode` to `modePolicy(…)` and reads the policy's fields. Flags, in the
// shipped sources of @fluxion/render (tests, stories and fixtures aside):
//   a comparison with mode (mode === …, … !== props.mode)      switch (… mode)
//   mode as a condition (if (mode), mode ? …, mode && …)       mode as an index ([mode], [props.mode])
//   check-mode-policy.mjs [--dir <root>]      a sandbox root (tests); default the repo
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib.mjs';

const DIR = 'packages/render/src';
const POLICY = `${DIR}/mode-policy.ts`;
const TEST = /\.(test|spec|stories|bench)\.tsx?$|\/__fixtures__\//;

// comments blanked, string contents blanked (quotes kept), so `mode` inside either cannot match
const blank = (text) =>
  text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (m) =>
    m.startsWith('/') ? m.replace(/[^\n]/g, ' ') : `${m[0]}${m.slice(1, -1).replace(/[^\n]/g, ' ')}${m.at(-1)}`,
  );

const MODE = String.raw`(?:[\w$]+\??\.)*mode\b`;
// on blanked code (comments and string contents gone)
const RULES = [
  new RegExp(String.raw`\b${MODE}\s*(?:===|!==|==|!=)`),
  /(?:===|!==|==|!=)\s*(?:[\w$]+\??\.)*\bmode\b/,
  new RegExp(String.raw`\bswitch\s*\(\s*${MODE}`),
  new RegExp(String.raw`\bif\s*\(\s*!?\s*${MODE}\s*\)`),
  // a ternary or a logical operand; not `mode?:` (an optional member or parameter) nor `mode?.` (M4.11 review F1)
  new RegExp(String.raw`\b${MODE}\s*(?:\?(?![.:?])|&&|\|\|)`),
  new RegExp(String.raw`\[\s*${MODE}\s*\]`),
  // membership and method calls: ['edit'].includes(mode), mode.startsWith('e') (review F2)
  new RegExp(String.raw`\.(?:includes|indexOf|has|some|find)\(\s*${MODE}\s*\)`),
  new RegExp(String.raw`\b${MODE}\s*\.\s*[\w$]+\s*\(`),
  // a destructuring rename that hides the mode under another name: const { mode: m } = … (review F2)
  /\bmode\s*:\s*(?!(?:string|number|boolean|unknown|any|never)\b)[a-z_$][\w$]*\s*[,}=]/,
];
// on raw code: a computed key spells the name in a string, which blanking hides
const RAW_RULES = [/\[\s*(['"`])mode\1\s*\]/];

/**
 * Lines of `text` that branch on the mode: [line number, code]. Known limits: a mode passed on under
 * another name by other means (an alias of props, a spread) is not followed; render names no other
 * field `mode`, so `x.mode` always means the render mode.
 */
export function modeReads(text) {
  const lines = blank(text).split(/\r?\n/);
  const raw = text.split(/\r?\n/);
  return lines.flatMap((line, i) => (RULES.some((re) => re.test(line)) || RAW_RULES.some((re) => re.test(raw[i] ?? '')) ? [[i + 1, raw[i].trim()]] : []));
}

/** Files under `root/dir`, as `dir/…` paths. */
function filesUnder(root, dir) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(root, rel))) {
      const r = `${rel}/${name}`;
      if (statSync(join(root, r)).isDirectory()) walk(r);
      else out.push(r);
    }
  };
  if (existsSync(join(root, dir))) walk(dir);
  return out.sort();
}

// run as a script (not when imported by a test)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const argv = process.argv.slice(2);
  const root = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : REPO_ROOT;
  const sources = filesUnder(root, DIR).filter((f) => /\.tsx?$/.test(f) && !TEST.test(f) && f !== POLICY);
  const found = sources.flatMap((f) => modeReads(readFileSync(join(root, f), 'utf8')).map(([line, code]) => `${f}:${line}: ${code}`));
  if (found.length) {
    for (const f of found) console.error(`mode-policy: ${f}`);
    console.error(`mode-policy: only ${POLICY} may branch on the render mode (04 §2.6); read the policy's fields instead`);
    process.exit(1);
  }
  console.log(`mode-policy: ${sources.length} render source files, no branch on the mode outside mode-policy.ts`);
}
