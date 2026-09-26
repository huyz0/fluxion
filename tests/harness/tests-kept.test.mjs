// NFR-DX-004 / non-negotiable 2: deleting or disabling tests needs an explicit, reviewed reason.
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const SUITE = "import { it } from 'vitest';\nit('CASE-1: one', () => {});\nit('CASE-2: two', () => {});\n";
// Built indirectly so this file itself does not trip check-tests-kept.
const SKIP = ['it', 'skip'].join('.');
const ONLY = ['it', 'only'].join('.');
const SKIP_IF = ['describe', 'skipIf'].join('.');
const RUN_IF = ['it', 'runIf'].join('.');
const CONCURRENT_SKIP = ['it', 'concurrent', 'skip'].join('.');
const SKIPPED_SUITE = ['describe', 'skip'].join('.');
let sb;

function check(message = 'M0.7: test: change') {
  sb.write('.git-msg', message);
  return sb.node('scripts/gates/check-tests-kept.mjs', ['--msg', sb.path('.git-msg')]);
}

describe('check-tests-kept (NFR-DX-004)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts'], { git: true });
    sb.write('packages/core/src/a.test.ts', SUITE);
    sb.write('packages/core/src/a.ts', 'export const a = 1;\n');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'fixture', '--no-verify');
  });
  afterEach(() => sb.cleanup());

  it('passes when no test is touched', () => {
    sb.write('packages/core/src/a.ts', 'export const a = 2;\n');
    sb.git('add', '-A');
    assert.equal(check().status, 0);
  });

  it('passes when test cases are added', () => {
    sb.write('packages/core/src/a.test.ts', `${SUITE}it('CASE-3: three', () => {});\n`);
    sb.git('add', '-A');
    assert.equal(check().status, 0);
  });

  it('passes when a test file is renamed to another test file', () => {
    sb.git('mv', 'packages/core/src/a.test.ts', 'packages/core/src/b.test.ts');
    assert.equal(check().status, 0);
  });

  const bad = {
    'deleting a test file': () => sb.git('rm', '-q', 'packages/core/src/a.test.ts'),
    'removing a test case': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});\n", ''));
      sb.git('add', '-A');
    },
    'skipping a test case': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", `${SKIP}('CASE-2`));
      sb.git('add', '-A');
    },
    'focusing a test case with .only': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-1", `${ONLY}('CASE-1`));
      sb.git('add', '-A');
    },
    'adding a new skipped case': () => {
      sb.write('packages/core/src/a.test.ts', `${SUITE}${SKIP}('CASE-3: later', () => {});\n`);
      sb.git('add', '-A');
    },
    'renaming a test file to a non-test name': () => sb.git('mv', 'packages/core/src/a.test.ts', 'packages/core/src/a.old.ts'),
    // M0 cp1 F4: conditional disabling and title swaps
    'a new describe skipIf suite': () => {
      sb.write('packages/core/src/a.test.ts', `${SUITE}${SKIP_IF}(process.env.CI)('later', () => {});\n`);
      sb.git('add', '-A');
    },
    'turning a case into runIf': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", `${RUN_IF}(false)('CASE-2`));
      sb.git('add', '-A');
    },
    'a concurrent skip': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", `${CONCURRENT_SKIP}('CASE-2`));
      sb.git('add', '-A');
    },
    'commenting a case out': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", "// it('CASE-2"));
      sb.git('add', '-A');
    },
    'skipping a case with a node:test option': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', ", "it('CASE-2: two', { skip: true }, "));
      sb.git('add', '-A');
    },
    'wrapping cases in a skipped suite': () => {
      sb.write(
        'packages/core/src/a.test.ts',
        `import { describe, it } from 'vitest';\n${SKIPPED_SUITE}('later', () => {\n${SUITE.split('\n').slice(1).join('\n')}});\n`,
      );
      sb.git('add', '-A');
    },
    'x-prefixing a case': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2", "xit('CASE-2"));
      sb.git('add', '-A');
    },
    'focusing a case with an option': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-1: one', ", "it('CASE-1: one', { only: true }, "));
      sb.git('add', '-A');
    },
    'a case swap (title replaced, count unchanged)': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('CASE-9: something else'"));
      sb.git('add', '-A');
    },
  };
  for (const [name, act] of Object.entries(bad)) {
    it(`fails on ${name} without a trailer`, () => {
      act();
      const r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /tests-kept:/);
    });
    it(`passes on ${name} with a Removes-test trailer`, () => {
      act();
      const r = check('M0.7: test: drop obsolete case\n\nRemoves-test: covered by CASE-4 suite\n');
      assert.equal(r.status, 0, out(r));
    });
  }

  it('the tracked commit-msg hook enforces it on a real commit', () => {
    sb.write('.githooks/commit-msg', sb.readRepo('.githooks/commit-msg'));
    chmodSync(sb.path('.githooks/commit-msg'), 0o755);
    sb.write('docs/backlog/current.md', '| M0.7 | t | x | x | — | doing | |\n');
    sb.git('config', 'core.hooksPath', '.githooks');
    sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    const refused = sb.git('commit', '-q', '-m', 'M0.7: test: drop suite');
    assert.notEqual(refused.status, 0, out(refused));
    const ok = sb.git('commit', '-q', '-m', 'M0.7: test: drop suite', '-m', 'Removes-test: superseded');
    assert.equal(ok.status, 0, out(ok));
  });

  it('an empty Removes-test trailer does not count', () => {
    sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    assert.equal(check('M0.7: test: x\n\nRemoves-test:\n').status, 1);
  });

  it('an empty Removes-test trailer followed by another trailer does not count', () => {
    sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    const r = check('M0.7: test: x\n\nRemoves-test:\nCo-Authored-By: Agent <a@example.invalid>\n');
    assert.equal(r.status, 1, out(r));
  });

  it('removing one copy of a duplicated title is a case swap, even when another copy remains (M1.29 review F1)', () => {
    const twin =
      "import { describe, it } from 'vitest';\ndescribe('parse', () => { it('handles empty', () => {}); });\ndescribe('format', () => { it('handles empty', () => {}); });\n";
    sb.write('packages/core/src/b.test.ts', twin);
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'twin fixture', '--no-verify');
    sb.write('packages/core/src/b.test.ts', twin.replace("describe('parse', () => { it('handles empty', () => {}); });", "it('noop', () => {});"));
    sb.git('add', '-A');
    const r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /case swap — test "handles empty" removed and not re-added \(1 of 2 copies\)/);
  });

  it('renaming a suite or a step, or removing a hook, is not a case removal (M1.29 review r2)', () => {
    const spec =
      "import { test } from '@playwright/test';\ntest.beforeEach(resetDb);\ntest.describe('login', () => {\n  test('CASE-9: signs in', async () => { await test.step('open', async () => {}); });\n});\n";
    sb.write('e2e/login.spec.ts', spec);
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'spec fixture', '--no-verify');
    sb.write('e2e/login.spec.ts', spec.replace('test.beforeEach(resetDb);\n', '').replace("'login'", "'sign-in'").replace("'open'", "'open the page'"));
    sb.git('add', '-A');
    const r = check();
    assert.equal(r.status, 0, out(r));
  });

  it('test calls written inside strings (fixtures) are not tests (M1.29)', () => {
    sb.write(
      'packages/core/src/a.test.ts',
      `${SUITE}const fixture = "${SKIP}('x', () => {}); ${ONLY}('y', () => {});";\nit('CASE-3: uses fixture', () => fixture);\n`,
    );
    sb.git('add', '-A');
    const r = check();
    assert.equal(r.status, 0, out(r));
  });

  it('moving a case to another test file is not a case swap', () => {
    sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});\n", ''));
    sb.write('packages/core/src/b.test.ts', "import { it } from 'vitest';\nit('CASE-2: two', () => {});\n");
    sb.git('add', '-A');
    const r = check();
    assert.equal(r.status, 0, out(r));
  });

  describe('Renames-test trailer (M1.26, M1 cp2 F2)', () => {
    const rename = () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('NFR-DX-004 CASE-2: two'"));
      sb.git('add', '-A');
    };

    it('a matching pair lets a title rename through without Removes-test', () => {
      rename();
      const r = check('M0.7: test: cite the requirement\n\nRenames-test: CASE-2: two -> NFR-DX-004 CASE-2: two\n');
      assert.equal(r.status, 0, out(r));
    });

    it('a pair whose new title was not added fails, even with Removes-test', () => {
      rename();
      const r = check('M0.7: test: x\n\nRenames-test: CASE-2: two -> something else\nRemoves-test: covered\n');
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /Renames-test "CASE-2: two -> something else" does not match/);
    });

    it('a pair cannot relabel a test whose body changed (M1.26 review F2)', () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});", "it('NFR-DX-004 CASE-2: two', () => { /* emptied */ });"));
      sb.git('add', '-A');
      const r = check('M0.7: test: x\n\nRenames-test: CASE-2: two -> NFR-DX-004 CASE-2: two\n');
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /only the title may change/);
    });

    it('titles that contain " -> " still pair (M1.26 review F1)', () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('maps a -> b'"));
      sb.git('add', '-A');
      sb.git('commit', '-q', '-m', 'arrow fixture', '--no-verify');
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('maps a -> c'"));
      sb.git('add', '-A');
      const r = check('M0.7: test: x\r\n\r\nRenames-test: maps a -> b -> maps a -> c\r\n');
      assert.equal(r.status, 0, out(r));
    });

    it('quote style and formatter wrapping do not break a rename (M1.26 review r2)', () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});", 'it(\n  "CASE-2: doesn\'t crash",\n  () => {},\n);'));
      sb.git('add', '-A');
      const r = check("M0.7: test: x\n\nRenames-test: CASE-2: two -> CASE-2: doesn't crash\n");
      assert.equal(r.status, 0, out(r));
    });

    it('whitespace inside a string of the body is part of the body (M1.31)', () => {
      const withValue = (v) => SUITE.replace("it('CASE-2: two', () => {});", `it('CASE-2: two', () => { expect(f()).toBe('${v}'); });`);
      sb.write('packages/core/src/a.test.ts', withValue('x  y'));
      sb.git('add', '-A');
      sb.git('commit', '-q', '-m', 'value fixture', '--no-verify');
      sb.write('packages/core/src/a.test.ts', withValue('x y').replace("it('CASE-2: two'", "it('CASE-2: spaced'"));
      sb.git('add', '-A');
      const r = check('M0.7: test: x\n\nRenames-test: CASE-2: two -> CASE-2: spaced\n');
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /only the title may change/);
    });

    it('reindenting a comment in the body does not block a rename (M1.31 review)', () => {
      const body = (indent) => `it('CASE-2: two', () => {\n  /* one\n${indent}* two */\n  // note\r\n});`;
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});", body('   ')));
      sb.git('add', '-A');
      sb.git('commit', '-q', '-m', 'comment fixture', '--no-verify');
      sb.write(
        'packages/core/src/a.test.ts',
        SUITE.replace("it('CASE-2: two', () => {});", body('         ').replace("'CASE-2: two'", "'CASE-2: moved'").replace('\r\n', '\n')),
      );
      sb.git('add', '-A');
      const r = check('M0.7: test: x\n\nRenames-test: CASE-2: two -> CASE-2: moved\n');
      assert.equal(r.status, 0, out(r));
    });

    it('a pair cannot excuse a real removal', () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});\n", ''));
      sb.git('add', '-A');
      const r = check('M0.7: test: x\n\nRenames-test: CASE-2: two -> CASE-1: one\n');
      assert.equal(r.status, 1, out(r));
    });

    it('a swap without a pair still fails, and the hint names Renames-test', () => {
      rename();
      const r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /Renames-test: <old title> -> <new title>/);
    });
  });

  it('names the swapped-out title in a case swap', () => {
    sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('CASE-9: other'"));
    sb.git('add', '-A');
    assert.match(check().stderr, /case swap — test "CASE-2: two" removed/);
  });

  it('does not count method calls such as regex .test() as test cases', () => {
    sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});\n", "assert.ok(/a/.test('a'));\n"));
    sb.git('add', '-A');
    const r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /removes 1 test case/);
  });
});
