#!/usr/bin/env node
// Run Playwright in the pinned image of ci.yml (the image CI's e2e and visual jobs use), on any host
// with Docker: the same browsers everywhere, including where a local browser cannot launch.
//   node scripts/e2e/image.mjs [--out <dir>] [--snapshots] -- <playwright test args>
// --out: a host directory mounted at /out (a JSON report named by PLAYWRIGHT_JSON_OUTPUT_NAME lands
// there when that variable points into it); --snapshots: copy e2e/*-snapshots into --out afterwards.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The image ci.yml pins for its browser jobs (one source of truth). */
export function pinnedImage(root = ROOT) {
  const m = /image:\s*(mcr\.microsoft\.com\/playwright:[^\s]+)/.exec(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
  if (!m) throw new Error('e2e: no pinned Playwright image in .github/workflows/ci.yml');
  return m[1];
}

/**
 * The docker arguments that run `args` in the pinned image; `report` (a host file) receives the JSON
 * report when given.
 */
export function dockerArgs(args, { root = ROOT, out, report, snapshots = false } = {}) {
  const outDir = report ? dirname(report) : out;
  const env = [];
  if (report) env.push('-e', `PLAYWRIGHT_JSON_OUTPUT_NAME=/out/${basename(report)}`);
  if (snapshots) env.push('-e', 'FLUXION_E2E_COPY_SNAPSHOTS=1');
  return [
    'run',
    '--rm',
    '-e',
    'HOME=/root',
    '-e',
    'CI=1',
    ...env,
    '-v',
    `${root}:/src:ro`,
    ...(outDir ? ['-v', `${outDir}:/out`] : []),
    pinnedImage(root),
    'bash',
    '/src/scripts/e2e/in-image.sh',
    ...args,
  ];
}

/** Run `args` in the pinned image; the result of spawnSync. */
export function runInImage(args, options = {}) {
  const outDir = options.report ? dirname(options.report) : options.out;
  if (outDir) mkdirSync(outDir, { recursive: true });
  return spawnSync('docker', dockerArgs(args, options), { encoding: 'utf8', maxBuffer: 1 << 28 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const own = sep < 0 ? argv : argv.slice(0, sep);
  const rest = sep < 0 ? [] : argv.slice(sep + 1);
  const outAt = own.indexOf('--out');
  const out = outAt >= 0 ? resolve(own[outAt + 1]) : undefined;
  const r = spawnSync('docker', dockerArgs(rest, { out, snapshots: own.includes('--snapshots') }), { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
