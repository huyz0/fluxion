// NFR-DX-004 / non-negotiable 2: each way to remove or disable a test fails without a Removes-test
// trailer and passes with one (split from tests-kept.test.mjs to run in parallel, M1.38).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { out } from './helpers.mjs';
import { CONCURRENT_SKIP, keptSandbox, ONLY, RUN_IF, SKIP, SKIP_IF, SKIPPED_SUITE, SUITE } from './tests-kept-fixture.mjs';

describe('check-tests-kept: removals and disabling (NFR-DX-004)', () => {
  const kept = keptSandbox();

  const bad = {
    'deleting a test file': () => kept.sb.git('rm', '-q', 'packages/core/src/a.test.ts'),
    'removing a test case': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});\n", ''));
      kept.sb.git('add', '-A');
    },
    'skipping a test case': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", `${SKIP}('CASE-2`));
      kept.sb.git('add', '-A');
    },
    'focusing a test case with .only': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-1", `${ONLY}('CASE-1`));
      kept.sb.git('add', '-A');
    },
    'adding a new skipped case': () => {
      kept.sb.write('packages/core/src/a.test.ts', `${SUITE}${SKIP}('CASE-3: later', () => {});\n`);
      kept.sb.git('add', '-A');
    },
    'renaming a test file to a non-test name': () => kept.sb.git('mv', 'packages/core/src/a.test.ts', 'packages/core/src/a.old.ts'),
    // M0 cp1 F4: conditional disabling and title swaps
    'a new describe skipIf suite': () => {
      kept.sb.write('packages/core/src/a.test.ts', `${SUITE}${SKIP_IF}(process.env.CI)('later', () => {});\n`);
      kept.sb.git('add', '-A');
    },
    'turning a case into runIf': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", `${RUN_IF}(false)('CASE-2`));
      kept.sb.git('add', '-A');
    },
    'a concurrent skip': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", `${CONCURRENT_SKIP}('CASE-2`));
      kept.sb.git('add', '-A');
    },
    'commenting a case out': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", "// it('CASE-2"));
      kept.sb.git('add', '-A');
    },
    'skipping a case with a node:test option': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', ", "it('CASE-2: two', { skip: true }, "));
      kept.sb.git('add', '-A');
    },
    'wrapping cases in a skipped suite': () => {
      kept.sb.write(
        'packages/core/src/a.test.ts',
        `import { describe, it } from 'vitest';\n${SKIPPED_SUITE}('later', () => {\n${SUITE.split('\n').slice(1).join('\n')}});\n`,
      );
      kept.sb.git('add', '-A');
    },
    'x-prefixing a case': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", "xit('CASE-2"));
      kept.sb.git('add', '-A');
    },
    'focusing a case with an option': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-1: one', ", "it('CASE-1: one', { only: true }, "));
      kept.sb.git('add', '-A');
    },
    'a case swap (title replaced, count unchanged)': () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('CASE-9: something else'"));
      kept.sb.git('add', '-A');
    },
  };
  for (const [name, act] of Object.entries(bad)) {
    it(`fails on ${name} without a trailer`, () => {
      act();
      const r = kept.check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /tests-kept:/);
    });
    it(`passes on ${name} with a Removes-test trailer`, () => {
      act();
      const r = kept.check('M0.7: test: drop obsolete case\n\nRemoves-test: covered by CASE-4 suite\n');
      assert.equal(r.status, 0, out(r));
    });
  }
});
