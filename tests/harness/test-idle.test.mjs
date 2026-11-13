import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { inFlight, REPO_ROOT, runAsync } from '../../scripts/gates/lib.mjs';
import { ProgressReporter, progressLine } from '../../tools/vitest/progress-reporter.mjs';

// M18.283: ci 42159843232's Windows verify printed nothing after 56 browser files until the step's 25-minute limit. CI's Vitest
// run now logs each file's start and end, and the ladder fails a test run that is silent for TEST_IDLE_MS, naming what was running.
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const withDir = async (work) => {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-idle-'));
  try {
    await work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const idle = (dir, ms = 500) => ({ idle: { ms, reportDir: dir, label: 'test', inFlight, print: false } });

describe('a test run that goes silent fails and names what was running (M18.283, NFR-PORT-005)', () => {
  test('NFR-PORT-005: silence past the limit ends the tree, saves a report naming the files in flight, and fails', () =>
    withDir(async (dir) => {
      const script = [
        "const g = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
        "process.stderr.write('vitest-progress: start node a.test.ts\\nvitest-progress: start browser (chromium) b.browser.test.ts\\n');",
        "process.stderr.write('vitest-progress: end node a.test.ts\\n');",
        "process.stdout.write('grandchild ' + g.pid + '\\n');",
        'setTimeout(() => {}, 60000);',
      ].join('');
      const started = Date.now();
      const res = await runAsync(process.execPath, ['-e', script], idle(dir));
      assert.equal(res.status, 1);
      assert.ok(Date.now() - started < 20_000, 'failed long before the stand-in would exit');
      assert.ok(res.stalled && existsSync(res.stalled), String(res.stalled));
      assert.match(res.stderr, /::error::test printed nothing for 1 s; in flight: browser \(chromium\) b\.browser\.test\.ts; ended its process tree/);
      assert.match(readFileSync(res.stalled, 'utf8'), /^in flight:\nbrowser \(chromium\) b\.browser\.test\.ts\n\nlast output:\n/);
      const grandchild = Number(/grandchild (\d+)/.exec(res.stdout)?.[1]);
      for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal(alive(grandchild), false, `grandchild ${grandchild} outlived the tree kill`);
    }));

  test('NFR-PORT-005: a run that keeps printing is not stopped, and its own status stands', () =>
    withDir(async (dir) => {
      const script = "let n = 0; const t = setInterval(() => { process.stdout.write('.'); if (++n === 12) { clearInterval(t); process.exit(3); } }, 100);";
      const res = await runAsync(process.execPath, ['-e', script], idle(dir, 600));
      assert.deepEqual([res.status, res.stalled], [3, undefined]);
    }));

  test('NFR-PORT-005: the files in flight are those a progress log started and did not end', () => {
    const log = [
      progressLine('start', 'node', join(process.cwd(), 'a.test.ts')),
      progressLine('start', 'browser (chromium)', join(process.cwd(), 'b', 'c.test.ts')),
    ].join('');
    assert.equal(log, 'vitest-progress: start node a.test.ts\nvitest-progress: start browser (chromium) b/c.test.ts\n');
    assert.deepEqual(inFlight(`${log}noise\n${progressLine('end', 'node', join(process.cwd(), 'a.test.ts'))}`), ['browser (chromium) b/c.test.ts']);
    assert.deepEqual(inFlight(''), []);
    // queued and never started: the file was still loading, which a start line alone would miss (r1 F1)
    const queued = `${progressLine('queued', 'browser (chromium)', join(process.cwd(), 'd.test.ts'))}${progressLine('queued', 'node', join(process.cwd(), 'e.test.ts'))}${progressLine('start', 'node', join(process.cwd(), 'e.test.ts'))}`;
    assert.deepEqual(inFlight(queued), ['browser (chromium) d.test.ts (loading)', 'node e.test.ts']);
    const lines = [];
    const reporter = new ProgressReporter({ write: (l) => lines.push(l) });
    reporter.onTestModuleQueued({ project: { name: 'node' }, moduleId: join(process.cwd(), 'x.test.ts') });
    reporter.onTestModuleStart({ project: { name: 'node' }, moduleId: join(process.cwd(), 'x.test.ts') });
    reporter.onTestModuleEnd({ project: { name: '' }, moduleId: join(process.cwd(), 'x.test.ts') });
    assert.deepEqual(lines, [
      'vitest-progress: queued node x.test.ts\n',
      'vitest-progress: start node x.test.ts\n',
      'vitest-progress: end default x.test.ts\n',
    ]);
  });

  test("NFR-PORT-005: Vitest calls the reporter: a CI-configured run logs a file's start and end", () =>
    withDir(async (dir) => {
      const res = await runAsync('pnpm', ['exec', 'vitest', 'run', '--project', 'node*', 'packages/geometry/src/index.test.ts'], {
        env: { ...process.env, FLUXION_TEST_DURATIONS: join(dir, 'durations.json'), GITHUB_ACTIONS: '' },
      });
      assert.equal(res.status, 0, res.stderr.slice(-2000));
      const out = `${res.stdout}\n${res.stderr}`;
      assert.match(out, /^vitest-progress: queued node packages\/geometry\/src\/index\.test\.ts$/m);
      assert.match(out, /^vitest-progress: start node packages\/geometry\/src\/index\.test\.ts$/m);
      assert.match(out, /^vitest-progress: end node packages\/geometry\/src\/index\.test\.ts$/m);
    }));

  test('NFR-PORT-005: a watchdog annotates its own job log, and a stand-in given print: false does not (r1 F2)', () =>
    withDir(async (dir) => {
      const lib = pathToFileURL(join(REPO_ROOT, 'scripts/gates/lib.mjs')).href;
      const caller = (print) =>
        [
          `const { runAsync, TURBO_ALL_SUCCESSFUL } = await import(${JSON.stringify(lib)});`,
          `const opt = ${print === undefined ? '{}' : `{ print: ${print} }`};`,
          `await runAsync(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { idle: { ms: 300, reportDir: ${JSON.stringify(dir)}, label: 'test', ...opt } });`,
          "await runAsync(process.execPath, ['-e', \"process.stdout.write(' Tasks:    1 successful, 1 total\\\\n'); setTimeout(() => {}, 60000)\"],",
          `  { settle: { done: TURBO_ALL_SUCCESSFUL, ms: 300, reportDir: ${JSON.stringify(dir)}, label: 'build', ...opt } });`,
        ].join('\n');
      const own = (print) => runAsync(process.execPath, ['--input-type=module', '-e', caller(print)]);
      const [quiet, loud] = await Promise.all([own(false), own(undefined)]);
      assert.equal(quiet.status, 0, quiet.stderr);
      assert.doesNotMatch(quiet.stdout, /::(error|warning)::/);
      assert.match(loud.stdout, /^::error::test printed nothing for 0 s/m);
      assert.match(loud.stdout, /^::warning::build reported success but had not exited/m);
    }));

  test("NFR-PORT-005: the ladder arms the idle limit on CI's test run only, and the config adds the reporter there", () => {
    const precommit = readFileSync(join(REPO_ROOT, 'scripts/gates/precommit.mjs'), 'utf8');
    assert.match(precommit, /const TEST_IDLE_MS = 8 \* 60_000;/);
    assert.match(
      precommit,
      /const idle = process\.env\.FLUXION_TEST_DURATIONS\s*\? \{ idle: \{ ms: TEST_IDLE_MS, reportDir: repoPath\('\.harness\/tmp\/verify-logs'\), label: 'test', inFlight \} \}\s*: \{\};/,
    );
    assert.match(precommit, /runAsync\('pnpm', a, \{ env: \{ \.\.\.testStepEnv\(\), \.\.\.durations \}, \.\.\.idle \}\)/);
    const config = readFileSync(join(REPO_ROOT, 'vitest.config.ts'), 'utf8');
    assert.match(config, /new DurationsReporter\(\), new ProgressReporter\(\)\]/);
  });
});
