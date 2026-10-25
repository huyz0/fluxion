import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { judgeCircular, runCircular } from '../../scripts/gates/check-circular-advisory.mjs';
import { checkBenchTask } from '../../scripts/gates/milestone-checks.mjs';
import { t } from '../../scripts/gates/thresholds.mjs';
import { out, sandbox } from './helpers.mjs';

const report = (p99, name = 'circular-500') => ({
  testResults: [{ assertionResults: [{ title: name, status: 'passed', benchmarks: [{ tasks: [{ name, latency: { p99 } }] }] }] }],
});

describe('NFR-PERF-005: circular-only advisory timing', () => {
  it('circular overrun is advisory', () => {
    const result = judgeCircular(report(2099.099));
    assert.equal(result.pass, true);
    assert.equal(result.advisory, true);
    assert.match(result.line, /ADVISORY circular-500.*2099\.099.*2000/);
    assert.equal(judgeCircular(report(42.969)).advisory, false);
    assert.equal(judgeCircular(report(2000)).pass, true);
    assert.equal(t('LAYOUT_500_NODES_MS'), 2000);
  });

  it('other layout overruns fail', () => {
    for (const name of ['force', 'packing', 'timeline', 'swimlane']) {
      assert.notEqual(checkBenchTask(report(2000.001, `${name}-500`), `${name}-500`, t('LAYOUT_500_NODES_MS')), true);
      assert.equal(checkBenchTask(report(1999.999, `${name}-500`), `${name}-500`, t('LAYOUT_500_NODES_MS')), true);
      assert.equal(judgeCircular(report(3000, `${name}-500`)).pass, false);
    }
  });

  it('missing or invalid circular samples fail', () => {
    for (const invalid of [null, {}, { testResults: [] }, { testResults: [{}] }, { testResults: [{ assertionResults: [] }] }])
      assert.equal(judgeCircular(invalid).pass, false);
    for (const value of [undefined, null, '100', -1, NaN, Infinity]) assert.equal(judgeCircular(report(value)).pass, false);
    for (const benchmarks of [undefined, null, [{}], [{ tasks: null }]]) {
      const invalid = report(10);
      invalid.testResults[0].assertionResults[0].benchmarks = benchmarks;
      assert.equal(judgeCircular(invalid).pass, false);
    }
    const duplicate = report(10);
    duplicate.testResults.push(...report(10).testResults);
    assert.equal(judgeCircular(duplicate).pass, false);
  });

  it('failed and skipped assertions or failed report totals remain blocking', () => {
    for (const status of ['failed', 'skipped', 'todo']) {
      const value = report(3000);
      value.testResults[0].assertionResults.push({ title: 'correctness', status });
      assert.equal(judgeCircular(value).pass, false);
    }
    assert.equal(judgeCircular({ ...report(10), numFailedTestSuites: 1 }).pass, false);
    assert.equal(judgeCircular({ ...report(10), numFailedTests: 1 }).pass, false);
    assert.equal(judgeCircular({ ...report(10), success: false }).pass, false);
  });

  it('the real benchmark path and runner arguments are retained', () => {
    const result = runCircular({
      runner: (cmd, args) => {
        assert.equal(cmd, 'pnpm');
        assert.deepEqual(args.slice(0, 7), ['exec', 'vitest', 'bench', '--run', '--project', 'node (bench)', '--reporter=json']);
        assert.equal(args.at(-1), 'packages/layout/bench/circular-500.bench.ts');
        writeFileSync(args.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length), JSON.stringify(report(3000)));
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.pass, true);
    assert.equal(result.advisory, true);
  });

  it('missing output, malformed JSON and a failed process cannot become advisory success', () => {
    for (const [status, bytes] of [
      [1, JSON.stringify(report(3000))],
      [0, '{'],
      [0, undefined],
    ]) {
      const result = runCircular({
        runner: (_cmd, args) => {
          if (bytes !== undefined) writeFileSync(args.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length), bytes);
          return { status, stdout: '', stderr: 'probe failure' };
        },
      });
      assert.equal(result.pass, false);
      assert.equal(result.advisory, false);
    }
  });

  it('CLI returns success only for valid measured results, including advisory overruns', () => {
    const sb = sandbox(['scripts/gates/check-circular-advisory.mjs', 'scripts/gates/thresholds.mjs']);
    try {
      for (const [status, data, expected] of [
        [0, report(3000), 0],
        [1, report(3000), 1],
        [0, report(null), 1],
      ]) {
        sb.write(
          'scripts/gates/lib.mjs',
          `import {writeFileSync} from 'node:fs';
export function run(_cmd,args) { writeFileSync(args.find(a=>a.startsWith('--outputFile=')).slice(13),${JSON.stringify(JSON.stringify(data))}); return {status:${status},stdout:'',stderr:''}; }\n`,
        );
        const result = sb.node('scripts/gates/check-circular-advisory.mjs');
        assert.equal(result.status, expected, out(result));
        assert.match(result.stdout, expected === 0 ? /ADVISORY circular-500/ : /FAIL circular-500/);
      }
    } finally {
      sb.cleanup();
    }
  });
});

describe('M18 required limits', () => {
  it('FR-AST-003 FR-LIB-004 FR-LIB-006: numeric limits match the unchanged acceptance criteria', () => {
    assert.equal(t('FONT_SUBSET_LATIN_MAX_BYTES'), 60000);
    assert.equal(t('SVG_IMPORT_MIN_ANCHORS'), 4);
    assert.equal(t('DRAWIO_LIB_IMPORT_MIN_PCT'), 90);
  });
});

describe('NFR-PERF-005: completion-gate reporting', () => {
  it('the real M18 leg retains advisory measurement and target in its output', () => {
    const sb = sandbox(['scripts']);
    try {
      sb.write('scripts/gates/real-lib.mjs', sb.read('scripts/gates/lib.mjs'));
      // Run the actual circular leg/CLI/formatter; isolate unrelated milestone work.
      // Only its benchmark process is synthetic, to force an overrun deterministically.
      sb.write(
        'scripts/gates/lib.mjs',
        `export * from './real-lib.mjs';
import {leg as register} from './real-lib.mjs';
import {writeFileSync} from 'node:fs';
export function leg(name,fn) { if(name.startsWith('circular-500 measured')) register(name,fn); }
export function run(_cmd,args) { writeFileSync(args.find(a=>a.startsWith('--outputFile=')).slice(13),${JSON.stringify(JSON.stringify(report(3000)))}); return {status:0,stdout:'',stderr:''}; }\n`,
      );
      const result = sb.node('scripts/gates/m18-complete.mjs');
      assert.equal(result.status, 0, out(result));
      assert.match(result.stdout, /PASS circular-500 measured[^\n]*ADVISORY circular-500: p99 3000\.000 ms, advisory target 2000 ms/);
      assert.match(result.stdout, /GATE m18: 1\/1 legs green/);
    } finally {
      sb.cleanup();
    }
  });
});
