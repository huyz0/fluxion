#!/usr/bin/env node
// Lint GitHub workflows with actionlint and zizmor (security audit), via pinned Docker images so
// no host install is needed (NFR-SEC-005, M0 final F2).
//   check-workflows.mjs                   SKIP (exit 0) with a reason when a Linux Docker engine is absent
//   check-workflows.mjs --require-docker  missing Docker is a failure (completion gates, CI)
//   check-workflows.mjs --dir <path>      lint another checkout (tests)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './lib.mjs';

// Pinned by digest; bump deliberately (Renovate tracks them from M1.21).
export const IMAGES = {
  actionlint: 'rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667', // 1.7.12
  zizmor: 'ghcr.io/zizmorcore/zizmor@sha256:a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101', // 1.30.1
};

const argv = process.argv.slice(2);
const dirArg = argv.indexOf('--dir');
const root = dirArg >= 0 ? resolve(argv[dirArg + 1]) : REPO_ROOT;
const requireDocker = argv.includes('--require-docker');

const skipOrFail = (why) => {
  if (requireDocker) { console.error(`workflows: ${why}`); process.exit(1); }
  console.log(`workflows: SKIP — ${why}`);
  process.exit(0);
};

const wfDir = join(root, '.github', 'workflows');
if (!existsSync(wfDir) || readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).length === 0) {
  console.log('workflows: no workflows');
  process.exit(0);
}

const info = spawnSync('docker', ['info', '--format', '{{.OSType}}'], { encoding: 'utf8' });
if (info.error || info.status !== 0) skipOrFail('Docker not available');
if (info.stdout.trim() !== 'linux') skipOrFail(`Docker engine is ${info.stdout.trim()}, need linux`);

const mount = `${root.replace(/\\/g, '/')}:/repo`;
const docker = (image, args) => spawnSync('docker', ['run', '--rm', '-v', mount, '-w', '/repo', image, ...args], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

let failed = false;
// explicit file list: actionlint otherwise needs a git project around /repo
const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`);
const al = docker(IMAGES.actionlint, files);
if (al.status !== 0) {
  failed = true;
  console.error(`actionlint:\n${(al.stdout + al.stderr).trim()}`);
} else console.log('actionlint: 0 findings');

const zz = docker(IMAGES.zizmor, ['--offline', '--no-progress', '--format', 'plain', '.github/workflows']);
const zout = `${zz.stdout}\n${zz.stderr}`;
const zcount = Number(/^(\d+) findings?/m.exec(zout)?.[1] ?? (/No findings to report/i.test(zout) ? 0 : NaN));
if (zz.status !== 0 || zcount !== 0) {
  failed = true;
  console.error(`zizmor (exit ${zz.status}, findings ${Number.isNaN(zcount) ? '?' : zcount}):\n${zout.trim().split(/\r?\n/).slice(-40).join('\n')}`);
} else console.log('zizmor: 0 findings');

process.exit(failed ? 1 : 0);
