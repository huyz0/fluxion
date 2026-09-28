// FR-SCR-001 / 04 §2.6: only packages/render/src/mode-policy.ts reads the render mode (ADR-0015).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { modeReads } from '../../scripts/gates/check-mode-policy.mjs';
import { node } from '../../scripts/gates/lib.mjs';
import { REPO } from './helpers.mjs';

describe('check-mode-policy (04 §2.6)', () => {
  it('the repo passes: render reads the mode through modePolicy only', () => {
    const r = node('scripts/gates/check-mode-policy.mjs', []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /mode-policy: \d+ render source files/);
  });

  it('a mode read outside mode-policy fails', () => {
    for (const code of [
      "if (props.mode === 'edit') x();",
      "const y = 'present' !== mode;",
      'switch (mode) {}',
      'if (mode) x();',
      'const z = props.mode ? a : b;',
      'const w = mode && a;',
      'const v = TABLE[mode];',
      'const u = TABLE[props.mode];',
      // review F2: renames, computed keys, membership and method calls
      "const { mode: m } = props; if (m === 'edit') x();",
      "if (props['mode'] === 1) x();",
      "const t = ['edit', 'present'].includes(mode);",
      "const s = mode.startsWith('e');",
    ])
      assert.equal(modeReads(code).length, 1, code);
    // passing it on, naming it in a type or a comment, and other identifiers are not reads
    for (const code of [
      'const policy = modePolicy(props.mode);',
      'readonly mode: RenderMode;',
      '// if (mode === x)',
      "const s = 'mode === 1';",
      'const modeName = 1; if (modeName === 1) {}',
      'const a = props.mode;',
      'const b = props?.mode;',
      // review F1: optional members and parameters are types, not branches
      'readonly mode?: RenderMode;',
      'function f(mode?: RenderMode) {}',
      'const c = mode ?? fallback;',
      'type P = { mode: string };',
    ])
      assert.deepEqual(modeReads(code), [], code);
  });

  it('the gate fails on a render source that branches on the mode', () => {
    const r = node('scripts/gates/check-mode-policy.mjs', ['--dir', `${REPO}/tests/harness/fixtures/mode-policy`]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /mode-policy: packages\/render\/src\/view\.tsx:2: if \(props\.mode === 'edit'\)/);
  });
});
