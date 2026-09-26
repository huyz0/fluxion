#!/usr/bin/env node
// The single required status check (ci-cd.md section 3): passes only when every job ci-ok needs
// succeeded. `skipped` and `cancelled` fail too, so a job skipped by a failed dependency cannot
// read as green.
//   all-green.mjs '<toJSON(needs)>'   or   NEEDS='<toJSON(needs)>' all-green.mjs
const raw = process.argv[2] ?? process.env.NEEDS;
if (!raw) {
  console.error('usage: all-green.mjs <needs-json> (or NEEDS env)');
  process.exit(2);
}
const needs = JSON.parse(raw);
const jobs = Object.entries(needs);
if (jobs.length === 0) {
  console.error('ci-ok: no jobs in needs — nothing proves the run green');
  process.exit(1);
}
const bad = jobs.filter(([, j]) => j?.result !== 'success');
for (const [name, j] of jobs) console.log(`${j?.result === 'success' ? 'PASS' : 'FAIL'} ${name} (${j?.result ?? 'no result'})`);
console.log(`ci-ok: ${bad.length ? 'FAIL' : 'PASS'} (${jobs.length - bad.length}/${jobs.length} jobs succeeded)`);
process.exit(bad.length ? 1 : 0);
