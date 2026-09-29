// NFR-DX-004 / non-negotiable 2: thresholds only move in the strengthening direction.
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const FILE = 'scripts/gates/thresholds.mjs';
let sb;
let base;

function stageEdit(from, to) {
  sb.edit(FILE, (t) => {
    assert.ok(t.includes(from), `fixture anchor missing: ${from}`);
    return t.replace(from, to);
  });
  sb.git('add', FILE);
}
function check(message = 'M0.8: chore(gates): tune') {
  sb.write('.git-msg', message);
  return sb.node('scripts/gates/check-drift.mjs', ['--msg', sb.path('.git-msg')]);
}

describe('check-drift (NFR-DX-004)', () => {
  before(() => {
    sb = sandbox(['scripts'], { git: true });
    sb.write('docs/architecture/decisions/ADR-0042-relax-agents-cap.md', '# ADR-0042\n');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'adr fixture', '--no-verify');
    base = sb.git('rev-parse', 'HEAD').stdout.trim();
  });
  // one sandbox per file, reset to the fixture commit after every case: a fresh git sandbox per
  // case cost ~1.5 s each on Windows and made this file the harness suite's critical path (M1.38)
  afterEach(() => {
    sb.git('reset', '-q', '--hard', base);
    sb.git('clean', '-fdqx');
    sb.git('config', '--unset', 'core.hooksPath');
  });
  after(() => sb.cleanup());

  it('passes when thresholds are untouched', () => {
    assert.equal(check().status, 0);
  });

  it('passes when a ceiling is lowered (strengthened)', () => {
    stageEdit('AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { value: 200');
    assert.equal(check().status, 0);
  });

  it('passes when a floor is raised (strengthened) or a key is added', () => {
    stageEdit(
      "COVERAGE_PURE_LINES: { value: 90, weakens: 'down' },",
      "COVERAGE_PURE_LINES: { value: 95, weakens: 'down' },\n  NEW_KEY: { value: 1, weakens: 'up' },",
    );
    assert.equal(check().status, 0);
  });

  const weakenings = {
    'a ceiling raised': ['AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { value: 300', /AGENTS_MD_MAX_LINES 250 → 300/],
    'a floor lowered': ['COVERAGE_PURE_LINES: { value: 90', 'COVERAGE_PURE_LINES: { value: 80', /COVERAGE_PURE_LINES 90 → 80/],
    'a key removed': ["  REVIEW_ROUND_CAP: { value: 3, weakens: 'up' },\n", '', /REVIEW_ROUND_CAP removed/],
    'the weakening direction flipped': [
      "REVIEW_ROUND_CAP: { value: 3, weakens: 'up' }",
      "REVIEW_ROUND_CAP: { value: 3, weakens: 'down' }",
      /weakens-direction changed/,
    ],
  };
  for (const [name, [from, to, expected]] of Object.entries(weakenings)) {
    it(`fails on ${name} without a justified trailer`, () => {
      stageEdit(from, to);
      const r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, expected);
    });
  }

  const licenceWeakenings = {
    'an allowed licence added': ["allow: ['MIT', 'Apache-2.0',", "allow: ['MIT', 'LGPL-3.0-only', 'Apache-2.0',", /LICENSES\.allow gained LGPL-3\.0-only/],
    'a pack exception widened': [
      "'packs/layouts-elk': ['EPL-2.0']",
      "'packs/layouts-elk': ['EPL-2.0', 'GPL-3.0-only']",
      /packExceptions\[packs\/layouts-elk\] gained GPL-3\.0-only/,
    ],
    'a denied package dropped': ["'bpmn-js', ", '', /LICENSES\.denyPackages lost bpmn-js/],
  };
  for (const [name, [from, to, expected]] of Object.entries(licenceWeakenings)) {
    it(`fails on the licence policy weakening: ${name} (NFR-LIC-002)`, () => {
      stageEdit(from, to);
      const r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, expected);
    });
  }

  // testing.md rule 17, ADR-0146: per-package mutation floors only move up
  const FLOORS = '.harness/baselines/mutation.json';
  const floors = (packages) => `${JSON.stringify({ packages }, null, 2)}\n`;
  function commitFloors(packages) {
    sb.write(FLOORS, floors(packages));
    sb.git('add', FLOORS);
    sb.git('commit', '-q', '-m', 'floors fixture', '--no-verify');
  }

  it('a lowered mutation floor fails', () => {
    commitFloors({ 'packages/core': { score: 91 } });
    sb.write(FLOORS, floors({ 'packages/core': { score: 84 } }));
    sb.git('add', FLOORS);
    const r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /mutation floor of packages\/core 91 → 84/);
    // and a removed floor fails too
    sb.write(FLOORS, floors({}));
    sb.git('add', FLOORS);
    assert.match(check().stderr, /mutation floor of packages\/core removed/);
    // with a justified trailer the lowering passes, like any threshold
    sb.write(FLOORS, floors({ 'packages/core': { score: 84 } }));
    sb.git('add', FLOORS);
    assert.equal(check('M4.8: chore(gates): floor\n\nThreshold-change: flaky mutant (ADR-0042)\n').status, 0);
  });

  it('passes when a mutation floor is raised or a package floor is added', () => {
    commitFloors({ 'packages/core': { score: 84 } });
    sb.write(FLOORS, floors({ 'packages/core': { score: 92 }, 'packages/schema': { score: 70 } }));
    sb.git('add', FLOORS);
    const r = check();
    assert.equal(r.status, 0, out(r));
  });

  it('passes when the licence policy is narrowed (NFR-LIC-002)', () => {
    stageEdit("'ISC', '0BSD', ", "'ISC', ");
    assert.equal(check().status, 0);
  });

  it('accepts a weakening with a Threshold-change trailer citing an ADR', () => {
    stageEdit('AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { value: 300');
    const r = check('M0.8: chore(gates): relax\n\nThreshold-change: index grew with skills (ADR-0042)\n');
    assert.equal(r.status, 0, out(r));
  });

  it('rejects a trailer without an ADR reference, or an empty one followed by another trailer', () => {
    stageEdit('AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { value: 300');
    assert.equal(check('M0.8: chore: x\n\nThreshold-change: because\n').status, 1);
    assert.equal(check('M0.8: chore: x\n\nThreshold-change:\nCo-Authored-By: a (ADR-0001)\n').status, 1);
  });

  it('fails when a value stops being a finite number (silently disabled gate)', () => {
    stageEdit('AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { max: 250');
    const r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /AGENTS_MD_MAX_LINES value is not a finite number/);
  });

  it('fails when the thresholds file is deleted', () => {
    sb.git('rm', '-q', FILE);
    const r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /REVIEW_ROUND_CAP removed/);
  });

  it('rejects a trailer citing an ADR that does not exist', () => {
    stageEdit('AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { value: 300');
    const r = check('M0.8: chore: x\n\nThreshold-change: need room (ADR-9999)\n');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /ADR-9999 cited in Threshold-change does not exist/);
  });

  it('--commit checks a committed change against its parent (CI, amend-proof)', () => {
    stageEdit('AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { value: 300');
    sb.git('commit', '-q', '-m', 'M0.8: chore: sneak', '--no-verify');
    const head = sb.git('rev-parse', 'HEAD').stdout.trim();
    assert.equal(sb.node('scripts/gates/check-drift.mjs', ['--commit', head]).status, 1);
    sb.git('commit', '-q', '--amend', '--no-verify', '-m', 'M0.8: chore: relax', '-m', 'Threshold-change: justified (ADR-0042)');
    const amended = sb.git('rev-parse', 'HEAD').stdout.trim();
    assert.equal(sb.node('scripts/gates/check-drift.mjs', ['--commit', amended]).status, 0);
  });
  it('fails when a golden or screenshot baseline is re-recorded or deleted without a Threshold-change trailer (M5 final F2)', () => {
    // the baselines as they stood before the change
    sb.write('packages/demo/__golden__/two.svg', '<svg>one</svg>\n');
    sb.write('e2e/demo.spec.ts-snapshots/two-chromium-linux.png', 'png-one');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'baselines', '--no-verify');
    // re-recording one: refused without a trailer, accepted with one naming the behaviour (no ADR needed)
    sb.write('packages/demo/__golden__/two.svg', '<svg>two</svg>\n');
    sb.git('add', '-A');
    const bare = check();
    assert.equal(bare.status, 1, out(bare));
    assert.match(bare.stderr, /packages\/demo\/__golden__\/two\.svg re-recorded/);
    assert.equal(check('M5.40: test: arrow\n\nThreshold-change: the arrow marker is notched\n').status, 0);
    // deleting a screenshot baseline is refused too
    sb.git('reset', '-q', '--hard');
    sb.git('rm', '-q', 'e2e/demo.spec.ts-snapshots/two-chromium-linux.png');
    const deleted = check();
    assert.equal(deleted.status, 1, out(deleted));
    assert.match(deleted.stderr, /two-chromium-linux\.png deleted/);
    // a new baseline records a behaviour for the first time: no trailer
    sb.git('reset', '-q', '--hard');
    sb.write('packages/demo/__golden__/three.svg', '<svg/>\n');
    sb.write('e2e/demo.spec.ts-snapshots/three-webkit-linux.png', 'png');
    sb.git('add', '-A');
    assert.equal(check().status, 0);
    // --commit reads the committed change the same way (CI)
    sb.write('packages/demo/__golden__/two.svg', '<svg>three</svg>\n');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'M5.40: test: sneak', '--no-verify');
    assert.equal(sb.node('scripts/gates/check-drift.mjs', ['--commit', sb.git('rev-parse', 'HEAD').stdout.trim()]).status, 1);
  });

  it('covers Vitest snapshots and unusual paths, and does not re-judge commits made before the rule (M5.40 review)', () => {
    sb.write('packages/demo/src/__snapshots__/a.test.ts.snap', 'one\n');
    sb.write('e2e/demo.spec.ts-snapshots/café-chromium-linux.png', 'png-one');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'baselines', '--no-verify');
    // a re-recorded Vitest snapshot, and a screenshot whose name git would quote
    sb.write('packages/demo/src/__snapshots__/a.test.ts.snap', 'two\n');
    sb.write('e2e/demo.spec.ts-snapshots/café-chromium-linux.png', 'png-two');
    sb.git('add', '-A');
    const r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /a\.test\.ts\.snap re-recorded/);
    assert.match(r.stderr, /café-chromium-linux\.png re-recorded/);
    // a commit whose parent did not have the rule yet is not judged by it (history stays green)
    sb.git('reset', '-q', '--hard');
    sb.edit('scripts/gates/check-drift.mjs', (t) =>
      t.replaceAll('function baselineChanges()', 'function baselineChangesOld()').replace('baselineChanges()', 'baselineChangesOld()'),
    );
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'before the rule', '--no-verify');
    sb.git('checkout', '-q', base, '--', 'scripts/gates/check-drift.mjs');
    sb.write('packages/demo/src/__snapshots__/a.test.ts.snap', 'three\n');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'M4.21: test: old re-record', '--no-verify');
    assert.equal(sb.node('scripts/gates/check-drift.mjs', ['--commit', sb.git('rev-parse', 'HEAD').stdout.trim()]).status, 0);
  });
});
