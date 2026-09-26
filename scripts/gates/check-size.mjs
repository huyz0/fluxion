#!/usr/bin/env node
// Size caps that keep the harness and code readable by agents (NFR-MNT-003).
// Caps come from thresholds.mjs. Function length and complexity are enforced by Biome from M1
// (FUNCTION_MAX_LINES, COMPLEXITY_MAX); this script owns file-level and harness-doc caps.
//   check-size.mjs [--all|--staged|--quick]   (all modes check everything; it is cheap)
import { exists, listFiles, readText } from './lib.mjs';
import { t } from './thresholds.mjs';

const lines = (p) => readText(p).split(/\r?\n/).length - (readText(p).endsWith('\n') ? 1 : 0);
const errors = [];
const cap = (p, max, what) => {
  if (!exists(p)) return;
  const n = lines(p);
  if (n > max) errors.push(`${p}: ${n} lines > ${max} (${what})`);
};

// grab-bag module names hide what code does and grow without bound (code-structure.md rule 8)
const DENYLIST = new Set(['utils', 'helpers', 'misc', 'common']);
// the file stem and every directory under src/ (a utils/ folder is the same grab-bag; M1.10 review F3)
const denylisted = (p) => {
  const i = p.indexOf('/src/');
  if (i < 0) return null;
  const parts = p.slice(i + 5).split('/');
  parts.push(parts.pop().split('.')[0]);
  return parts.map((s) => s.toLowerCase()).find((s) => DENYLIST.has(s)) ?? null;
};

cap('AGENTS.md', t('AGENTS_MD_MAX_LINES'), 'AGENTS_MD_MAX_LINES');
cap('docs/backlog/current.md', t('BACKLOG_MAX_LINES'), 'BACKLOG_MAX_LINES — archive or split the milestone');
for (const p of listFiles('.agents/skills', (f) => f.endsWith('/SKILL.md'))) cap(p, t('SKILL_MAX_LINES'), 'SKILL_MAX_LINES');
for (const root of ['packages', 'apps', 'packs']) {
  for (const p of listFiles(root, (f) => /\/AGENTS\.md$/.test(f))) cap(p, t('PACKAGE_AGENTS_MD_MAX_LINES'), 'PACKAGE_AGENTS_MD_MAX_LINES');
  for (const p of listFiles(root, (f) => /\.[cm]?[jt]sx?$/.test(f) && !/\.d\.[cm]?ts$|__fixtures__|\/generated\//.test(f))) {
    cap(p, t('FILE_MAX_LINES'), 'FILE_MAX_LINES — split the module');
    const junk = denylisted(p);
    if (junk) errors.push(`${p}: '${junk}' is a grab-bag name — name the module after what it does (code-structure.md)`);
  }
}

// progress log: each "## " entry at most PROGRESS_ENTRY_MAX_LINES body lines
if (exists('.harness/progress.md')) {
  const text = readText('.harness/progress.md').split(/\r?\n/);
  let head = null;
  let body = 0;
  const flush = () => {
    if (head && body > t('PROGRESS_ENTRY_MAX_LINES')) errors.push(`.harness/progress.md: entry "${head}" has ${body} lines > ${t('PROGRESS_ENTRY_MAX_LINES')}`);
  };
  for (const l of text) {
    if (l.startsWith('## ')) {
      flush();
      head = l.slice(3);
      body = 0;
    } else if (head && l.trim()) body++;
  }
  flush();
}

if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log('size ok');
