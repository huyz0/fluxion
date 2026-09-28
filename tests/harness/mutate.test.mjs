// NFR-MNT-005 (ADR-0146): `pnpm mutate` runs tzap scoped to a diff, and never scores a stale report.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { node } from '../../scripts/gates/lib.mjs';
import { out } from './helpers.mjs';

const dirs = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'mutate-'));
  dirs.push(d);
  return d;
};
// sdk: a package this suite's own commits do not touch, so its diff against HEAD is small
const mutate = (dir, ...args) => node('scripts/harness/mutate.mjs', ['--package', 'packages/sdk', '--out-dir', dir, ...args]);

describe('pnpm mutate (NFR-MNT-005, ADR-0146)', () => {
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('a diff-scoped run writes a fresh report', () => {
    const dir = fresh();
    const r = mutate(dir, '--from', 'HEAD');
    assert.equal(r.status, 0, out(r));
    assert.ok(existsSync(join(dir, 'tzap.json')), 'no tzap.json');
    assert.match(r.stdout, /mutate: packages\/sdk: [\d.]+ % of \d+ valid mutants/);
  });

  it('a failing tzap run exits non-zero and leaves no stale report', () => {
    const dir = fresh();
    writeFileSync(join(dir, 'tzap.json'), JSON.stringify({ mutants: [{ file: 'packages/sdk/src/index.ts', status: 'Killed' }] }));
    const r = mutate(dir, '--from', 'no-such-ref-in-this-repo');
    assert.notEqual(r.status, 0, out(r));
    assert.ok(!existsSync(join(dir, 'tzap.json')), 'the stale report survived');
    assert.doesNotMatch(r.stdout, /valid mutants/);
  });
});
