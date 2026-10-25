#!/usr/bin/env node
// ADR-0171: only a valid circular-500 timing overrun is advisory; all evidence failures block.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './lib.mjs';
import { t } from './thresholds.mjs';

const fail = (reason) => ({ pass: false, advisory: false, line: `FAIL circular-500: ${reason}` });

/** Extract passing assertions without accepting empty or failed suites. */
function reportAssertions(report) {
  if (!report || !Array.isArray(report.testResults) || report.testResults.length === 0) return 'missing test results';
  if (report.success === false || report.numFailedTests > 0 || report.numFailedTestSuites > 0) return 'benchmark report failed';
  const assertions = [];
  for (const file of report.testResults) {
    if (!Array.isArray(file?.assertionResults) || file.assertionResults.length === 0) return 'missing assertions';
    assertions.push(...file.assertionResults);
  }
  return assertions.some((assertion) => assertion?.status !== 'passed') ? 'failed or skipped benchmark assertions' : assertions;
}

/** Keep evidence validation separate from the sole advisory timing decision. */
function circularTasks(assertions) {
  const tasks = [];
  for (const assertion of assertions) {
    if (!Array.isArray(assertion.benchmarks)) return 'missing benchmark samples';
    for (const benchmark of assertion.benchmarks) {
      if (!Array.isArray(benchmark?.tasks)) return 'missing benchmark tasks';
      tasks.push(...benchmark.tasks.filter((task) => task?.name === 'circular-500'));
    }
  }
  return tasks;
}

/** Validate the complete report before interpreting its single circular measurement. */
export function judgeCircular(report) {
  const assertions = reportAssertions(report);
  if (typeof assertions === 'string') return fail(assertions);
  const tasks = circularTasks(assertions);
  if (typeof tasks === 'string') return fail(tasks);
  if (tasks.length !== 1) return fail(`${tasks.length} circular-500 measurements (want 1)`);
  const p99 = tasks[0].latency?.p99;
  if (typeof p99 !== 'number' || !Number.isFinite(p99) || p99 < 0) return fail('invalid p99 latency');
  const target = t('LAYOUT_500_NODES_MS');
  const advisory = p99 > target;
  return { pass: true, advisory, line: `${advisory ? 'ADVISORY' : 'PASS'} circular-500: p99 ${p99.toFixed(3)} ms, advisory target ${target} ms` };
}

/** Always run the unchanged 500-node fixture; synthetic runners are only for harness tests. */
export function runCircular({ runner = run } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-circular-'));
  const output = join(dir, 'bench.json');
  try {
    const result = runner('pnpm', [
      'exec',
      'vitest',
      'bench',
      '--run',
      '--project',
      'node (bench)',
      '--reporter=json',
      `--outputFile=${output}`,
      'packages/layout/bench/circular-500.bench.ts',
    ]);
    if (result.status !== 0) return fail(`benchmark process exited ${result.status}`);
    if (!existsSync(output)) return fail('missing benchmark output');
    return judgeCircular(JSON.parse(readFileSync(output, 'utf8')));
  } catch (error) {
    return fail(`invalid benchmark evidence: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verdict = runCircular();
  console.log(verdict.line);
  process.exitCode = verdict.pass ? 0 : 1;
}
