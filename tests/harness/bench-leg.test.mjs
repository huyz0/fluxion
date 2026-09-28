// NFR-PERF-006 (M3 final F1): the undo budget is judged by one shared leg that every completion gate
// from M4 on runs; these cases feed it fake bench reports instead of running the benches.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { BENCH_COMMANDS, BENCH_FILES, benchLeg, checkBenchReport } from '../../scripts/gates/milestone-checks.mjs';
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
