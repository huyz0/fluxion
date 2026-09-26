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

cap('AGENTS.md', t('AGENTS_MD_MAX_LINES'), 'AGENTS_MD_MAX_LINES');
cap('docs/backlog/current.md', t('BACKLOG_MAX_LINES'), 'BACKLOG_MAX_LINES — archive or split the milestone');
for (const p of listFiles('.agents/skills', (f) => f.endsWith('/SKILL.md'))) cap(p, t('SKILL_MAX_LINES'), 'SKILL_MAX_LINES');
for (const root of ['packages', 'apps', 'packs']) {
  for (const p of listFiles(root, (f) => /\/AGENTS\.md$/.test(f))) cap(p, t('PACKAGE_AGENTS_MD_MAX_LINES'), 'PACKAGE_AGENTS_MD_MAX_LINES');
  for (const p of listFiles(root, (f) => /\.(ts|tsx|mts|mjs|js)$/.test(f) && !/\.d\.ts$|__fixtures__|\/generated\//.test(f))) {
    cap(p, t('FILE_MAX_LINES'), 'FILE_MAX_LINES — split the module');
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
