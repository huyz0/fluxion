#!/usr/bin/env node
// ADR-0176: core/editor are hard budgets; the two embedding targets are measured advisories.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { repoPath, run } from './lib.mjs';
import { t } from './thresholds.mjs';

const policy = new Map([
  ['player core', { limit: t('PLAYER_CORE_GZIP'), advisory: false }],
  ['player-inline', { limit: t('PLAYER_CORE_GZIP'), advisory: true }],
  ['fluxion-player script', { limit: t('PLAYER_CORE_GZIP'), advisory: true }],
  ['editor initial', { limit: t('EDITOR_INITIAL_GZIP'), advisory: false }],
]);
const invalid = (detail) => {
  throw new Error(`bundle measurement: ${detail}`);
};

/** Validate the complete tool result before treating any target overrun as advisory. */
export function judgeBundleReport(report, status, stderr = '') {
  if (!Array.isArray(report) || report.length !== policy.size) invalid('expected all four artifacts exactly once');
  if (![0, 1].includes(status) || stderr.trim()) invalid(`unexpected tool failure (exit ${status}): ${stderr.trim()}`);
  const seen = new Set();
  const results = report.map((item) => {
    const rule = policy.get(item?.name);
    if (!rule || seen.has(item.name)) invalid(`unknown or duplicate artifact ${item?.name}`);
    seen.add(item.name);
    if (!Number.isSafeInteger(item.size) || item.size < 0 || item.sizeLimit !== rule.limit) invalid(`invalid bytes/target for ${item.name}`);
    if (item.passed !== item.size <= rule.limit) invalid(`contradictory passed status for ${item.name}`);
    return { ...item, advisory: rule.advisory, overrun: Math.max(0, item.size - rule.limit) };
  });
  const expectedStatus = results.some((item) => !item.passed) ? 1 : 0;
  if (status !== expectedStatus) invalid('tool exit does not match complete measurements');
  return { ok: results.every((item) => item.passed || item.advisory), results };
}

function main() {
  const result = run('pnpm', ['exec', 'size-limit', '--json']);
  const dir = repoPath('.harness', 'artifacts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/size-limit.stdout.log`, result.stdout);
  writeFileSync(`${dir}/size-limit.stderr.log`, result.stderr);
  writeFileSync(`${dir}/bundle-size.json`, `${JSON.stringify({ valid: false, toolExit: result.status })}\n`);
  const raw = JSON.parse(result.stdout);
  const judged = judgeBundleReport(raw, result.status, result.stderr);
  writeFileSync(`${dir}/bundle-size.json`, `${JSON.stringify({ valid: true, toolExit: result.status, raw, ...judged }, null, 2)}\n`);
  for (const item of judged.results) {
    const status = item.passed ? 'PASS' : item.advisory ? 'ADVISORY' : 'FAIL';
    console.log(`${status} ${item.name}: ${item.size} bytes; ${item.advisory ? 'advisory target' : 'hard limit'} ${item.sizeLimit}; overrun ${item.overrun}`);
  }
  if (!judged.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`bundle-size: ${error.message}`);
    process.exitCode = 1;
  }
}
