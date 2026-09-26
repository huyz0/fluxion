#!/usr/bin/env node
// Optional deterministic Stop hook for Claude Code (.claude/settings.json "Stop") and Codex
// (.codex hooks "Stop"). Use it INSTEAD of the built-in /goal judge when a transcript-reading
// judge accepts passes that are not real — never both (double continuation).
//
// The hook's stdin payload is not read: every decision comes from repo state, and re-entrant
// stops are bounded by the block counter below rather than by stop_hook_active.
//   state.loopActive false            → allow stop (no output): normal sessions are unaffected
//   state.blockedReason set           → allow stop: a human must act
//   m<N>-complete exits 0             → allow stop, set loopActive=false, reset the counter
//   otherwise (red or missing gate)   → block via block(), which enforces the runaway cap:
//                                       after STOP_BLOCK_CAP blocks it allows the stop instead
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { currentMilestone, exists, node, readText, repoPath } from '../gates/lib.mjs';

const STOP_BLOCK_CAP = Number(process.env.FLUXION_STOP_BLOCK_CAP ?? 60);
const statePath = repoPath('.harness', 'state.json');
const counterPath = repoPath('.harness', 'tmp', 'stop-blocks');

function allow(why) {
  if (why) console.error(`stop-check: ${why}`);
  process.exit(0);
}

/** The only way this hook blocks — so the runaway cap cannot be bypassed. */
function block(reason) {
  const blocks = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) || 0 : 0;
  if (blocks >= STOP_BLOCK_CAP) allow(`block cap ${STOP_BLOCK_CAP} reached — stopping to avoid a runaway loop`);
  mkdirSync(repoPath('.harness', 'tmp'), { recursive: true });
  writeFileSync(counterPath, String(blocks + 1));
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
if (!state.loopActive) allow();
if (state.blockedReason) allow(`blocked: ${state.blockedReason}`);

const ms = state.milestone ?? currentMilestone();
const gate = `scripts/gates/${String(ms).toLowerCase()}-complete.mjs`;
if (!exists(gate)) block(`Completion gate ${gate} does not exist. Run the plan-milestone skill: write it first, red.`);

const r = node(gate, ['--summary']);
if (r.status === 0) {
  writeFileSync(statePath, `${JSON.stringify({ ...state, loopActive: false }, null, 2)}\n`);
  if (existsSync(counterPath)) rmSync(counterPath); // the next loop starts with a fresh cap
  allow();
}

const lastLine = (s) => s.trim().split(/\r?\n/).filter(Boolean).at(-1);
const summary = lastLine(r.stdout) || `gate ${gate} failed without a summary (exit ${r.status}): ${lastLine(r.stderr) ?? 'no output'}`;
const nextRow = exists('docs/backlog/current.md')
  ? readText('docs/backlog/current.md')
      .split(/\r?\n/)
      .find((l) => /^\| M\d+\.\d+ \|/.test(l) && /\| todo \|/.test(l))
  : undefined;
const next = nextRow ? nextRow.split('|')[1].trim() : 'none (run plan-milestone or milestone-review)';
block(`${summary}. Continue the drive loop: next backlog row ${next}. Print the EVIDENCE and GATE lines at the end of the turn.`);
