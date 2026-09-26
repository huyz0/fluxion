// NFR-DX-002: the pre-commit ladder overlaps independent steps without changing what it reports.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { nestedSkip, run, runAsync } from '../../scripts/gates/lib.mjs';
import { out, sandbox, TRANSIENT } from './helpers.mjs';

describe('pre-commit ladder concurrency (NFR-DX-002, M1.28)', () => {
  it('runAsync returns what run returns: status, stdout and stderr', async () => {
    const cases = [
      [process.execPath, ['-e', "process.stdout.write('out'); process.stderr.write('err')"]],
      [process.execPath, ['-e', 'process.exit(3)']],
      // ~600 kB of multi-byte characters: chunk boundaries fall inside characters (M1.28 review F1)
      [process.execPath, ['-e', "process.stdout.write('é—'.repeat(120000))"]],
    ];
    for (const [cmd, args] of cases) assert.deepEqual(await runAsync(cmd, args), run(cmd, args));
  });

  it('sandboxes do not copy build state that concurrent steps rewrite (M1.33)', () => {
    const sb = sandbox(['packages/core']);
    try {
      for (const p of ['.tsbuild', 'node_modules', 'coverage']) assert.equal(existsSync(sb.path(`packages/core/${p}`)), false, p);
      assert.ok(existsSync(sb.path('packages/core/src/index.ts')));
    } finally {
      sb.cleanup();
    }
    for (const p of ['packages/core/.tsbuild/x.tsbuildinfo', 'packages/core/node_modules/a/b.js', 'packages/core/fluxion-core-0.0.0.tgz']) {
      assert.match(p.replaceAll('/', '\\'), TRANSIENT, p);
      assert.match(`/repo/${p}`, TRANSIENT, p);
    }
    for (const p of ['packages/core/src/tsbuild.ts', 'packages/core/dist/index.js']) assert.doesNotMatch(`/repo/${p}`, TRANSIENT, p);
  });

  it('a tool that exits 0 but reports its own SKIP prints as SKIP, not PASS (M1.19, M1 cp1 F3)', () => {
    assert.equal(nestedSkip('actionlint: 0 findings\nworkflows: SKIP — Docker not available\n'), 'Docker not available');
    assert.equal(nestedSkip('workflows: 3 files linted\n'), null);
    const sb = sandbox();
    try {
      sb.write('.github/workflows/ci.yml', 'name: ci\n');
      sb.write('scripts/gates/check-workflows.mjs', "console.log('workflows: SKIP — Docker not available');\n");
      const r = sb.node('scripts/gates/precommit.mjs', ['--all', '--summary']);
      assert.match(r.stdout, /^SKIP workflows — Docker not available$/m, out(r));
      assert.doesNotMatch(r.stdout, /^PASS workflows/m);
    } finally {
      sb.cleanup();
    }
  });

  it('runAsync reports a missing command as a failure instead of throwing', async () => {
    const r = await runAsync('fluxion-no-such-command-xyz', []);
    assert.notEqual(r.status, 0);
  });

  it('prints every step once, in ladder order, although steps after build run concurrently', () => {
    const sb = sandbox();
    try {
      const r = sb.node('scripts/gates/precommit.mjs', ['--all', '--summary']);
      const order = [...sb.read('scripts/gates/precommit.mjs').matchAll(/^ {2}(?:\[|\[\n {4})?'([a-z-]+)',/gm)].map((m) => m[1]);
      const printed = [...r.stdout.matchAll(/^(?:PASS|FAIL|SKIP) ([a-z-]+)/gm)].map((m) => m[1]);
      assert.ok(printed.includes('build') && printed.includes('trace'), out(r));
      assert.deepEqual(
        printed,
        order.filter((n) => printed.includes(n)),
        out(r),
      );
      assert.equal(new Set(printed).size, printed.length, 'no step printed twice');
    } finally {
      sb.cleanup();
    }
  });
});
