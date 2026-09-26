#!/usr/bin/env node
// Run an independent reviewer on the packet, preferring the OTHER vendor's CLI (decorrelated
// blind spots; docs/standards/review.md).
//   run-reviewer.mjs --task M3.4 [--reviewer codex|claude] [--kind code|plan]
//   run-reviewer.mjs --milestone M3 [--reviewer …]
// Writes the reviewer's JSON to .harness/tmp/verdict.json (or milestone-verdict.json).
// It does not record the verdict: the author runs `review.mjs record` so a malformed verdict
// is rejected loudly. Author vendor is detected from env; override with --reviewer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { node, repoPath, run } from '../gates/lib.mjs';

const args = process.argv.slice(2);
const arg = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const task = arg('task');
const milestone = arg('milestone');
if (!task && !milestone) {
  console.error('usage: run-reviewer.mjs --task ID | --milestone M<n> [--reviewer codex|claude]');
  process.exit(2);
}

const author = process.env.CLAUDECODE ? 'claude' : process.env.CODEX_SANDBOX || process.env.CODEX_HOME ? 'codex' : 'unknown';
const reviewer = arg('reviewer') ?? (author === 'claude' ? 'codex' : 'claude');

const packet = task
  ? node('scripts/harness/review.mjs', ['context', '--task', task])
  : node('scripts/harness/review.mjs', ['milestone', '--milestone', milestone]);
if (packet.status !== 0) {
  console.error(packet.stderr);
  process.exit(1);
}

mkdirSync(repoPath('.harness', 'tmp'), { recursive: true });
const packetFile = repoPath('.harness', 'tmp', task ? 'packet.md' : 'milestone-packet.md');
writeFileSync(packetFile, packet.stdout);

const prompt = `You are an independent ${task ? 'code' : 'milestone'} reviewer. You did not write this change. Read ${packetFile} and follow the instructions inside it. Respond with ONLY the verdict JSON, no prose.`;
const cmd =
  reviewer === 'codex'
    ? run('codex', ['exec', '--sandbox', 'read-only', prompt])
    : run('claude', ['-p', '--agent', task ? 'reviewer' : 'milestone-reviewer', '--permission-mode', 'plan', prompt]);
if (cmd.status !== 0) {
  console.error(`${reviewer} CLI failed (${cmd.status}). Fall back to your tool's isolated subagent with ${packetFile}.\n${cmd.stderr}`);
  process.exit(1);
}
const json = /\{[\s\S]*\}/.exec(cmd.stdout)?.[0];
if (!json) {
  console.error(`no JSON in ${reviewer} output:\n${cmd.stdout.slice(-2000)}`);
  process.exit(1);
}
const out = repoPath('.harness', 'tmp', task ? 'verdict.json' : 'milestone-verdict.json');
writeFileSync(out, json);
console.log(`reviewer=${reviewer} wrote ${out}. Next: node scripts/harness/review.mjs record --file ${out} --task ${task ?? '<n/a>'}`);
