// NFR-DX-004 / non-negotiable 2: deleting or disabling tests needs an explicit, reviewed reason.
// The generated removal/disabling cases live in tests-kept-disabling.test.mjs (run in parallel, M1.38).
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out } from './helpers.mjs';
import { keptSandbox, ONLY, SKIP, SUITE } from './tests-kept-fixture.mjs';

describe('check-tests-kept (NFR-DX-004)', () => {
  const kept = keptSandbox();

  it('passes when no test is touched', () => {
    kept.sb.write('packages/core/src/a.ts', 'export const a = 2;\n');
    kept.sb.git('add', '-A');
    assert.equal(kept.check().status, 0);
  });

  it('passes when test cases are added', () => {
    kept.sb.write('packages/core/src/a.test.ts', `${SUITE}it('CASE-3: three', () => {});\n`);
    kept.sb.git('add', '-A');
    assert.equal(kept.check().status, 0);
  });

  it('passes when a test file is renamed to another test file', () => {
    kept.sb.git('mv', 'packages/core/src/a.test.ts', 'packages/core/src/b.test.ts');
    assert.equal(kept.check().status, 0);
  });

  it('the tracked commit-msg hook enforces it on a real commit', () => {
    kept.sb.write('.githooks/commit-msg', kept.sb.readRepo('.githooks/commit-msg'));
    chmodSync(kept.sb.path('.githooks/commit-msg'), 0o755);
    kept.sb.write('docs/backlog/current.md', '| M0.7 | t | x | x | — | doing | |\n');
    kept.sb.git('config', 'core.hooksPath', '.githooks');
    kept.sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    const refused = kept.sb.git('commit', '-q', '-m', 'M0.7: test: drop suite');
    assert.notEqual(refused.status, 0, out(refused));
    const ok = kept.sb.git('commit', '-q', '-m', 'M0.7: test: drop suite', '-m', 'Removes-test: superseded');
    assert.equal(ok.status, 0, out(ok));
  });

  it('deleting a released fixture needs Removes-test, and a versioned fixture is immutable (contracts.md rule 10, M2.18)', () => {
    kept.sb.write('fixtures/docs/minimal.flux.json', '{}\n');
    kept.sb.write('packages/format/fixtures/v1.0/doc.flux.json', '{}\n');
    kept.sb.git('add', '-A');
    kept.sb.git('commit', '-q', '-m', 'released fixtures', '--no-verify');
    kept.sb.git('rm', '-q', 'fixtures/docs/minimal.flux.json');
    const refused = kept.check();
    assert.equal(refused.status, 1, out(refused));
    assert.match(refused.stderr, /deletes released fixture fixtures\/docs\/minimal\.flux\.json/);
    assert.equal(kept.check('M0.7: test: x\n\nRemoves-test: superseded\n').status, 0);
    kept.sb.git('reset', '-q', '--hard');
    kept.sb.write('fixtures/docs/minimal.flux.json', '{"regenerated":true}\n');
    kept.sb.git('add', '-A');
    assert.equal(kept.check().status, 0, 'fixtures/docs is regenerated, so editing it is allowed');
    kept.sb.write('packages/format/fixtures/v1.0/doc.flux.json', '{"edited":true}\n');
    kept.sb.git('add', '-A');
    const edited = kept.check();
    assert.equal(edited.status, 1, out(edited));
    assert.match(edited.stderr, /edits released fixture packages\/format\/fixtures\/v1\.0\/doc\.flux\.json/);
    const excused = kept.check('M0.7: fix: x\n\nRemoves-test: fix old fixture\n');
    assert.equal(excused.status, 1, `no trailer excuses editing a released fixture: ${out(excused)}`);
    kept.sb.git('reset', '-q', '--hard');
    kept.sb.git('mv', 'packages/format/fixtures/v1.0/doc.flux.json', 'packages/format/fixtures/v1.0/doc-fixed.flux.json');
    const renamed = kept.check('M0.7: fix: x\n\nRemoves-test: fix old fixture\n');
    assert.equal(renamed.status, 1, `no trailer excuses renaming inside a released folder: ${out(renamed)}`);
    kept.sb.git('reset', '-q', '--hard');
    kept.sb.write('packages/format/fixtures/v1.0/extra.flux.json', '{}\n');
    kept.sb.write('packages/format/fixtures/v1.1/doc.flux.json', '{}\n');
    kept.sb.git('add', '-A');
    const added = kept.check();
    assert.equal(added.status, 1, out(added));
    assert.match(added.stderr, /adds packages\/format\/fixtures\/v1\.0\/extra\.flux\.json to the released fixture folder/);
    assert.doesNotMatch(added.stderr, /v1\.1/, 'a new version folder is not released yet');
    kept.sb.git('reset', '-q', '--hard');
    kept.sb.git('clean', '-fdq');
    kept.sb.write('packages/format/fixtures/draft/next.flux.json', '{"next":true}\n');
    kept.sb.git('add', '-A');
    kept.sb.git('commit', '-q', '-m', 'draft fixture', '--no-verify');
    kept.sb.git('mv', 'packages/format/fixtures/draft/next.flux.json', 'packages/format/fixtures/v2.0/next.flux.json');
    const promoted = kept.check();
    assert.equal(promoted.status, 0, `moving a fixture into a new version folder is fine (M2.19 review): ${out(promoted)}`);
  });

  it('an empty Removes-test trailer does not count', () => {
    kept.sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    assert.equal(kept.check('M0.7: test: x\n\nRemoves-test:\n').status, 1);
  });

  it('an empty Removes-test trailer followed by another trailer does not count', () => {
    kept.sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    const r = kept.check('M0.7: test: x\n\nRemoves-test:\nCo-Authored-By: Agent <a@example.invalid>\n');
    assert.equal(r.status, 1, out(r));
  });

  it('removing one copy of a duplicated title is a case swap, even when another copy remains (M1.29 review F1)', () => {
    const twin =
      "import { describe, it } from 'vitest';\ndescribe('parse', () => { it('handles empty', () => {}); });\ndescribe('format', () => { it('handles empty', () => {}); });\n";
    kept.sb.write('packages/core/src/b.test.ts', twin);
    kept.sb.git('add', '-A');
    kept.sb.git('commit', '-q', '-m', 'twin fixture', '--no-verify');
    kept.sb.write('packages/core/src/b.test.ts', twin.replace("describe('parse', () => { it('handles empty', () => {}); });", "it('noop', () => {});"));
    kept.sb.git('add', '-A');
    const r = kept.check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /case swap — test "handles empty" removed and not re-added \(1 of 2 copies\)/);
  });

  it('renaming a suite or a step, or removing a hook, is not a case removal (M1.29 review r2)', () => {
    const spec =
      "import { test } from '@playwright/test';\ntest.beforeEach(resetDb);\ntest.describe('login', () => {\n  test('CASE-9: signs in', async () => { await test.step('open', async () => {}); });\n});\n";
    kept.sb.write('e2e/login.spec.ts', spec);
    kept.sb.git('add', '-A');
    kept.sb.git('commit', '-q', '-m', 'spec fixture', '--no-verify');
    kept.sb.write('e2e/login.spec.ts', spec.replace('test.beforeEach(resetDb);\n', '').replace("'login'", "'sign-in'").replace("'open'", "'open the page'"));
    kept.sb.git('add', '-A');
    const r = kept.check();
    assert.equal(r.status, 0, out(r));
  });

  it('test calls written inside strings (fixtures) are not tests (M1.29)', () => {
    kept.sb.write(
      'packages/core/src/a.test.ts',
      `${SUITE}const fixture = "${SKIP}('x', () => {}); ${ONLY}('y', () => {});";\nit('CASE-3: uses fixture', () => fixture);\n`,
    );
    kept.sb.git('add', '-A');
    const r = kept.check();
    assert.equal(r.status, 0, out(r));
  });

  it('moving a case to another test file is not a case swap', () => {
    kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});\n", ''));
    kept.sb.write('packages/core/src/b.test.ts', "import { it } from 'vitest';\nit('CASE-2: two', () => {});\n");
    kept.sb.git('add', '-A');
    const r = kept.check();
    assert.equal(r.status, 0, out(r));
  });

  describe('Renames-test trailer (M1.26, M1 cp2 F2)', () => {
    const rename = () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('NFR-DX-004 CASE-2: two'"));
      kept.sb.git('add', '-A');
    };

    it('a matching pair lets a title rename through without Removes-test', () => {
      rename();
      const r = kept.check('M0.7: test: cite the requirement\n\nRenames-test: CASE-2: two -> NFR-DX-004 CASE-2: two\n');
      assert.equal(r.status, 0, out(r));
    });

    it('a pair whose new title was not added fails, even with Removes-test', () => {
      rename();
      const r = kept.check('M0.7: test: x\n\nRenames-test: CASE-2: two -> something else\nRemoves-test: covered\n');
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /Renames-test "CASE-2: two -> something else" does not match/);
    });

    it('a pair cannot relabel a test whose body changed (M1.26 review F2)', () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});", "it('NFR-DX-004 CASE-2: two', () => { /* emptied */ });"));
      kept.sb.git('add', '-A');
      const r = kept.check('M0.7: test: x\n\nRenames-test: CASE-2: two -> NFR-DX-004 CASE-2: two\n');
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /only the title may change/);
    });

    it('titles that contain " -> " still pair (M1.26 review F1)', () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('maps a -> b'"));
      kept.sb.git('add', '-A');
      kept.sb.git('commit', '-q', '-m', 'arrow fixture', '--no-verify');
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('maps a -> c'"));
      kept.sb.git('add', '-A');
      const r = kept.check('M0.7: test: x\r\n\r\nRenames-test: maps a -> b -> maps a -> c\r\n');
      assert.equal(r.status, 0, out(r));
    });

    it('quote style and formatter wrapping do not break a rename (M1.26 review r2)', () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});", 'it(\n  "CASE-2: doesn\'t crash",\n  () => {},\n);'));
      kept.sb.git('add', '-A');
      const r = kept.check("M0.7: test: x\n\nRenames-test: CASE-2: two -> CASE-2: doesn't crash\n");
      assert.equal(r.status, 0, out(r));
    });

    it('whitespace inside a string of the body is part of the body (M1.31)', () => {
      const withValue = (v) => SUITE.replace("it('CASE-2: two', () => {});", `it('CASE-2: two', () => { expect(f()).toBe('${v}'); });`);
      kept.sb.write('packages/core/src/a.test.ts', withValue('x  y'));
      kept.sb.git('add', '-A');
      kept.sb.git('commit', '-q', '-m', 'value fixture', '--no-verify');
      kept.sb.write('packages/core/src/a.test.ts', withValue('x y').replace("it('CASE-2: two'", "it('CASE-2: spaced'"));
      kept.sb.git('add', '-A');
      const r = kept.check('M0.7: test: x\n\nRenames-test: CASE-2: two -> CASE-2: spaced\n');
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /only the title may change/);
    });

    it('reindenting a comment in the body does not block a rename (M1.31 review)', () => {
      const body = (indent) => `it('CASE-2: two', () => {\n  /* one\n${indent}* two */\n  // note\r\n});`;
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});", body('   ')));
      kept.sb.git('add', '-A');
      kept.sb.git('commit', '-q', '-m', 'comment fixture', '--no-verify');
      kept.sb.write(
        'packages/core/src/a.test.ts',
        SUITE.replace("it('CASE-2: two', () => {});", body('         ').replace("'CASE-2: two'", "'CASE-2: moved'").replace('\r\n', '\n')),
      );
      kept.sb.git('add', '-A');
      const r = kept.check('M0.7: test: x\n\nRenames-test: CASE-2: two -> CASE-2: moved\n');
      assert.equal(r.status, 0, out(r));
    });

    it('a pair cannot excuse a real removal', () => {
      kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});\n", ''));
      kept.sb.git('add', '-A');
      const r = kept.check('M0.7: test: x\n\nRenames-test: CASE-2: two -> CASE-1: one\n');
      assert.equal(r.status, 1, out(r));
    });

    it('a swap without a pair still fails, and the hint names Renames-test', () => {
      rename();
      const r = kept.check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /Renames-test: <old title> -> <new title>/);
    });
  });

  it('names the swapped-out title in a case swap', () => {
    kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two'", "it('CASE-9: other'"));
    kept.sb.git('add', '-A');
    assert.match(kept.check().stderr, /case swap — test "CASE-2: two" removed/);
  });

  it('does not count method calls such as regex .test() as test cases', () => {
    kept.sb.write('packages/core/src/a.test.ts', SUITE.replace("it('CASE-2: two', () => {});\n", "assert.ok(/a/.test('a'));\n"));
    kept.sb.git('add', '-A');
    const r = kept.check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /removes 1 test case/);
  });
});
