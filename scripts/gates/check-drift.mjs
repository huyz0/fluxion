#!/usr/bin/env node
// Non-negotiable 2: thresholds only move in the strengthening direction.
//   check-drift.mjs --msg <commit-msg-file>   commit-msg hook: staged thresholds vs HEAD
//   check-drift.mjs --commit <sha>            CI: <sha> vs its first parent, using its message
// Weakening (a value moving in its `weakens` direction, a removed key, or a changed `weakens`)
// requires a `Threshold-change: <reason>` trailer that cites an ADR (ADR-NNNN).
import { readFileSync } from 'node:fs';
import { git } from './lib.mjs';

const FILE = 'scripts/gates/thresholds.mjs';
const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function load(src) {
  if (!src) return {};
  const mod = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  return mod.THRESHOLDS ?? {};
}
const show = (rev) => {
  const r = git(['show', `${rev}:${FILE}`]);
  return r.status === 0 ? r.stdout : null;
};

let before;
let after;
let msg;
const sha = opt('commit');
if (sha) {
  before = show(`${sha}^`);
  after = show(sha);
  msg = git(['log', '-1', '--format=%B', sha]).stdout;
} else {
  before = show('HEAD');
  after = show(''); // index (":<path>" form)
  msg = opt('msg') ? readFileSync(opt('msg'), 'utf8').replace(/^#.*$/gm, '') : '';
}
if (before === null || before === after) process.exit(0);

// a deleted file removes every threshold (F2); a non-numeric value disables its gate (F1)
const [old, cur] = [await load(before), after === null ? {} : await load(after)];
const weakened = [];
for (const [key, o] of Object.entries(old)) {
  const n = cur[key];
  if (!n) {
    weakened.push(`${key} removed`);
    continue;
  }
  if (typeof n.value !== 'number' || !Number.isFinite(n.value)) weakened.push(`${key} value is not a finite number (${String(n.value)})`);
  else if (n.weakens !== o.weakens) weakened.push(`${key} weakens-direction changed ${o.weakens} → ${n.weakens}`);
  else if (o.weakens === 'up' ? n.value > o.value : n.value < o.value) weakened.push(`${key} ${o.value} → ${n.value} (weakens ${o.weakens})`);
}
if (weakened.length === 0) process.exit(0);

// the cited ADR must exist in the tree being committed (F3)
const adr = /^Threshold-change:[ \t]*\S.*\b(ADR-\d{4})\b/m.exec(msg)?.[1];
const adrFiles = (sha ? git(['ls-tree', '-r', '--name-only', sha, 'docs/architecture/decisions']) : git(['ls-files', 'docs/architecture/decisions'])).stdout;
const justified = adr && new RegExp(`(^|/)${adr}-[^/]*\\.md$`, 'm').test(adrFiles);
if (adr && !justified) console.error(`drift: ${adr} cited in Threshold-change does not exist under docs/architecture/decisions/`);
if (justified) {
  console.log(`drift: ${weakened.length} weakening change(s) justified by Threshold-change trailer`);
  process.exit(0);
}
for (const w of weakened) console.error(`drift: ${w}`);
console.error('Weakening a gate needs "Threshold-change: <reason> (ADR-NNNN)" in the commit message.');
process.exit(1);
