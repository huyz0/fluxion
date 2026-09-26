#!/usr/bin/env node
// Zero-flake policy (testing.md rule 19, NFR-DX-004): read a merged Playwright JSON report and fail
// when any test was flaky (failed, then passed on retry) or failed, or when no test ran at all.
//   flake-report.mjs <report.json>
// Writes a Markdown summary to $GITHUB_STEP_SUMMARY when set. Retries in playwright.config.ts are
// detect-only: a flake still fails CI until it is quarantined with a backlog row.
import { appendFileSync, readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: flake-report.mjs <report.json>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(file, 'utf8'));

const tests = [];
const walk = (suite, path) => {
  const here = suite.title ? [...path, suite.title] : path;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) tests.push({ title: [...here, spec.title].join(' › '), project: test.projectName ?? '', status: test.status });
  }
  for (const child of suite.suites ?? []) walk(child, here);
};
for (const suite of report.suites ?? []) walk(suite, []);

const by = (s) => tests.filter((t) => t.status === s);
const flaky = by('flaky');
const failed = by('unexpected');
const ran = tests.filter((t) => t.status !== 'skipped');
const lines = [`flake-report: ${ran.length} run, ${flaky.length} flaky, ${failed.length} failed, ${tests.length - ran.length} skipped`];
for (const t of flaky) lines.push(`FLAKY [${t.project}] ${t.title} — quarantine within 24 h with a backlog row (testing.md rule 19)`);
for (const t of failed) lines.push(`FAILED [${t.project}] ${t.title}`);
// a broken merge or an all-empty shard set must not read as green
if (ran.length === 0) lines.push('flake-report: no test ran — an empty report is not a pass');

for (const l of lines) console.log(l);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### E2E flake report\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
process.exit(flaky.length === 0 && failed.length === 0 && ran.length > 0 ? 0 : 1);
