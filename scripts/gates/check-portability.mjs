#!/usr/bin/env node
// Keep the harness usable from both Claude Code and Codex (NFR-DX-003).
// Rules: .agents/skills/README.md "Rules". Exit 1 with one line per violation.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frontMatter, node, readText, repoPath } from './lib.mjs';
import { t } from './thresholds.mjs';

const BUILTINS = new Set(['goal', 'plan', 'review', 'init', 'loop', 'compact', 'status', 'model',
  'skills', 'agents', 'help', 'clear', 'config', 'memory', 'resume', 'diff', 'approvals', 'new',
  'mcp', 'permissions', 'cost', 'doctor', 'login', 'logout', 'undo', 'quit', 'exit']);
const VENDOR_SYNTAX = [
  [/^@[\w./-]+\.md\s*$/m, '@import line (Claude-only)'],
  [/\$ARGUMENTS\b/, '$ARGUMENTS placeholder (Claude-only)'],
  [/!`[^`]+`/, '!`cmd` context injection (Claude-only)'],
  [/\b(TodoWrite|Bash\(|WebFetch\(|apply_patch)\b/, 'tool-specific built-in name'],
];

const errors = [];
const skillsDir = repoPath('.agents', 'skills');
const names = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

for (const name of names) {
  const file = join(skillsDir, name, 'SKILL.md');
  const where = `.agents/skills/${name}/SKILL.md`;
  if (!existsSync(file)) { errors.push(`${where}: missing`); continue; }
  const text = readFileSync(file, 'utf8');
  const fm = frontMatter(text);
  if (!fm) { errors.push(`${where}: no YAML front matter`); continue; }
  const { name: n, description: d } = fm.data;
  if (n !== name) errors.push(`${where}: name '${n}' must equal directory '${name}'`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) errors.push(`${where}: invalid name`);
  if (!d) errors.push(`${where}: description required`);
  else {
    if (d.length > 1024) errors.push(`${where}: description > 1024 chars`);
    if (/:\s/.test(d)) errors.push(`${where}: description contains ': ' (breaks strict YAML parsers)`);
    if (!/\bUse (when|whenever|before|at)\b/i.test(d)) errors.push(`${where}: description must say when to use it`);
  }
  const extraKeys = Object.keys(fm.data).filter((k) => !['name', 'description', 'license', 'compatibility', 'metadata'].includes(k));
  if (extraKeys.length) errors.push(`${where}: vendor-only keys ${extraKeys.join(', ')} belong in scripts/harness/skill-adapters.json`);
  if (BUILTINS.has(name)) errors.push(`${where}: name collides with a built-in command`);
  const lines = text.split(/\r?\n/).length;
  if (lines > t('SKILL_MAX_LINES')) errors.push(`${where}: ${lines} lines > ${t('SKILL_MAX_LINES')}`);
  for (const [re, what] of VENDOR_SYNTAX) if (re.test(fm.body)) errors.push(`${where}: ${what}`);
  // every scripts/... path a skill names must exist, unless the line says which milestone adds it
  for (const line of fm.body.split(/\r?\n/)) {
    for (const m of line.matchAll(/scripts\/[\w./-]+\.mjs/g)) {
      const p = m[0];
      if (p.includes('<') || existsSync(repoPath(p)) || /\bfrom M\d+\b|\(M\d+\)/.test(line)) continue;
      errors.push(`${where}: names missing script ${p}`);
    }
  }
}

const agents = readText('AGENTS.md');
for (const [re, what] of VENDOR_SYNTAX) if (re.test(agents)) errors.push(`AGENTS.md: ${what}`);
const agentsLines = agents.split(/\r?\n/).length;
if (agentsLines > t('AGENTS_MD_MAX_LINES')) errors.push(`AGENTS.md: ${agentsLines} lines > ${t('AGENTS_MD_MAX_LINES')}`);
for (const name of names) if (!agents.includes(`.agents/skills/${name}/SKILL.md`)) errors.push(`AGENTS.md: skill '${name}' missing from index`);

const claude = readText('CLAUDE.md').trim();
if (!claude.startsWith('@AGENTS.md')) errors.push('CLAUDE.md: must import @AGENTS.md (adapter only)');

const sync = node('scripts/harness/sync-skills.mjs', ['--check']);
if (sync.status !== 0) errors.push(...sync.stderr.trim().split(/\r?\n/).filter(Boolean));

if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`portability ok (${names.length} skills)`);
