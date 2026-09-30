// NFR-PERF-006 (M3 final F1): the undo budget is judged by one shared leg that every completion gate
// from M4 on runs; these cases feed it fake bench reports instead of running the benches.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { BENCH_COMMANDS, BENCH_FILES, benchLeg, benchUnder, checkBenchReport, checkBenchTask } from '../../scripts/gates/milestone-checks.mjs';
import { REPO, sandbox } from './helpers.mjs';

/** A Vitest 5 JSON bench report: one passing test per command, each with its undo/redo/transact tasks. */
function report(p99 = () => 5, { status = 'passed', drop = [] } = {}) {
  const assertionResults = BENCH_COMMANDS.map((c) => ({
    title: `NFR-PERF-006: ${c}`,
    status,
    benchmarks: [
      {
        name: c,
        tasks: ['undo', 'redo', 'transact']
          .map((op) => `${op} ${c}`)
          .filter((name) => !drop.includes(name))
          .map((name) => ({ name, latency: { p99: p99(name) } })),
      },
    ],
  }));
  return { testResults: [{ assertionResults }] };
}

describe('shared bench leg (NFR-PERF-006)', () => {
  it('a bench over UNDO_MAX_MS fails the shared leg', () => {
    assert.equal(checkBenchReport(report(), 16), true);
    const slow = checkBenchReport(
      report((n) => (n === 'undo screen.delete' ? 17.25 : 5)),
      16,
    );
    assert.equal(slow, 'undo screen.delete p99 17.25 ms');
    // through the leg itself: a runner that writes a slow report fails it
    const sb = sandbox([...BENCH_FILES, 'packages/core/bench/fixture.ts']);
    try {
      const runner = (out) => {
        writeFileSync(out, JSON.stringify(report((n) => (n === 'redo binding.set' ? 40 : 5))));
        return { status: 0, stdout: '', stderr: '' };
      };
      assert.equal(benchLeg(16, { runner, root: sb.dir }), 'redo binding.set p99 40.00 ms');
      const fast = (out) => {
        writeFileSync(out, JSON.stringify(report()));
        return { status: 0, stdout: '', stderr: '' };
      };
      assert.equal(benchLeg(16, { runner: fast, root: sb.dir }), true);
      // a passing report from a run that exited non-zero, or a run that wrote nothing, fails (review F2)
      const crashed = (out) => {
        fast(out);
        return { status: 1, stdout: '', stderr: 'worker crashed' };
      };
      assert.match(String(benchLeg(16, { runner: crashed, root: sb.dir })), /bench run exited 1: worker crashed/);
      const silent = () => ({ status: 1, stdout: '', stderr: 'no browser' });
      assert.match(String(benchLeg(16, { runner: silent, root: sb.dir })), /no bench output: no browser/);
    } finally {
      sb.cleanup();
    }
  });

  it('a missing benchmark, a failed bench test or a missing p99 fails', () => {
    assert.match(String(checkBenchReport(report(undefined, { drop: ['transact element.create'] }), 16)), /no benchmark named: transact element\.create/);
    assert.match(String(checkBenchReport(report(undefined, { status: 'failed' }), 16)), /bench tests failed/);
    assert.match(
      String(
        checkBenchReport(
          report(() => undefined),
          16,
        ),
      ),
      /p99 NaN ms/,
    );
  });

  it('validation switched off anywhere in the bench folder fails before running', () => {
    const sb = sandbox([...BENCH_FILES, 'packages/core/bench/fixture.ts']);
    try {
      sb.edit('packages/core/bench/fixture.ts', (t) => `${t}\nexport const opts = { validate: false };\n`);
      let ran = false;
      const runner = () => {
        ran = true;
        return { status: 0, stdout: '', stderr: '' };
      };
      assert.match(String(benchLeg(16, { runner, root: sb.dir })), /validation switched off in packages\/core\/bench\/fixture\.ts/);
      assert.equal(ran, false);
      // a nested helper counts too (M4.7 review F1)
      sb.edit('packages/core/bench/fixture.ts', (t) => t.replace('export const opts = { validate: false };', ''));
      sb.write('packages/core/bench/helpers/store.ts', 'export const make = (doc) => createStore(doc, { validate: false });\n');
      assert.match(String(benchLeg(16, { runner, root: sb.dir })), /validation switched off in packages\/core\/bench\/helpers\/store\.ts/);
      assert.equal(ran, false);
      // and a missing bench file fails too
      rmSync(sb.path(BENCH_FILES[0]));
      assert.match(String(benchLeg(16, { runner, root: sb.dir })), /missing packages\/core\/bench\/undo-5000\.bench\.ts/);
    } finally {
      sb.cleanup();
    }
  });

  // M4 cp1 F4: the leg and the benches cover every built-in command, not a list kept by hand
  it('bench commands match the built-in commands', async () => {
    const core = await import(pathToFileURL(join(REPO, 'packages/core/dist/index.js')).href);
    const builtIns = core.CORE_COMMANDS.map((c) => c.id).sort();
    assert.equal(builtIns.length >= 8, true);
    assert.deepEqual([...BENCH_COMMANDS].sort(), builtIns);
    const fixture = readFileSync(join(REPO, 'packages/core/bench/fixture.ts'), 'utf8');
    const listed = /export const COMMANDS = \[([\s\S]*?)\]/.exec(fixture)?.[1] ?? '';
    assert.deepEqual([...listed.matchAll(/'([a-z.]+)'/g)].map((m) => m[1]).sort(), builtIns);
  });
});

