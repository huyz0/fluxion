#!/usr/bin/env node
// Turn a review from a claim into an artifact bound to the exact staged bytes.
//   review.mjs hash                                  sha256 of `git diff --cached --binary`
//   review.mjs context --task M3.4                   reviewer packet (markdown) to stdout
//   review.mjs record --file v.json --task M3.4      validate + store .harness/review/<hash>.json
//   review.mjs show                                  stored verdicts for the staged diff
//   review.mjs milestone --milestone M3              milestone-review packet to stdout
// The script owns hash, packet, schema and artifact; the reviewing agent owns the judgement.
// The packet never includes the author's reasoning (docs/standards/review.md).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentMilestone, exists, git, node, readText, repoPath, stagedDiff, stagedHash } from '../gates/lib.mjs';
import { t } from '../gates/thresholds.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
const REVIEW_DIR = repoPath('.harness', 'review');
const die = (m, code = 1) => { console.error(m); process.exit(code); };

function taskRow(id) {
  const line = readText('docs/backlog/current.md').split(/\r?\n/).find((l) => new RegExp(`^\\|\\s*${id.replace('.', '\\.')}\\s*\\|`).test(l));
  return line ?? die(`task ${id} not in docs/backlog/current.md`);
}
function standardsFor(paths) {
  const pick = new Set(['review.md', 'testing.md']);
  for (const p of paths) {
    if (/^packages\/(schema|format)|contracts/.test(p)) pick.add('contracts.md');
    if (/\.(ts|tsx)$/.test(p)) { pick.add('coding-typescript.md'); pick.add('code-structure.md'); }
    if (/^(packages\/(editor|render|player)|apps\/studio)/.test(p)) { pick.add('design-ui.md'); pick.add('performance.md'); }
    if (/sanitiz|security|plugin|sandbox|format/.test(p)) pick.add('security.md');
    if (/^\.github|^scripts|^\.githooks/.test(p)) pick.add('ci-cd.md');
    if (/^docs\//.test(p)) pick.add('documentation.md');
  }
  return [...pick].filter((f) => exists(`docs/standards/${f}`)).map((f) => `docs/standards/${f}`);
}
function verdictsFor(hash) {
  if (!existsSync(REVIEW_DIR)) return [];
  return readdirSync(REVIEW_DIR).filter((f) => f.startsWith(hash)).map((f) => JSON.parse(readFileSync(join(REVIEW_DIR, f), 'utf8')));
}
function roundsFor(task) {
  if (!existsSync(REVIEW_DIR)) return [];
  return readdirSync(REVIEW_DIR).map((f) => JSON.parse(readFileSync(join(REVIEW_DIR, f), 'utf8'))).filter((v) => v.task === task);
}

switch (cmd) {
  case 'hash':
    console.log(stagedHash());
    break;

  case 'context': {
    const task = arg('task') ?? die('--task required', 2);
    const diff = stagedDiff();
    if (!diff.trim()) die('nothing staged');
    const paths = git(['diff', '--cached', '--name-only']).stdout.split(/\r?\n/).filter(Boolean);
    const round = roundsFor(task).length + 1;
    const gates = node('scripts/gates/precommit.mjs', ['--staged', '--summary', '--no-review']).stdout.trim();
    console.log(`# Review packet — ${task} (round ${round} of max ${t('REVIEW_ROUND_CAP')})\n`);
    console.log(`diff_sha256: ${stagedHash()}\n`);
    console.log(`## Task (verbatim from backlog)\n\n${taskRow(task)}\n`);
    console.log(`## Standards to apply\n\n${standardsFor(paths).map((s) => `- ${s}`).join('\n')}\n`);
    console.log(`## Deterministic gates already run (do not re-check these)\n\n\`\`\`\n${gates}\n\`\`\`\n`);
    const prev = roundsFor(task).at(-1);
    if (prev) console.log(`## Previous round findings\n\n\`\`\`json\n${JSON.stringify(prev.findings, null, 2)}\n\`\`\`\n`);
    console.log(`## Instructions\n\nFollow .agents/skills/code-review/SKILL.md "As the reviewer". Output ONLY the verdict JSON.\n`);
    console.log(`## Staged diff\n\n\`\`\`diff\n${diff}\n\`\`\``);
    break;
  }

  case 'record': {
    const file = arg('file') ?? die('--file required', 2);
    const task = arg('task') ?? die('--task required', 2);
    const v = JSON.parse(readFileSync(file, 'utf8'));
    const hash = stagedHash();
    const bad = [];
    if (v.task !== task) bad.push(`task '${v.task}' != '${task}'`);
    if (v.diff_sha256 !== hash) bad.push('diff_sha256 does not match the staged diff (restaged after review?)');
    if (!['pass', 'changes-requested'].includes(v.verdict)) bad.push('verdict must be pass|changes-requested');
    if (!v.reviewer) bad.push('reviewer required');
    if (!Array.isArray(v.findings)) bad.push('findings[] required');
    for (const f of v.findings ?? []) {
      if (!f.file || !f.severity || !f.failure_scenario) bad.push(`finding ${f.id ?? '?'} needs file, severity, failure_scenario`);
      if (!['blocking', 'major', 'minor'].includes(f.severity)) bad.push(`finding ${f.id ?? '?'} severity invalid`);
    }
    if (v.verdict === 'pass' && (v.findings ?? []).some((f) => f.severity === 'blocking')) bad.push('pass with blocking findings');
    if (bad.length) die(`verdict rejected:\n- ${bad.join('\n- ')}`);
    const round = roundsFor(task).length + 1;
    mkdirSync(REVIEW_DIR, { recursive: true });
    writeFileSync(join(REVIEW_DIR, `${hash}.r${round}.json`), JSON.stringify({ ...v, round, recordedAt: new Date().toISOString() }, null, 2));
    console.log(`recorded ${v.verdict} for ${task} round ${round} (${hash.slice(0, 12)})`);
    if (round > t('REVIEW_ROUND_CAP') && v.verdict !== 'pass') die(`round cap ${t('REVIEW_ROUND_CAP')} exceeded — stop (drive stop condition)`, 3);
    break;
  }

  case 'show':
    console.log(JSON.stringify(verdictsFor(stagedHash()), null, 2));
    break;

  case 'milestone': {
    const ms = arg('milestone') ?? currentMilestone();
    console.log(`# Milestone review packet — ${ms}\n`);
    if (exists(`docs/milestones/${ms}.md`)) console.log(`## Plan\n\n${readText(`docs/milestones/${ms}.md`)}\n`);
    console.log(`## Backlog\n\n${readText('docs/backlog/current.md')}\n`);
    const log = git(['log', '--no-merges', '--stat', '--format=%n### %h %s', `--grep=^${ms}\\.`]).stdout;
    console.log(`## Commits\n${log}\n`);
    const gate = exists(`scripts/gates/${ms.toLowerCase()}-complete.mjs`)
      ? node(`scripts/gates/${ms.toLowerCase()}-complete.mjs`).stdout : '(completion gate missing)';
    console.log(`## Completion gate output\n\n\`\`\`\n${gate}\n\`\`\`\n`);
    if (exists('.harness/baselines/review-argued.txt')) console.log(`## Argued findings\n\n${readText('.harness/baselines/review-argued.txt')}\n`);
    console.log('## Instructions\n\nFollow .agents/skills/milestone-review/SKILL.md. Output the verdict JSON described there.');
    break;
  }

  default:
    die('usage: review.mjs hash | context --task ID | record --file v.json --task ID | show | milestone [--milestone M<n>]', 2);
}
