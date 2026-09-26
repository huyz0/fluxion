#!/usr/bin/env node
// M0.13 cross-vendor reviewer smoke, safe by construction (M0 cp2 F2):
//   node scripts/harness/kits/smoke.mjs
// For each direction it seeds a real defect in a THROWAWAY detached worktree, rewrites the M0.13
// backlog row there to a plausible "no behaviour change" task (unstaged), stages only the seed,
// builds the review packet and runs the other vendor's reviewer, and records the verdict in the
// worktree. Only the resulting digest lines and .harness/reviews/cross-vendor-smoke.json are
// copied back; the worktree (with its seed and any pass verdict bound to the seed) is deleted, so
// nothing in the main checkout can make the seed committable.
// Test hook: FLUXION_SMOKE_FAKE_REVIEWER=<script> runs `node <script> <packet> <vendor>` instead of
// the real CLI (tests/harness/kits.test.mjs).
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, repoPath } from '../../gates/lib.mjs';

const TASK = 'M0.13';
const SEEDS = [
  {
    author: 'claude', reviewer: 'codex', file: 'scripts/gates/check-size.mjs',
    from: 'if (n > max)', to: 'if (n >= max)',
    task: 'Tidy the cap comparison in check-size (no behaviour change: a file exactly at the cap still passes)',
    defect: 'files exactly at the cap are rejected (off-by-one)',
  },
  {
    author: 'codex', reviewer: 'claude', file: 'scripts/gates/check-tests-kept.mjs',
    from: 'if (c.removed > c.added)', to: 'if (c.removed > c.added + 1)',
    task: 'Simplify test-case counting in check-tests-kept (no behaviour change: any net removal still needs a trailer)',
    defect: 'one net removed test case per file passes without a Removes-test trailer',
  },
];

// Throw (never process.exit) so the finally block always removes the seeded worktree.
class SmokeError extends Error {}
const die = (m) => { throw new SmokeError(m); };
const wt = join(mkdtempSync(join(tmpdir(), 'fluxion-smoke-')), 'wt');
// git's hook variables (GIT_INDEX_FILE=.git/index …) would break git inside a linked worktree
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || k === 'GIT_EXEC_PATH'));
const inWt = (cmd, args, input) => spawnSync(cmd, args, { cwd: wt, encoding: 'utf8', input, env, maxBuffer: 64 * 1024 * 1024 });
const nodeWt = (script, args) => inWt(process.execPath, [join(wt, script), ...args]);

if (git(['worktree', 'add', '--detach', wt, 'HEAD']).status !== 0) {
  console.error('smoke: cannot create worktree');
  process.exit(1);
}
const runs = [];
let failure = null;
try {
  const digestPath = join(wt, '.harness', 'reviews', 'digest.log');
  const before = existsSync(digestPath) ? readFileSync(digestPath, 'utf8') : '';
  for (const s of SEEDS) {
    const target = join(wt, s.file);
    const src = readFileSync(target, 'utf8');
    if (!src.includes(s.from)) die(`seed anchor not found in ${s.file}: ${s.from}`);
    writeFileSync(target, src.replace(s.from, s.to));
    const backlog = join(wt, 'docs', 'backlog', 'current.md');
    const rows = readFileSync(backlog, 'utf8').replace(/^\| M0\.13 \|.*$/m, `| ${TASK} | ${s.task} | NFR-DX-003 | THE SYSTEM SHALL keep behaviour unchanged | — | doing | |`);
    writeFileSync(backlog, rows);
    inWt('git', ['add', s.file]);
    const packet = nodeWt('scripts/harness/review.mjs', ['context', '--task', TASK]);
    if (packet.status !== 0) die(`packet failed: ${packet.stderr}`);
    mkdirSync(join(wt, '.harness', 'tmp'), { recursive: true }); // gitignored, absent in a fresh worktree
    const packetFile = join(wt, '.harness', 'tmp', 'smoke-packet.md');
    writeFileSync(packetFile, packet.stdout);
    const fake = process.env.FLUXION_SMOKE_FAKE_REVIEWER;
    const r = fake
      ? inWt(process.execPath, [fake, packetFile, s.reviewer])
      : nodeWt('scripts/harness/run-reviewer.mjs', ['--task', TASK, '--reviewer', s.reviewer]);
    if (r.status !== 0) die(`${s.reviewer} reviewer failed: ${r.stderr}`);
    const verdictFile = fake ? join(wt, '.harness', 'tmp', 'smoke-verdict.json') : join(wt, '.harness', 'tmp', 'verdict.json');
    if (fake) writeFileSync(verdictFile, r.stdout);
    const verdict = JSON.parse(readFileSync(verdictFile, 'utf8'));
    const rec = nodeWt('scripts/harness/review.mjs', ['record', '--file', verdictFile, '--task', TASK]);
    if (rec.status !== 0) die(`record failed: ${rec.stderr}`);
    const caught = (verdict.findings ?? []).some((f) => f.file === s.file && ['blocking', 'major'].includes(f.severity));
    runs.push({ author: s.author, reviewer: s.reviewer, seededDefect: `${s.file}: ${s.defect}`, diff_sha256: verdict.diff_sha256, caught });
    console.log(`${s.author}->${s.reviewer}: ${caught ? 'CAUGHT' : 'missed'} (${verdict.verdict}, ${(verdict.findings ?? []).length} findings)`);
    // undo only the seed and the rewritten row; the digest line just recorded must survive
    inWt('git', ['reset', '-q']);
    inWt('git', ['checkout', '--', s.file, 'docs/backlog/current.md']);
  }
  const after = readFileSync(digestPath, 'utf8');
  const newLines = after.slice(before.length);
  if (newLines.split('\n').filter(Boolean).length !== SEEDS.length) die(`expected ${SEEDS.length} new digest lines, got: ${JSON.stringify(newLines)}`);
  const mainDigest = repoPath('.harness', 'reviews', 'digest.log');
  appendFileSync(mainDigest, newLines);
  writeFileSync(repoPath('.harness', 'reviews', 'cross-vendor-smoke.json'), `${JSON.stringify({ task: TASK, date: new Date().toISOString().slice(0, 10), runs }, null, 2)}\n`);
  console.log(`smoke: wrote .harness/reviews/cross-vendor-smoke.json (${runs.filter((r) => r.caught).length}/${runs.length} caught); stage it with digest.log in the M0.13 commit`);
} catch (e) {
  failure = e;
} finally {
  git(['worktree', 'remove', '--force', wt]);
  git(['worktree', 'prune']);
  rmSync(join(wt, '..'), { recursive: true, force: true });
}
if (failure) {
  console.error(`smoke: ${failure instanceof SmokeError ? failure.message : failure.stack}`);
  console.error('smoke: nothing was copied back; the throwaway worktree was removed');
  process.exit(1);
}
