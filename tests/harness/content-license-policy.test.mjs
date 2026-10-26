import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { allowsShapePackContentLicense, shapePackContentLicenses } from '../../packages/core/dist/index.js';
import { parseSpdx, satisfiable } from '../../scripts/gates/spdx.mjs';
import { LICENSES } from '../../scripts/gates/thresholds.mjs';

const policyText = readFileSync(new URL('../../docs/standards/tech-stack.md', import.meta.url), 'utf8');
const contentClause = /\*\*Content assets\*\*[\s\S]*? with\n/.exec(policyText)?.[0] ?? '';
const contentIds = contentClause.match(/\b[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9.]+)+\b/g) ?? [];
const allow = [...LICENSES.allow, ...contentIds];

test('NFR-LIC-003: runtime content IDs exactly follow the authoritative code allowlist and content additions', () => {
  assert.equal(contentIds.length, 3, 'content policy changed: review adapter and parity fixtures');
  assert.deepEqual(shapePackContentLicenses, allow);
  for (const id of Object.values(LICENSES.packExceptions).flat()) assert.equal(allowsShapePackContentLicense(id), false, id);
});

test('NFR-LIC-003: runtime content decisions retain repository SPDX precedence and all AND obligations', () => {
  const ids = [...allow, ...Object.values(LICENSES.packExceptions).flat(), 'GPL-3.0-only', 'Unknown'];
  const check = (expression) =>
    assert.equal(
      allowsShapePackContentLicense(expression),
      satisfiable(parseSpdx(expression), (id) => allow.includes(id)),
      expression,
    );
  for (const left of ids) {
    check(left);
    check(`${left} WITH LLVM-exception`);
    for (const right of ids) {
      check(`${left} AND ${right}`);
      check(`${left} OR ${right}`);
      check(`(${left} OR ${right}) AND ISC`);
      check(`${left} OR ${right} AND ISC`);
    }
  }
});
