// M18.283: one stderr line when each test file is queued, starts and ends, so a run that stalls names the files in flight. Vitest's default
// reporter prints a file only when it finishes; ci 42159843232's Windows verify stalled after 56 browser files with nothing
// naming the next one. Loaded beside DurationsReporter (CI's verify job); the ladder's idle watchdog reads the lines with inFlight
// (scripts/gates/lib.mjs).
import { relative } from 'node:path';

/** The line for one file event: `vitest-progress: start browser (chromium) packages/x/y.browser.test.ts` (event: queued, start or end). */
export const progressLine = (event, project, moduleId) =>
  `vitest-progress: ${event} ${project || 'default'} ${relative(process.cwd(), moduleId).split('\\').join('/')}\n`;

export class ProgressReporter {
  /** @param {{ write?: (line: string) => void }} [options] */
  constructor(options = {}) {
    this.write = options.write ?? ((line) => process.stderr.write(line));
  }

  /** Queued: a worker took the file, before it is imported, so a file stuck loading is named too (M18.283 r1 F1). @param {any} testModule */
  onTestModuleQueued(testModule) {
    this.write(progressLine('queued', testModule.project?.name, testModule.moduleId));
  }

  /** @param {any} testModule */
  onTestModuleStart(testModule) {
    this.write(progressLine('start', testModule.project?.name, testModule.moduleId));
  }

  /** @param {any} testModule */
  onTestModuleEnd(testModule) {
    this.write(progressLine('end', testModule.project?.name, testModule.moduleId));
  }
}
