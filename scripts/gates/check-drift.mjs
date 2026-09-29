#!/usr/bin/env node
// Non-negotiable 2: thresholds only move in the strengthening direction.
//   check-drift.mjs --msg <commit-msg-file>   commit-msg hook: staged thresholds vs HEAD
//   check-drift.mjs --commit <sha>            CI: <sha> vs its first parent, using its message
// Weakening (a value moving in its `weakens` direction, a removed key, a changed `weakens`, or a
// lowered or removed mutation floor in .harness/baselines/mutation.json)
// requires a `Threshold-change: <reason>` trailer that cites an ADR (ADR-NNNN). Re-recording or
// deleting a golden (`__golden__/`) or a screenshot baseline (`-snapshots/*.png`) needs the trailer
// too, naming the behaviour that changed, without an ADR (testing.md rule 8; M5 final F2).
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
  return import(`data:text/javascript,${encodeURIComponent(src)}`);
}

// the licence policy weakens when it allows more or denies less (NFR-LIC-002, M1.15)
function licenceWeakening(o, n) {
  if (!o) return [];
  if (!n) return ['LICENSES removed'];
  const gained = (a = [], b = []) => b.filter((x) => !a.includes(x));
  const out = gained(o.allow, n.allow).map((l) => `LICENSES.allow gained ${l}`);
  for (const [pack, list] of Object.entries(n.packExceptions ?? {})) {
    out.push(...gained(o.packExceptions?.[pack], list).map((l) => `LICENSES.packExceptions[${pack}] gained ${l}`));
  }
  for (const key of ['denyPrefixes', 'denyPackages']) out.push(...gained(n[key], o[key]).map((x) => `LICENSES.${key} lost ${x}`));
  return out;
}
// per-package mutation floors only move up too (testing.md rule 17, ADR-0146)
const FLOORS = '.harness/baselines/mutation.json';
const show = (rev, file = FILE) => {
  const r = git(['show', `${rev}:${file}`]);
  return r.status === 0 ? r.stdout : null;
};

let msg;
const sha = opt('commit');
// the file before and after the change under check (after: the index, ":<path>" form)
const versions = (file) => (sha ? [show(`${sha}^`, file), show(sha, file)] : [show('HEAD', file), show('', file)]);
if (sha) msg = git(['log', '-1', '--format=%B', sha]).stdout;
else msg = opt('msg') ? readFileSync(opt('msg'), 'utf8').replace(/^#.*$/gm, '') : '';

/** Weakenings of thresholds.mjs: a deleted file removes every threshold (F2); a non-numeric value disables its gate (F1). */
async function thresholdWeakening() {
  const [before, after] = versions(FILE);
  if (before === null || before === after) return [];
  const [oldMod, curMod] = [await load(before), after === null ? {} : await load(after)];
  const [old, cur] = [oldMod.THRESHOLDS ?? {}, curMod.THRESHOLDS ?? {}];
  const keys = Object.entries(old).map(([key, o]) => keyWeakening(key, o, cur[key]));
  return [...licenceWeakening(oldMod.LICENSES, curMod.LICENSES), ...keys.filter((w) => w !== null)];
}

/** How threshold `key` weakened from `o` to `n`, or null. */
function keyWeakening(key, o, n) {
  if (!n) return `${key} removed`;
  if (typeof n.value !== 'number' || !Number.isFinite(n.value)) return `${key} value is not a finite number (${String(n.value)})`;
  if (n.weakens !== o.weakens) return `${key} weakens-direction changed ${o.weakens} → ${n.weakens}`;
  return (o.weakens === 'up' ? n.value > o.value : n.value < o.value) ? `${key} ${o.value} → ${n.value} (weakens ${o.weakens})` : null;
}

/** Weakenings of the mutation floors: a lowered, removed or non-numeric package floor. */
function floorWeakening() {
  const [before, after] = versions(FLOORS);
  if (before === null || before === after) return [];
  const parse = (text) => {
    try {
      return JSON.parse(text ?? '{}').packages ?? {};
    } catch {
      return {};
    }
  };
  const [old, cur] = [parse(before), parse(after)];
  const weakened = [];
  for (const [pkg, o] of Object.entries(old)) {
    const n = cur[pkg]?.score;
    if (n === undefined) weakened.push(`mutation floor of ${pkg} removed`);
    else if (typeof n !== 'number' || !Number.isFinite(n)) weakened.push(`mutation floor of ${pkg} is not a finite number (${String(n)})`);
    else if (n < o.score) weakened.push(`mutation floor of ${pkg} ${o.score} → ${n}`);
  }
  return weakened;
}

/**
 * A golden, a screenshot baseline or a Vitest snapshot: re-recording one (`-u`) moves what a test
 * accepts (testing.md rule 8; M5.40 review F3).
 */
const BASELINE = /(^|\/)__golden__\/|-snapshots\/[^/]+\.png$|(^|\/)__snapshots__\/[^/]+\.snap$/;

/**
 * Goldens and snapshot baselines the change re-records or deletes (M5 final F2). Adding a new one
 * records a behaviour for the first time and needs no trailer. Paths come NUL-separated and
 * unquoted, so an unusual name still matches (M5.40 review F4).
 */
function baselineChanges() {
  const range = sha ? [`${sha}^`, sha] : ['--cached'];
  const fields = git(['-c', 'core.quotepath=off', 'diff', '--name-status', '--no-renames', '-z', ...range]).stdout.split('\0');
  const changes = [];
  for (let k = 0; k + 1 < fields.length; k += 2) {
    const [status, path] = [fields[k], fields[k + 1] ?? ''];
    if ((status === 'M' || status === 'D') && BASELINE.test(path)) changes.push(`${path} ${status === 'M' ? 're-recorded' : 'deleted'}`);
  }
  return changes;
}

/**
 * Whether the rule applies: to what is being committed now, and in CI to a commit whose parent already
 * had it. Commits from before M5.40 re-recorded baselines under the old wording and are not re-judged
 * (M5.40 review F1; their re-recordings are argued in review-argued.txt).
 */
const baselineRuled = () => !sha || (show(`${sha}^`, 'scripts/gates/check-drift.mjs') ?? '').includes('function baselineChanges()');

// a re-recorded baseline says which behaviour changed; no ADR is needed (testing.md rule 8)
const baselines = baselineRuled() ? baselineChanges() : [];
if (baselines.length > 0 && !/^Threshold-change:[ \t]*\S/m.test(msg)) {
  for (const b of baselines) console.error(`drift: ${b}`);
  console.error('Re-recording a golden or screenshot baseline needs "Threshold-change: <which behaviour changed>" in the commit message.');
  process.exit(1);
}

const weakened = [...(await thresholdWeakening()), ...floorWeakening()];
if (weakened.length === 0) {
  if (baselines.length > 0) console.log(`drift: ${baselines.length} re-recorded baseline(s) with a Threshold-change trailer`);
  process.exit(0);
}

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
