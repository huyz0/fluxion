// NFR-DX-003: a sandbox repo runs no background git maintenance, so its cleanup never races a `git gc --auto`
// still writing .git/objects (ENOTEMPTY on CI, M17.23).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sandbox } from './helpers.mjs';

describe('harness sandbox repos (NFR-DX-003)', () => {
  it('disable automatic gc and maintenance', () => {
    const sb = sandbox(['scripts/gates/lib.mjs'], { git: true });
    try {
      assert.equal(sb.git('config', '--get', 'gc.auto').stdout.trim(), '0');
      assert.equal(sb.git('config', '--get', 'maintenance.auto').stdout.trim(), 'false');
    } finally {
      sb.cleanup();
    }
  });
});
