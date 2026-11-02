#!/usr/bin/env node
// M18.222 (cp32 F1): lists every unit test whose slowest reading, across the OSes and runs given,
// used more than half of its timeout. Main went red three times in one day on tests that passed
// on ubuntu and timed out on a loaded windows or macOS runner (M18.220, M18.221); the readings
// show that headroom before the next slow runner does.
//
// Readings come from tools/vitest/durations-reporter.mjs: CI's verify job writes one file per OS
// and uploads it as the artifact test-durations-<os>.
//
//   node scripts/harness/test-headroom.mjs --run <ci run id> [--run <id>…]   download with gh
//   node scripts/harness/test-headroom.mjs --file <durations.json> […]       offline
//   [--previous <durations.json> …] [--warn-only] [--share 0.5] [--json]
// Exit 1 when a test is listed, 0 when none is, 2 when no reading could be read or a report holds none.
// With --previous (the same OS's report from the run before), a test is only a warning the first time: exit 1 needs it over
// the share in both runs (M18.224, cp33 F1). CI's verify job runs it that way, so one slow runner does not redden main; with no
// previous report it passes --warn-only, which lists without failing (a report with no readings still exits 2).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ module: string, name: string, project: string, durationMs: number, timeoutMs: number }} Reading
 * @typedef {{ platform: string, run?: string, tests: Reading[] }} Report
 */

/**
 * The tests whose slowest reading is over `share` of its timeout, slowest share first.
 * @param {Report[]} reports
 * @param {number} [share]
 */
export function headroom(reports, share = 0.5) {
  /** @type {Map<string, { module: string, name: string, timeoutMs: number, worst: { platform: string, run?: string, durationMs: number }, share: number }>} */
  const tests = new Map();
  const readings = reports.flatMap((report) => report.tests.filter((t) => t.timeoutMs > 0).map((t) => ({ report, t, used: t.durationMs / t.timeoutMs })));
  for (const { report, t, used } of readings) {
    const key = `${t.project}\u0000${t.module}\u0000${t.name}`;
    if ((tests.get(key)?.share ?? -1) >= used) continue;
    const worst = { platform: report.platform, ...(report.run ? { run: report.run } : {}), durationMs: t.durationMs };
    tests.set(key, { module: t.module, name: t.name, timeoutMs: t.timeoutMs, worst, share: used });
  }
  return [...tests.values()].filter((t) => t.share > share).sort((a, b) => b.share - a.share);
}

/** @param {string} dir */
const jsonFiles = (dir) =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => join(dir, f))
    .filter((f) => f.endsWith('.json') && statSync(f).isFile());

/** @param {string} run */
function download(run) {
  const dir = mkdtempSync(join(tmpdir(), `headroom-${run}-`));
  const r = spawnSync('gh', ['run', 'download', run, '--pattern', 'test-durations-*', '--dir', dir], { encoding: 'utf8' });
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`gh run download ${run}: ${(r.stderr || r.error?.message || '').trim()}`);
  }
  return { dir, files: jsonFiles(dir) };
}

/** @param {string} file @param {string} [run] @returns {Report} */
const readReport = (file, run) => {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof r?.platform !== 'string' || !Array.isArray(r.tests)) throw new Error(`${file}: not a durations report`);
  // an empty report reads as "nothing slow"; it means the reporter stopped recording (M18.222 R1 F1)
  if (r.tests.length === 0) throw new Error(`${file}: a durations report with no readings`);
  return { platform: r.platform, ...(run ? { run } : {}), tests: r.tests };
};

/**
 * The listed tests also over `share` in the previous run's reports: those fail a run.
 * @param {ReturnType<typeof headroom>} listed @param {Report[]} previous @param {number} share
 */
export const persistent = (listed, previous, share) => {
  const before = new Set(headroom(previous, share).map((t) => `${t.module}\u0000${t.name}`));
  return listed.filter((t) => before.has(`${t.module}\u0000${t.name}`));
};

/**
 * @param {Report[]} reports @param {ReturnType<typeof headroom>} listed @param {number} share
 * @param {ReturnType<typeof headroom>} twice the listed tests also over in the previous run
 */
function print(reports, listed, share, twice) {
  const where = [...new Set(reports.map((r) => `${r.platform}${r.run ? `@${r.run}` : ''}`))].join(', ');
  for (const t of listed) {
    const run = t.worst.run ? ` in run ${t.worst.run}` : '';
    console.log(
      `test-headroom: ${t.module} > ${t.name}: ${t.worst.durationMs} ms of ${t.timeoutMs} ms (${Math.round(t.share * 100)}%) on ${t.worst.platform}${run}`,
    );
  }
  console.log(`test-headroom: ${listed.length} test(s) over ${Math.round(share * 100)}% of their timeout across ${where}`);
  for (const t of twice) console.log(`test-headroom: over in two consecutive runs: ${t.module} > ${t.name}`);
}

/** An unreadable previous report (a cancelled run, a format change) leaves this run warning only, as no previous report does. */
function readPrevious(file) {
  try {
    return [readReport(file)];
  } catch (e) {
    console.error(`test-headroom: previous report ignored: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** @param {string[]} argv */
function readCurrent(argv, all) {
  /** @type {Report[]} */
  const reports = all('--file').map((f) => readReport(f));
  for (const run of all('--run')) {
    const { dir, files } = download(run);
    try {
      reports.push(...files.map((f) => readReport(f, run)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return reports;
}

function main(argv) {
  const all = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
  const shareArg = all('--share')[0];
  const share = shareArg === undefined ? 0.5 : Number(shareArg);
  if (!(share > 0 && share <= 1)) throw new Error('--share takes a number in (0, 1]');
  const reports = readCurrent(argv, all);
  if (!reports.length) {
    console.error('test-headroom: no durations report read (pass --run <id> or --file <path>)');
    return 2;
  }
  const listed = headroom(reports, share);
  const previousFiles = all('--previous');
  const previous = previousFiles.flatMap(readPrevious);
  const twice = previousFiles.length ? persistent(listed, previous, share) : listed;
  if (argv.includes('--json')) console.log(JSON.stringify({ share, reports: reports.length, listed, persistent: twice }, null, 2));
  else print(reports, listed, share, previousFiles.length ? twice : []);
  return twice.length && !argv.includes('--warn-only') ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`test-headroom: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 2;
  }
}
