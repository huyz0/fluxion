// M18.222 (cp32 F1): records every finished test's duration beside the timeout it ran under, so a
// harness report (scripts/harness/test-headroom.mjs) can list tests that use more than half their
// timeout on any OS before a slower runner turns them into a red main. Vitest loads it only when
// FLUXION_TEST_DURATIONS names the output file (CI's verify job sets it per OS).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

/**
 * One reading per finished test.
 * @param {{ moduleId: string, fullName: string, project: string, durationMs: number, timeoutMs: number }} t
 */
export const reading = (t) => ({
  module: relative(process.cwd(), t.moduleId).split('\\').join('/'),
  name: t.fullName,
  project: t.project,
  durationMs: Math.round(t.durationMs),
  timeoutMs: t.timeoutMs,
});

export class DurationsReporter {
  /** @param {{ file?: string }} [options] */
  constructor(options = {}) {
    this.file = options.file ?? process.env.FLUXION_TEST_DURATIONS ?? '';
    /** @type {ReturnType<typeof reading>[]} */
    this.tests = [];
    this.testTimeout = 0;
  }

  /** @param {{ config: { testTimeout: number } }} vitest */
  onInit(vitest) {
    this.testTimeout = vitest.config.testTimeout;
  }

  /** @param {any} testCase */
  onTestCaseResult(testCase) {
    const state = testCase.result().state;
    const duration = testCase.diagnostic()?.duration;
    if ((state !== 'passed' && state !== 'failed') || duration === undefined) return;
    this.tests.push(
      reading({
        moduleId: testCase.module.moduleId,
        fullName: testCase.fullName,
        project: testCase.project.name,
        durationMs: duration,
        timeoutMs: testCase.options.timeout ?? this.testTimeout,
      }),
    );
  }

  onTestRunEnd() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify({ platform: process.platform, tests: this.tests }, null, 1)}\n`);
  }
}
