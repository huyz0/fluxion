import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { descendants, REPO_ROOT, runAsync, TURBO_ALL_SUCCESSFUL } from '../../scripts/gates/lib.mjs';

// M18.281: a Windows CI build twice printed turbo's all-successful summary and then did not exit until its step's limit
// (ci 42038170007 verify, 42092624276 cli-mcp). runAsync's `settle` ends such a command; the stand-ins below are node scripts.
const SUMMARY = ' Tasks:    3 successful, 3 total\nCached:    0 cached, 3 total\n  Time:    1.2s\n';
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** A stand-in that prints `out`, writes a grandchild's pid when `grandchild`, then exits with `code` after `waitMs`. */
const standIn = ({ out, code = 0, waitMs = 0, grandchild = false }) => [
  '-e',
  [
    grandchild ? "const g = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });" : '',
    grandchild ? "process.stdout.write('grandchild ' + g.pid + '\\n');" : '',
    `process.stdout.write(${JSON.stringify(out)});`,
    `setTimeout(() => process.exit(${code}), ${waitMs});`,
  ].join(''),
];

describe('a build that reported success and does not exit is ended (M18.281, NFR-PORT-005)', () => {
  const settled = (dir, ms = 400) => ({ done: TURBO_ALL_SUCCESSFUL, ms, reportDir: dir, label: 'build', print: false });
  const withDir = async (work) => {
    const dir = mkdtempSync(join(tmpdir(), 'fluxion-settle-'));
    try {
      await work(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('NFR-PORT-005: after the summary and the grace, the tree is ended, its process table saved and the run passes with a warning', () =>
    withDir(async (dir) => {
      const started = Date.now();
      const res = await runAsync(process.execPath, standIn({ out: SUMMARY, waitMs: 60_000, grandchild: true }), { settle: settled(dir) });
      assert.equal(res.status, 0);
      assert.ok(Date.now() - started < 20_000, 'ended long before the stand-in would exit');
      assert.ok(res.stuck && existsSync(res.stuck), String(res.stuck));
      assert.match(res.stdout, /::warning::build reported success but had not exited after 0 s; ended its process tree, process table in .*\(M18\.281\)/);
      assert.match(readFileSync(res.stuck, 'utf8'), /^build printed its done line and had not exited 400 ms later\n\n.*\S/s);
      const grandchild = Number(/grandchild (\d+)/.exec(res.stdout)?.[1]);
      // the grandchild holds no pipe of ours, so only the tree kill ends it
      for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal(alive(grandchild), false, `grandchild ${grandchild} outlived the tree kill`);
    }));

  test('NFR-PORT-005: a build that fails, exits cleanly, or never prints an all-successful summary keeps its own status', () =>
    withDir(async (dir) => {
      const failed = await runAsync(process.execPath, standIn({ out: SUMMARY, code: 1, waitMs: 50 }), { settle: settled(dir) });
      assert.equal(failed.status, 1);
      const clean = await runAsync(process.execPath, standIn({ out: SUMMARY, waitMs: 50 }), { settle: settled(dir) });
      assert.deepEqual([clean.status, clean.stuck], [0, undefined]);
      // a failed task: "2 successful, 3 total" arms nothing, so a slow exit past the grace keeps its status
      const partial = SUMMARY.replace('3 successful', '2 successful');
      const incomplete = await runAsync(process.execPath, standIn({ out: partial, code: 4, waitMs: 1200 }), { settle: settled(dir, 200) });
      assert.deepEqual([incomplete.status, incomplete.stuck], [4, undefined]);
      assert.deepEqual(readdirSync(dir), [], 'no report for a build that exited on its own');
    }));

  test('NFR-PORT-005: Ctrl-C still ends a settled build with its caller, which keeps it in its own process group (M18.281 r1 F1)', {
    skip: process.platform === 'win32' && 'POSIX process groups',
  }, async () => {
    const lib = pathToFileURL(join(REPO_ROOT, 'scripts/gates/lib.mjs')).href;
    const caller = [
      `const { runAsync, withProcessOutput } = await import(${JSON.stringify(lib)});`,
      "await withProcessOutput((_, d) => process.stdout.write(d), () => runAsync(process.execPath, ['-e', \"console.log('build ' + process.pid); setTimeout(() => {}, 60000)\"],",
      "  { settle: { done: /never/, ms: 1000, reportDir: '.', label: 'build' } }));",
    ].join('\n');
    // the caller leads a group of its own, as a terminal's foreground job does
    const parent = spawn(process.execPath, ['--input-type=module', '-e', caller], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    parent.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    for (let i = 0; i < 100 && !/build \d+/.test(out); i++) await new Promise((r) => setTimeout(r, 50));
    const build = Number(/build (\d+)/.exec(out)?.[1]);
    assert.ok(alive(build), `the build is running: ${out}`);
    process.kill(-parent.pid, 'SIGINT');
    for (let i = 0; i < 50 && alive(build); i++) await new Promise((r) => setTimeout(r, 100));
    const left = alive(build);
    if (left) process.kill(build, 'SIGKILL');
    assert.equal(left, false, 'the build outlived Ctrl-C to its caller');
  });

  test('NFR-PORT-005: the tree under a pid is read from ps, children after their parents', () => {
    const table = '  PID  PPID\n    1     0\n   10     1\n   11    10\n   12    10\n   13    11\n   20     1\n';
    assert.deepEqual(descendants(table, 10), [10, 11, 12, 13]);
    assert.deepEqual(descendants(table, 20), [20]);
  });

  test('NFR-PORT-005: the summary is matched as turbo prints it, colours and all, and not on a partial count', () => {
    assert.match(' Tasks:    37 successful, 37 total', TURBO_ALL_SUCCESSFUL);
    assert.match('x\n Tasks:    7 successful, 7 total\nCached: 0', TURBO_ALL_SUCCESSFUL);
    assert.doesNotMatch(' Tasks:    36 successful, 37 total', TURBO_ALL_SUCCESSFUL);
    assert.doesNotMatch(' Tasks:    3 successful, 37 total', TURBO_ALL_SUCCESSFUL);
  });

  test('NFR-PORT-005: the ladder build and the cli-mcp build are settled, and verify, harness-windows and cli-mcp upload the reports', () => {
    const precommit = readFileSync(join(REPO_ROOT, 'scripts/gates/precommit.mjs'), 'utf8');
    assert.match(precommit, /runAsync\('pnpm', mode === 'all' \? \['run', 'build'\] : \['turbo', 'run', 'build', [^\n]*\{ settle: BUILD_SETTLE \}\)/);
    assert.match(precommit, /const BUILD_SETTLE = \{ done: TURBO_ALL_SUCCESSFUL, ms: 60_000, reportDir: repoPath\('\.harness\/tmp\/stuck-build'\)/);
    const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const job = (name) => new RegExp(`^ {2}${name}:\\n[\\s\\S]*?(?=^ {2}\\S)`, 'm').exec(ci)?.[0] ?? '';
    const cliMcp = job('cli-mcp');
    assert.match(cliMcp, /- name: build\n {8}timeout-minutes: 12\n {8}run: node scripts\/ci\/build-settled\.mjs\n/);
    assert.doesNotMatch(cliMcp, /run: pnpm run build/);
    for (const name of ['verify', 'harness-windows', 'cli-mcp'])
      assert.match(
        job(name),
        /- name: stuck build reports\n {8}if: always\(\)\n[\s\S]*?path: \.harness\/tmp\/stuck-build\n[\s\S]*?if-no-files-found: ignore/,
        name,
      );
    const script = readFileSync(join(REPO_ROOT, 'scripts/ci/build-settled.mjs'), 'utf8');
    assert.match(
      script,
      /runAsync\('pnpm', \['run', 'build'\], \{ settle: \{ done: TURBO_ALL_SUCCESSFUL, ms, reportDir: repoPath\('\.harness\/tmp\/stuck-build'\)/,
    );
  });
});
