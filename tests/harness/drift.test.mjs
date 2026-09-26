// NFR-DX-004 / non-negotiable 2: thresholds only move in the strengthening direction.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const FILE = 'scripts/gates/thresholds.mjs';
let sb;

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
  beforeEach(() => {
    sb = sandbox(['scripts'], { git: true });
    sb.write('docs/architecture/decisions/ADR-0042-relax-agents-cap.md', '# ADR-0042\n');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'adr fixture', '--no-verify');
  });
  afterEach(() => sb.cleanup());

  it('passes when thresholds are untouched', () => {
    assert.equal(check().status, 0);
  });

  it('passes when a ceiling is lowered (strengthened)', () => {
    stageEdit('AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { value: 200');
    assert.equal(check().status, 0);
  });

  it('passes when a floor is raised (strengthened) or a key is added', () => {
    stageEdit("COVERAGE_PURE_LINES: { value: 90, weakens: 'down' },", "COVERAGE_PURE_LINES: { value: 95, weakens: 'down' },\n  NEW_KEY: { value: 1, weakens: 'up' },");
    assert.equal(check().status, 0);
  });

  const weakenings = {
    'a ceiling raised': ['AGENTS_MD_MAX_LINES: { value: 250', 'AGENTS_MD_MAX_LINES: { value: 300', /AGENTS_MD_MAX_LINES 250 → 300/],
    'a floor lowered': ['COVERAGE_PURE_LINES: { value: 90', 'COVERAGE_PURE_LINES: { value: 80', /COVERAGE_PURE_LINES 90 → 80/],
    'a key removed': ["  REVIEW_ROUND_CAP: { value: 3, weakens: 'up' },\n", '', /REVIEW_ROUND_CAP removed/],
    'the weakening direction flipped': ["REVIEW_ROUND_CAP: { value: 3, weakens: 'up' }", "REVIEW_ROUND_CAP: { value: 3, weakens: 'down' }", /weakens-direction changed/],
  };
  for (const [name, [from, to, expected]] of Object.entries(weakenings)) {
    it(`fails on ${name} without a justified trailer`, () => {
      stageEdit(from, to);
      const r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, expected);
    });
  }

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
});
