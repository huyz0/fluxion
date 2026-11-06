// NFR-MNT-001 / NFR-MNT-007: every library packs cleanly (publint) with correct types (attw).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { out, REPO, sandbox } from './helpers.mjs';

/** A sandbox with one built library; `mutate` breaks it before the check. */
function check(tool, mutate = () => {}, flag = '--dir') {
  const sb = sandbox([
    'scripts',
    'tools',
    'packages/core',
    'packages/geometry/package.json',
    'packages/schema/package.json',
    'pnpm-workspace.yaml',
    'package.json',
  ]);
  try {
    mutate(sb);
    return sb.node('scripts/gates/check-packages.mjs', ['--tool', tool, flag, 'packages/core'], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
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

  it('NFR-DX-002: --dirs checks the named libraries only, and a broken one among them still fails', () => {
    assert.equal(check('publint', () => {}, '--dirs').status, 0);
    const r = check(
      'publint',
      (sb) => sb.edit('packages/core/package.json', (t) => t.replace('"default": "./dist/index.js"', '"default": "./lib/missing.js"')),
      '--dirs',
    );
    assert.notEqual(r.status, 0, out(r));
  });

  it('fails publint when an export points at a file that is not packed', () => {
    const r = check('publint', (sb) =>
      sb.edit('packages/core/package.json', (t) => t.replace('"default": "./dist/index.js"', '"default": "./lib/missing.js"')),
    );
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /publint packages\/core/);
  });

  it('fails attw when the types entry is missing from the package', () => {
    const r = check('attw', (sb) => sb.edit('packages/core/package.json', (t) => t.replace('"types": "./dist/index.d.ts"', '"types": "./dist/nope.d.ts"')));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /attw packages\/core/);
  });

  it('NFR-DX-001: --pack-to packs each library once and both tools read those tarballs, not the folder (M18.157 attempt 4)', () => {
    const sb = sandbox([
      'scripts',
      'tools',
      'packages/core',
      'packages/geometry/package.json',
      'packages/schema/package.json',
      'pnpm-workspace.yaml',
      'package.json',
    ]);
    const env = { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } };
    const run = (args) => sb.node('scripts/gates/check-packages.mjs', [...args, '--dir', 'packages/core'], env);
    try {
      const good = join(sb.dir, 'good');
      assert.equal(run(['--pack-to', good]).status, 0);
      // broken after packing: the checks read the tarball, so they still pass
      sb.edit('packages/core/package.json', (t) =>
        t.replace('"types": "./dist/index.d.ts"', '"types": "./dist/nope.d.ts"').replace('"default": "./dist/index.js"', '"default": "./lib/missing.js"'),
      );
      for (const tool of ['publint', 'attw']) {
        const r = run(['--tool', tool, '--tarballs', good]);
        assert.equal(r.status, 0, `${tool}: ${out(r)}`);
      }
      // packed broken: both fail on the shared tarball
      const bad = join(sb.dir, 'bad');
      assert.equal(run(['--pack-to', bad]).status, 0);
      for (const tool of ['publint', 'attw']) {
        const r = run(['--tool', tool, '--tarballs', bad]);
        assert.equal(r.status, 1, `${tool}: ${out(r)}`);
        assert.match(r.stderr, new RegExp(`^${tool} packages/core:`, 'm'));
      }
      // a slot without its tarball is a failure, not a pass
      const none = join(sb.dir, 'none');
      mkdirSync(join(none, 'packages__core'), { recursive: true });
      const r = run(['--tool', 'publint', '--tarballs', none]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /expected one tarball for packages\/core, found 0/);
    } finally {
      sb.cleanup();
    }
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
