// NFR-MNT-001 / NFR-MNT-007: every library packs cleanly (publint) with correct types (attw).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { out, REPO, sandbox } from './helpers.mjs';

/** A sandbox with one built library; `mutate` breaks it before the check. */
function check(tool, mutate = () => {}) {
  const sb = sandbox(['scripts', 'tools', 'packages/core']);
  try {
    mutate(sb);
    return sb.node('scripts/gates/check-packages.mjs', ['--tool', tool, '--dir', 'packages/core'], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
  } finally {
    sb.cleanup();
  }
}

describe('check-packages (NFR-MNT-001, NFR-MNT-007)', () => {
  it('passes publint and attw on a built library', () => {
    for (const tool of ['publint', 'attw']) {
      const r = check(tool);
      assert.equal(r.status, 0, out(r));
    }
  });

  it('fails publint when an export points at a file that is not packed', () => {
    const r = check('publint', (sb) => sb.edit('packages/core/package.json', (t) => t.replace('"default": "./dist/index.js"', '"default": "./lib/missing.js"')));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /publint packages\/core/);
  });

  it('fails attw when the types entry is missing from the package', () => {
    const r = check('attw', (sb) => sb.edit('packages/core/package.json', (t) => t.replace('"types": "./dist/index.d.ts"', '"types": "./dist/nope.d.ts"')));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /attw packages\/core/);
  });

  it('rejects an unknown tool', () => {
    const sb = sandbox(['scripts', 'tools']);
    try {
      assert.equal(sb.node('scripts/gates/check-packages.mjs', ['--tool', 'eslint']).status, 2);
    } finally {
      sb.cleanup();
    }
  });
});
