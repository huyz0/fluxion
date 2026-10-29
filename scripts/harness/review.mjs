#!/usr/bin/env node
// Turn a review from a claim into an artifact bound to the exact staged bytes.
//   review.mjs hash                                  sha256 of `git diff --cached --binary`
//   review.mjs content [--commit <sha>]              rebase-stable content identity (ADR-0195)
//   review.mjs context --task M3.4 [--commit <sha>]  reviewer packet (markdown) to stdout
//   review.mjs record --file v.json --task M3.4 [--commit <sha>]  validate + store .harness/review/<hash>.json
// --commit reviews a landed commit after the fact (evidence recovery, M18.99); the verdict binds
// to that commit's content identity instead of the staged diff.
//   review.mjs rebind --task M3.4 --commit <sha> --line <n>   bind digest line n (a pass of that exact diff) to the commit
//   review.mjs show                                  stored verdicts for the staged diff
//   review.mjs milestone --milestone M3              milestone-review packet to stdout
// The script owns hash, packet, schema and artifact; the reviewing agent owns the judgement.
// The packet never includes the author's reasoning (docs/standards/review.md).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { currentMilestone, exists, git, node, readText, repoPath, stagedDiff, stagedHash } from '../gates/lib.mjs';
import { contentId, contentIds, nextRound, parseDigest, parseReviewer, reviewedDiffHash } from '../gates/review-content.mjs';
import { t } from '../gates/thresholds.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k) => {
  const i = rest.indexOf(`--${k}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const REVIEW_DIR = repoPath('.harness', 'review');
const die = (m, code = 1) => {
  console.error(m);
  process.exit(code);
};

function taskRow(id) {
  const line = readText('docs/backlog/current.md')
    .split(/\r?\n/)
    .find((l) => new RegExp(`^\\|\\s*${id.replace('.', '\\.')}\\s*\\|`).test(l));
  return line ?? die(`task ${id} not in docs/backlog/current.md`);
}
// which standards a reviewer gets, by staged path
const STANDARDS_BY_PATH = [
  [/^packages\/(schema|format)|contracts/, ['contracts.md']],
  [/\.(ts|tsx)$/, ['coding-typescript.md', 'code-structure.md']],
  [/^(packages\/(editor|render|player)|apps\/studio)/, ['design-ui.md', 'performance.md']],
  [/sanitiz|security|plugin|sandbox|format/, ['security.md']],
  [/^\.github|^scripts|^\.githooks/, ['ci-cd.md']],
  [/^docs\//, ['documentation.md']],
];
function standardsFor(paths) {
  const pick = new Set(['review.md', 'testing.md']);
  for (const [re, files] of STANDARDS_BY_PATH) if (paths.some((p) => re.test(p))) for (const f of files) pick.add(f);
  return [...pick].filter((f) => exists(`docs/standards/${f}`)).map((f) => `docs/standards/${f}`);
}
function verdictsFor(hash) {
  if (!existsSync(REVIEW_DIR)) return [];
  return readdirSync(REVIEW_DIR)
    .filter((f) => f.startsWith(hash))
    .map((f) => JSON.parse(readFileSync(join(REVIEW_DIR, f), 'utf8')));
}
const DIGEST = repoPath('.harness', 'reviews', 'digest.log');
const tracked = () => parseDigest(existsSync(DIGEST) ? readFileSync(DIGEST, 'utf8') : '');
/** The digest as HEAD commits it: rounds already committed are closed (M18.177). */
function committedDigest() {
  const at = git(['show', 'HEAD:.harness/reviews/digest.log']);
  return parseDigest(at.status === 0 ? at.stdout : '');
}
/** Rounds are numbered from the tracked digest, which every worktree shares through history (M18.127), among lines not yet committed (M18.177). */
const roundOf = (task, content = '') => nextRound(tracked(), task, { content, committed: committedDigest() });
function roundsFor(task) {
  if (!existsSync(REVIEW_DIR)) return [];
  return readdirSync(REVIEW_DIR)
    .map((f) => JSON.parse(readFileSync(join(REVIEW_DIR, f), 'utf8')))
    .filter((v) => v.task === task);
}

switch (cmd) {
  case 'hash':
    console.log(stagedHash());
    break;

  case 'content':
    console.log(contentId(arg('commit')));
    break;

  case 'context': {
    const task = arg('task') ?? die('--task required', 2);
    const commit = arg('commit');
    const diff = commit ? git(['show', '--binary', '--no-color', '--format=', commit]).stdout : stagedDiff();
    if (!diff.trim()) die(commit ? `commit ${commit} has no diff` : 'nothing staged');
    const paths = git(commit ? ['diff', '--name-only', `${commit}^`, commit] : ['diff', '--cached', '--name-only'])
      .stdout.split(/\r?\n/)
      .filter(Boolean);
    const { round } = roundOf(task, contentId(commit));
    const gates = commit
      ? `(landed commit ${commit}: gates ran when it was committed)`
      : node('scripts/gates/precommit.mjs', ['--staged', '--summary', '--no-review']).stdout.trim();
    console.log(`# Review packet — ${task} (round ${round} of max ${t('REVIEW_ROUND_CAP')})\n`);
    if (!commit) console.log(`diff_sha256: ${stagedHash()}\n`);
    console.log(`content_id: ${contentId(commit)}\n`);
    console.log(`## Task (verbatim from backlog)\n\n${taskRow(task)}\n`);
    console.log(
      `## Standards to apply\n\n${standardsFor(paths)
        .map((s) => `- ${s}`)
        .join('\n')}\n`,
    );
    console.log(`## Deterministic gates already run (do not re-check these)\n\n\`\`\`\n${gates}\n\`\`\`\n`);
    const prev = roundsFor(task).at(-1);
    if (prev) console.log(`## Previous round findings\n\n\`\`\`json\n${JSON.stringify(prev.findings, null, 2)}\n\`\`\`\n`);
    console.log(`## Instructions\n\nFollow .agents/skills/code-review/SKILL.md "As the reviewer". Output ONLY the verdict JSON.\n`);
    console.log(`## ${commit ? `Diff of commit ${commit}` : 'Staged diff'}\n\n\`\`\`diff\n${diff}\n\`\`\``);
    break;
  }

  case 'record': {
    const file = arg('file') ?? die('--file required', 2);
    const task = arg('task') ?? die('--task required', 2);
    const v = JSON.parse(readFileSync(file, 'utf8'));
    const commit = arg('commit');
    const hash = commit ? (v.diff_sha256 ?? '') : stagedHash();
    const content = contentId(commit);
    const ids = contentIds(commit);
    const bad = [];
    if (v.task !== task) bad.push(`task '${v.task}' != '${task}'`);
    // A staged review binds to the exact bytes or, after a rebase or bookkeeping restage, to the same content identity.
    if (commit) {
      if (!ids.includes(v.content_id)) bad.push(`content_id does not match commit ${commit}`);
    } else if (v.diff_sha256 !== hash && !(v.content_id && ids.includes(v.content_id)))
      bad.push('diff_sha256 does not match the staged diff (restaged after review?)');
    if (!content) bad.push('the change has no reviewable content (bookkeeping and generated reports only)');
    if (!['pass', 'changes-requested'].includes(v.verdict)) bad.push('verdict must be pass|changes-requested');
    if (!parseReviewer(v.reviewer)) bad.push(`reviewer '${v.reviewer ?? ''}' must be vendor:role[:posthoc] (lowercase, e.g. claude:independent-subagent)`);
    if (commit && !parseReviewer(v.reviewer)?.posthoc) bad.push('a review of a landed commit (--commit) is posthoc: reviewer vendor:role:posthoc');
    if (!Array.isArray(v.findings)) bad.push('findings[] required');
    for (const f of v.findings ?? []) {
      if (!f.file || !f.severity || !f.failure_scenario) bad.push(`finding ${f.id ?? '?'} needs file, severity, failure_scenario`);
      if (!['blocking', 'major', 'minor'].includes(f.severity)) bad.push(`finding ${f.id ?? '?'} severity invalid`);
    }
    if (v.verdict === 'pass' && (v.findings ?? []).some((f) => f.severity === 'blocking')) bad.push('pass with blocking findings');
    if (bad.length) die(`verdict rejected:\n- ${bad.join('\n- ')}`);
    const { round, reapply } = roundOf(task, content);
    mkdirSync(REVIEW_DIR, { recursive: true });
    const name = `${hash || content}.r${round}.json`;
    writeFileSync(join(REVIEW_DIR, name), JSON.stringify({ ...v, content_id: content, round, recordedAt: new Date().toISOString() }, null, 2));
    // Tracked digest so history shows non-negotiable 4 held (M0 cp1 F2). The digest is bookkeeping,
    // outside the content identity, so it is staged with the commit it reviews (ADR-0195).
    mkdirSync(dirname(DIGEST), { recursive: true });
    appendFileSync(
      DIGEST,
      `${v.task}\t${hash || '-'}\tr${round}\t${v.verdict}\t${v.reviewer}\t${(v.findings ?? []).length} findings\tcontent:${content}${reapply ? '\treapply' : ''}\n`,
    );
    console.log(
      `recorded ${v.verdict} for ${task} round ${round}${reapply ? ' (reapply)' : ''} (${(hash || content).slice(0, 12)}); stage .harness/reviews/digest.log with this change`,
    );
    if (round > t('REVIEW_ROUND_CAP') && v.verdict !== 'pass') die(`round cap ${t('REVIEW_ROUND_CAP')} exceeded — stop (drive stop condition)`, 3);
    break;
  }

  case 'rebind': {
    // Bind an earlier pass line to a landed commit whose diff it reviewed byte for byte, e.g. a line
    // recorded before content ids existed. It is marked `rebind`, never a reviewer verdict (M18.127).
    const task = arg('task') ?? die('--task required', 2);
    const commit = arg('commit') ?? die('--commit required', 2);
    const n = Number(arg('line'));
    const lines = tracked();
    const bound = lines[n - 1] ?? die(`--line ${arg('line')}: no such digest line`, 2);
    const hash = reviewedDiffHash(commit);
    const bad = [];
    if (bound.task !== task || bound.verdict !== 'pass') bad.push(`line ${n} is not a pass line of ${task}`);
    if (bound.hash !== hash) bad.push(`line ${n} reviewed diff ${bound.hash.slice(0, 12)}, not commit ${commit}'s ${hash.slice(0, 12)}`);
    if (bad.length) die(`rebind refused:\n- ${bad.join('\n- ')}`);
    appendFileSync(DIGEST, `${task}\t${hash}\t${bound.round}\trebind\t${bound.reviewer}\t${bound.findings}\tcontent:${contentId(commit)}\tbound:${n}\n`);
    console.log(`rebound ${task} line ${n} to ${commit}; stage .harness/reviews/digest.log`);
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
      ? node(`scripts/gates/${ms.toLowerCase()}-complete.mjs`).stdout
      : '(completion gate missing)';
    console.log(`## Completion gate output\n\n\`\`\`\n${gate}\n\`\`\`\n`);
    if (exists('.harness/baselines/review-argued.txt')) console.log(`## Argued findings\n\n${readText('.harness/baselines/review-argued.txt')}\n`);
    console.log('## Instructions\n\nFollow .agents/skills/milestone-review/SKILL.md. Output the verdict JSON described there.');
    break;
  }

  default:
    die(
      'usage: review.mjs hash | content [--commit SHA] | context --task ID [--commit SHA] | record --file v.json --task ID [--commit SHA] | show | milestone [--milestone M<n>]',
      2,
    );
}
