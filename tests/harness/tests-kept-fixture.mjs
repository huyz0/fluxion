// Shared fixture for the check-tests-kept suites (split in two files so they run in parallel, M1.38).
import { after, afterEach, before } from 'node:test';
import { sandbox } from './helpers.mjs';

export const SUITE = "import { it } from 'vitest';\nit('CASE-1: one', () => {});\nit('CASE-2: two', () => {});\n";
// Built indirectly so these files do not trip check-tests-kept themselves.
export const SKIP = ['it', 'skip'].join('.');
export const ONLY = ['it', 'only'].join('.');
export const SKIP_IF = ['describe', 'skipIf'].join('.');
export const RUN_IF = ['it', 'runIf'].join('.');
export const CONCURRENT_SKIP = ['it', 'concurrent', 'skip'].join('.');
export const SKIPPED_SUITE = ['describe', 'skip'].join('.');

/**
 * Registers hooks for one git sandbox per file, reset to the fixture commit after every case (a fresh
 * sandbox per case cost ~1.5 s each on Windows, M1.38). Call inside `describe`.
 */
export function keptSandbox() {
  const ctx = {
    sb: null,
    base: null,
    check(message = 'M0.7: test: change') {
      ctx.sb.write('.git-msg', message);
      return ctx.sb.node('scripts/gates/check-tests-kept.mjs', ['--msg', ctx.sb.path('.git-msg')]);
    },
  };
  before(() => {
    ctx.sb = sandbox(['scripts'], { git: true });
    ctx.sb.write('packages/core/src/a.test.ts', SUITE);
    ctx.sb.write('packages/core/src/a.ts', 'export const a = 1;\n');
    ctx.sb.git('add', '-A');
    ctx.sb.git('commit', '-q', '-m', 'fixture', '--no-verify');
    ctx.base = ctx.sb.git('rev-parse', 'HEAD').stdout.trim();
  });
  afterEach(() => {
    ctx.sb.git('reset', '-q', '--hard', ctx.base);
    ctx.sb.git('clean', '-fdqx');
    ctx.sb.git('config', '--unset', 'core.hooksPath');
  });
  after(() => ctx.sb.cleanup());
  return ctx;
}
