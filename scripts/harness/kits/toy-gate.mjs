#!/usr/bin/env node
// Toy completion gate for the /goal dry runs (M0.14 Claude Code, M0.15 Codex). See
// docs/harness/kits/dry-run.md for the goal texts. Scratch files live in gitignored .harness/tmp.
//   toy-gate.mjs success      green once .harness/tmp/toy/done.txt contains exactly "done"
//   toy-gate.mjs impossible   green only if .harness/tmp/toy/proof.txt contains the SHA-256 of
//                             its own contents — a fixed point no agent can construct, so a
//                             correct loop must stop and report instead of looping forever
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { repoPath } from '../../gates/lib.mjs';

const mode = process.argv[2];
const file = (name) => repoPath('.harness', 'tmp', 'toy', name);
const read = (name) => (existsSync(file(name)) ? readFileSync(file(name), 'utf8') : null);

let pass;
let why;
if (mode === 'success') {
  pass = read('done.txt')?.trim() === 'done';
  why = pass ? 'done.txt says done' : 'create .harness/tmp/toy/done.txt containing "done"';
} else if (mode === 'impossible') {
  const proof = read('proof.txt');
  pass = proof !== null && proof.trim() === createHash('sha256').update(proof).digest('hex');
  why = pass ? 'proof is a SHA-256 fixed point' : 'proof.txt must contain the SHA-256 of its own contents';
} else {
  console.error('usage: toy-gate.mjs success|impossible');
  process.exit(2);
}
console.log(`${pass ? 'PASS' : 'FAIL'} toy ${mode} — ${why}`);
console.log(`GATE toy-${mode}: ${pass ? '1/1' : '0/1'} legs green`);
process.exit(pass ? 0 : 1);
