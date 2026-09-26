// NFR-MNT-002 / NFR-MNT-003: every lint rule the standards rely on actually fires.
// Each fixture under fixtures/biome breaks exactly one rule; it is copied into a sandbox at the
// path whose overrides apply (pure package, adapter, plain package) and linted with the real config.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { THRESHOLDS } from '../../scripts/gates/thresholds.mjs';
import { cleanEnv, out, REPO } from './helpers.mjs';

const FIXTURES = join(REPO, 'tests/harness/fixtures/biome');
const BIOME = join(REPO, 'node_modules/@biomejs/biome/bin/biome');
const config = JSON.parse(readFileSync(join(REPO, 'biome.json'), 'utf8'));
let dir;

function lint(fixture, target) {
  rmSync(join(dir, 'packages'), { recursive: true, force: true });
  mkdirSync(dirname(join(dir, target)), { recursive: true });
  cpSync(join(FIXTURES, fixture), join(dir, target));
  return spawnSync(process.execPath, [BIOME, 'lint', '--colors=off', '--max-diagnostics=50', target], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
}

// fixture → [sandbox path, rule that must be reported]
const CASES = {
  'no-explicit-any.ts': ['packages/render/src/a.ts', 'lint/suspicious/noExplicitAny'],
  'no-re-export-all.ts': ['packages/render/src/index.ts', 'lint/performance/noReExportAll'],
  'use-max-params.ts': ['packages/render/src/a.ts', 'lint/complexity/useMaxParams'],
  'no-global-eval.ts': ['packages/render/src/a.ts', 'lint/security/noGlobalEval'],
  'no-focused-tests.ts': ['packages/render/src/a.test.ts', 'lint/suspicious/noFocusedTests'],
  'no-skipped-tests.ts': ['packages/render/src/a.test.ts', 'lint/suspicious/noSkippedTests'],
  'no-excessive-lines-per-function.ts': ['packages/render/src/a.ts', 'lint/complexity/noExcessiveLinesPerFunction'],
  'no-excessive-cognitive-complexity.ts': ['packages/render/src/a.ts', 'lint/complexity/noExcessiveCognitiveComplexity'],
  'no-default-export.ts': ['packages/render/src/a.ts', 'lint/style/noDefaultExport'],
  'no-non-null-assertion.ts': ['packages/render/src/a.ts', 'lint/style/noNonNullAssertion'],
  'pure-date.ts': ['packages/core/src/a.ts', 'lint/style/noRestrictedGlobals'],
  'pure-set-timeout.ts': ['packages/anim/src/a.ts', 'lint/style/noRestrictedGlobals'],
  'pure-math-random.ts': ['packages/geometry/src/a.ts', 'Math.random() is not deterministic in pure packages'],
};

describe('biome rules (NFR-MNT-002, NFR-MNT-003)', () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-biome-'));
    // the sandbox is not a git repo: same rules, VCS integration off
    writeFileSync(join(dir, 'biome.json'), JSON.stringify({ ...config, $schema: undefined, vcs: { enabled: false } }));
    cpSync(join(REPO, 'tools/biome'), join(dir, 'tools/biome'), { recursive: true });
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  for (const [fixture, [target, rule]] of Object.entries(CASES)) {
    it(`fails lint on ${fixture} with ${rule.split(' ')[0]}`, () => {
      const r = lint(fixture, target);
      assert.equal(r.status, 1, out(r));
      assert.ok(`${r.stdout}${r.stderr}`.includes(rule), out(r));
    });
  }

  it('Math.random() is allowed outside pure packages (the plugin is scoped)', () => {
    const r = lint('pure-math-random.ts', 'packages/render/src/a.ts');
    assert.equal(r.status, 0, out(r));
  });

  it('restricted globals are allowed outside pure packages', () => {
    const r = lint('pure-date.ts', 'packages/render/src/a.ts');
    assert.equal(r.status, 0, out(r));
  });

  it('explicit any is allowed under src/adapters (the allowlist)', () => {
    const r = lint('adapter-any-allowed.ts', 'packages/render/src/adapters/a.ts');
    assert.equal(r.status, 0, out(r));
  });

  it('long describe/it callbacks are allowed in co-located test files (M1.9 review F2)', () => {
    const r = lint('no-excessive-lines-per-function.ts', 'packages/render/src/a.test.ts');
    assert.equal(r.status, 0, out(r));
  });

  it('function length and complexity limits equal the thresholds', () => {
    const { complexity } = config.linter.rules;
    assert.equal(complexity.noExcessiveLinesPerFunction.options.maxLines, THRESHOLDS.FUNCTION_MAX_LINES.value);
    assert.equal(complexity.noExcessiveCognitiveComplexity.options.maxAllowedComplexity, THRESHOLDS.COMPLEXITY_MAX.value);
  });
});