// M6.10: one named benchmark under a budget (the hit-test-2000 bench of the M6 gate)
describe('one bench under a budget (FR-EDT-004)', () => {
  const one = (tasks, status = 'passed') => ({
    testResults: [{ assertionResults: [{ title: 'FR-EDT-004: hit-test-2000', status, benchmarks: [{ name: 'x', tasks }] }] }],
  });
  const task = (name, p99) => ({ name, latency: { p99 } });

  it('the named benchmark passes within the budget and fails over it, missing, doubled or in a failed test', () => {
    assert.equal(checkBenchTask(one([task('hit-test-2000', 0.6)]), 'hit-test-2000', 1), true);
    assert.equal(checkBenchTask(one([task('hit-test-2000', 1)]), 'hit-test-2000', 1), true);
    assert.equal(checkBenchTask(one([task('hit-test-2000', 1.25)]), 'hit-test-2000', 1), 'hit-test-2000 p99 1.250 ms > 1 ms');
    assert.equal(checkBenchTask(one([task('other', 0.1)]), 'hit-test-2000', 1), '0 benchmarks named hit-test-2000 (want 1)');
    assert.equal(
      checkBenchTask(one([task('hit-test-2000', 0.1), task('hit-test-2000', 0.1)]), 'hit-test-2000', 1),
      '2 benchmarks named hit-test-2000 (want 1)',
    );
    assert.match(String(checkBenchTask(one([task('hit-test-2000', 0.1)], 'failed'), 'hit-test-2000', 1)), /bench tests failed: FR-EDT-004: hit-test-2000/);
    assert.match(String(checkBenchTask(one([{ name: 'hit-test-2000' }]), 'hit-test-2000', 1)), /p99 NaN ms/);
  });

  it('the leg runs the file and judges its report; a missing file, no output or a failed run fails', () => {
    const file = 'packages/editor/bench/hit-test-2000.bench.ts';
    const sb = sandbox([file]);
    try {
      const writes =
        (report, status = 0) =>
        (f, out) => {
          assert.equal(f, file);
          writeFileSync(out, JSON.stringify(report));
          return { status, stdout: '', stderr: status ? 'worker crashed' : '' };
        };
      assert.equal(benchUnder(file, 'hit-test-2000', 1, { runner: writes(one([task('hit-test-2000', 0.5)])), root: sb.dir }), true);
      assert.equal(
        benchUnder(file, 'hit-test-2000', 1, { runner: writes(one([task('hit-test-2000', 3)])), root: sb.dir }),
        'hit-test-2000 p99 3.000 ms > 1 ms',
      );
      assert.match(
        String(benchUnder(file, 'hit-test-2000', 1, { runner: writes(one([task('hit-test-2000', 0.5)]), 1), root: sb.dir })),
        /bench run exited 1: worker crashed/,
      );
      const silent = () => ({ status: 1, stdout: '', stderr: 'no vitest' });
      assert.match(String(benchUnder(file, 'hit-test-2000', 1, { runner: silent, root: sb.dir })), /no bench output: no vitest/);
      let ran = false;
      const never = () => {
        ran = true;
        return { status: 0, stdout: '', stderr: '' };
      };
      assert.equal(
        benchUnder('packages/editor/bench/missing.bench.ts', 'hit-test-2000', 1, { runner: never, root: sb.dir }),
        'missing packages/editor/bench/missing.bench.ts',
      );
      assert.equal(ran, false);
    } finally {
      sb.cleanup();
    }
  });
});
