// FR-DOC-004 (M2.10 review r2 F3): every diagnostic code in @fluxion/schema is documented in
// docs/reference/diagnostics.md with its severity, and the reference lists no code that does not exist.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

/** `CODE: severity` pairs of the DIAGNOSTIC_CODES object literal in diagnostics.ts. */
function codesInSource(src) {
  const body = /DIAGNOSTIC_CODES[^=]*=\s*\{([\s\S]*?)\};/.exec(src)?.[1] ?? '';
  return new Map([...body.matchAll(/\b(FLX_[A-Z_]+):\s*'(error|warning|info)'/g)].map((m) => [m[1], m[2]]));
}

/** `CODE: severity` pairs of the reference tables (`| \`CODE\` | severity | …`). */
function codesInDoc(doc) {
  return new Map([...doc.matchAll(/^\|\s*`(FLX_[A-Z_]+)`\s*\|\s*(error|warning|info)\s*\|/gm)].map((m) => [m[1], m[2]]));
}

describe('diagnostics reference (FR-DOC-004)', () => {
  it('FR-DOC-004: every diagnostic code is documented with its severity, and only those', () => {
    const code = codesInSource(readFileSync(join(REPO, 'packages/schema/src/diagnostics.ts'), 'utf8'));
    const doc = codesInDoc(readFileSync(join(REPO, 'docs/reference/diagnostics.md'), 'utf8'));
    assert.ok(code.size >= 20, `only ${code.size} codes parsed from diagnostics.ts`);
    assert.deepEqual(new Map([...doc].sort()), new Map([...code].sort()));
  });

  it('notices an undocumented code and a wrong severity', () => {
    const src = "export const DIAGNOSTIC_CODES: X = {\n  FLX_A: 'error',\n  FLX_B: 'warning',\n};";
    const doc = '| `FLX_A` | error | a |\n| `FLX_B` | error | b |\n';
    assert.notDeepEqual(new Map([...codesInDoc(doc)].sort()), new Map([...codesInSource(src)].sort()));
    assert.deepEqual([...codesInSource(src).keys()], ['FLX_A', 'FLX_B']);
  });
});
