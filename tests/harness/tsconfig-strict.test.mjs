// NFR-MNT-002: the shared tsconfig is strict — unchecked index access and friends fail typecheck.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { out, REPO } from './helpers.mjs';

const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
const FIXTURE = join(REPO, 'tests', 'harness', 'fixtures', 'tsconfig-strict');

/** Type-check the fixture project plus `extra` files; returns the tsc result. */
function typecheck(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fluxion-ts-'));
  try {
    cpSync(join(REPO, 'tsconfig.base.json'), join(root, 'tsconfig.base.json'));
    const dir = join(root, 'tests', 'harness', 'fixtures', 'tsconfig-strict');
    cpSync(FIXTURE, dir, { recursive: true });
    // the fixture tsconfig extends ../../../../tsconfig.base.json, i.e. the temp root
    for (const [name, text] of Object.entries(extra)) writeFileSync(join(dir, name), text);
    return spawnSync(process.execPath, [TSC, '-p', dir], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('tsconfig strictness (NFR-MNT-002)', () => {
  it('accepts the well-typed fixture', () => {
    const r = typecheck();
    assert.equal(r.status, 0, out(r));
  });

  const bad = {
    'unchecked index access (noUncheckedIndexedAccess)': ['export const f = (a: { x: number }[]): number => a[0].x;\n', /TS2532/],
    'implicit any (strict)': ['export function f(a) { return a; }\n', /TS7006/],
    'undefined assigned to optional prop (exactOptionalPropertyTypes)': [
      'export interface O { a?: number }\nexport const o: O = { a: undefined };\n',
      /TS2375/,
    ],
    'missing override keyword (noImplicitOverride)': ['class A { m(): void {} }\nexport class B extends A { m(): void {} }\n', /TS4114/],
    'export without explicit type (isolatedDeclarations)': ['export const f = (a: number) => a * 2;\n', /TS9007|TS9010|TS9011|TS9013/],
    'type import without `import type` (verbatimModuleSyntax)': ['import { Point } from "./good.js";\nexport const p: Point = { x: 1 };\n', /TS1484/],
    'enum (erasableSyntaxOnly)': ['export enum E { A }\n', /TS1294/],
  };
  for (const [name, [src, code]] of Object.entries(bad)) {
    it(`rejects ${name}`, () => {
      const r = typecheck({ 'bad.ts': src });
      assert.equal(r.status, 1, out(r));
      assert.match(r.stdout, code);
    });
  }
});
