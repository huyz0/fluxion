// NFR-LIC-002: licence expressions are read with SPDX precedence and grouping (M1.15 review r2 F1).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSpdx, satisfiable } from '../../scripts/gates/spdx.mjs';

const allow = ['MIT', 'Apache-2.0'];
const ok = (expr) => satisfiable(parseSpdx(expr), (id) => allow.includes(id));

describe('SPDX expressions (NFR-LIC-002)', () => {
  it('OR needs one allowed alternative, AND needs every part', () => {
    assert.equal(ok('MIT'), true);
    assert.equal(ok('MIT OR GPL-3.0-only'), true);
    assert.equal(ok('MIT AND GPL-3.0-only'), false);
  });

  it('parentheses group: (A OR B) AND C needs C', () => {
    assert.equal(ok('(MIT OR Apache-2.0) AND GPL-3.0-only'), false);
    assert.equal(ok('(MIT OR GPL-3.0-only) AND Apache-2.0'), true);
    assert.equal(ok('GPL-3.0-only OR (MIT AND Apache-2.0)'), true);
  });

  it('AND binds tighter than OR, case-insensitively', () => {
    assert.equal(ok('GPL-3.0-only and MIT or Apache-2.0'), true);
    assert.equal(ok('MIT and GPL-3.0-only or GPL-2.0-only'), false);
  });

  it('WITH attaches an exception to its licence', () => {
    assert.deepEqual(parseSpdx('Apache-2.0 WITH LLVM-exception'), { id: 'Apache-2.0' });
    assert.equal(ok('GPL-2.0-only WITH Classpath-exception-2.0 OR MIT'), true);
  });

  it('free text and malformed expressions throw', () => {
    for (const bad of ['GNU GPLv3', '(MIT OR Apache-2.0', 'MIT OR', 'MIT WITH', 'AND MIT']) {
      assert.throws(() => parseSpdx(bad), undefined, bad);
    }
  });
});
