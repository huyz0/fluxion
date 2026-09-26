#!/usr/bin/env node
// Regenerate index tables from their single sources, so indexes cannot drift.
//   build-index.mjs            rewrite tables in place
//   build-index.mjs --check    exit 1 if any table is stale
// Tables (between <!-- index:<name>:start --> and <!-- index:<name>:end -->):
//   AGENTS.md                  skills     ← .agents/skills/*/SKILL.md description ("Use when …" sentence)
//   docs/standards/README.md   standards  ← docs/standards/*.md "> Read when:" and "> Family:" lines
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { frontMatter, repoPath } from '../gates/lib.mjs';

const check = process.argv.includes('--check');

// Lifecycle order for skills; skills not listed follow alphabetically.
const SKILL_ORDER = [
  'drive',
  'next-task',
  'plan-milestone',
  'spec',
  'tdd',
  'ui-check',
  'verify',
  'code-review',
  'milestone-review',
  'adr',
  'research',
  'ship',
  'brevity',
];
const FAMILY_ORDER = ['Process', 'Quality', 'Delivery', 'Code', 'Design'];
const rank = (list, x) => (list.includes(x) ? list.indexOf(x) : list.length);
const cell = (s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function skillsTable() {
  const dir = repoPath('.agents', 'skills');
  const rows = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const fm = frontMatter(readFileSync(repoPath('.agents', 'skills', d.name, 'SKILL.md'), 'utf8'));
      const desc = fm?.data.description ?? '';
      // a sentence ends at a period followed by whitespace/end — not the dot in "current.md"
      const use = /\bUse (when|whenever|before|at)\b.*?\.(?=\s|$)/i.exec(desc)?.[0] ?? desc;
      const text = use.replace(/^Use /i, '').replace(/\.$/, '');
      return { name: d.name, text: text.charAt(0).toUpperCase() + text.slice(1) };
    })
    .sort((a, b) => rank(SKILL_ORDER, a.name) - rank(SKILL_ORDER, b.name) || a.name.localeCompare(b.name));
  return ['| Skill | Use when |', '|---|---|', ...rows.map((r) => `| [\`${r.name}\`](.agents/skills/${r.name}/SKILL.md) | ${cell(r.text)} |`)].join('\n');
}

function standardsTable() {
  const dir = repoPath('docs', 'standards');
  const rows = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => {
      const lines = readFileSync(repoPath('docs', 'standards', f), 'utf8').split(/\r?\n/);
      const start = lines.findIndex((l) => l.startsWith('> Read when:'));
      if (start < 0) throw new Error(`docs/standards/${f}: missing "> Read when:" line`);
      const block = [lines[start].replace('> Read when:', '')];
      for (let i = start + 1; i < lines.length && lines[i].startsWith('>') && !/^> (Family|Related):/.test(lines[i]); i++) block.push(lines[i].slice(1));
      const family = /^> Family:\s*(\w+)/m.exec(lines.join('\n'))?.[1];
      if (!family) throw new Error(`docs/standards/${f}: missing "> Family:" line`);
      return { f, family, when: block.join(' ').trim().replace(/\.$/, '') };
    })
    .sort((a, b) => rank(FAMILY_ORDER, a.family) - rank(FAMILY_ORDER, b.family) || a.f.localeCompare(b.f));
  return ['| Standard | Family | Read when |', '|---|---|---|', ...rows.map((r) => `| [${r.f}](${r.f}) | ${r.family} | ${cell(r.when)} |`)].join('\n');
}

const TARGETS = [
  ['AGENTS.md', 'skills', skillsTable],
  ['docs/standards/README.md', 'standards', standardsTable],
];

let stale = 0;
for (const [file, name, build] of TARGETS) {
  const path = repoPath(file);
  const text = readFileSync(path, 'utf8');
  const re = new RegExp(`(<!-- index:${name}:start -->\\r?\\n)[\\s\\S]*?(\\r?\\n<!-- index:${name}:end -->)`);
  if (!re.test(text)) throw new Error(`${file}: missing index:${name} markers`);
  const next = text.replace(re, (_, a, b) => `${a}${build()}${b}`);
  if (next === text) continue;
  stale++;
  if (check) console.error(`stale index: ${file} (${name}) — run node scripts/harness/build-index.mjs`);
  else {
    writeFileSync(path, next);
    console.log(`updated ${file} (${name})`);
  }
}
if (check && stale) process.exit(1);
if (check) console.log('indexes current');
