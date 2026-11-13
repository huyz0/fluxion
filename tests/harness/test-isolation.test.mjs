// M18.290 (ADR-0218): the node project shares a module registry per worker; files that change process-wide state run isolated.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isolatedFiles, needsIsolation } from '../../tools/vitest/isolation.mjs';
import { REPO } from './helpers.mjs';

/** The resolved projects of vitest.config.ts on this platform, as `{ name, include, exclude, isolate, environment, groupOrder }`. */
function projects(env = {}) {
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `const c = (await import('./vitest.config.ts')).default;
       console.log(JSON.stringify(c.test.projects.map(({ test: p }) => ({ name: p.name, include: p.include, exclude: p.exclude ?? [], isolate: p.isolate, environment: p.environment, groupOrder: p.sequence?.groupOrder }))));`,
    ],
    { cwd: REPO, encoding: 'utf8', timeout: 60_000, env: { ...process.env, FLUXION_TEST_ISOLATE: '', ...env } },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

describe('node test isolation (ADR-0218, M18.290)', () => {
  it('HARNESS: a file that mocks modules, stubs globals or env, fakes timers or spies on process-wide objects needs isolation', () => {
    for (const source of [
      "vi.mock('./x.js', () => ({}));",
      "vi.doMock('node:fs');",
      'vi.resetModules();',
      "vi.stubGlobal('fetch', f);",
      "vi.stubEnv('CI', '1');",
      'vi.useFakeTimers();',
      "vi.spyOn(process, 'kill');",
      "vi.spyOn(console, 'warn');",
      "vi.spyOn(JSON, 'parse');",
      'Math.random = () => 0.5;',
      'Date.now = () => 0;',
      'globalThis.__ran = true;',
      "globalThis['x'] = 1;",
      "Object.defineProperty(globalThis, 'navigator', { value: {} });",
      "process.env.FLUXION_X = '1';",
      'delete process.env.FLUXION_X;',
      "process.chdir('/tmp');",
      "process.on('unhandledRejection', h);",
    ])
      assert.ok(needsIsolation(source), source);
  });

  it('HARNESS: a file that only reads process-wide state, or spies on its own objects, shares the registry', () => {
    for (const source of [
      'const f = vi.fn();',
      'vi.spyOn(editor, "commit");',
      "if (process.env.CI === '1') skip();",
      'const has = globalThis.__ran === true;',
      'const r = Math.random() === 0.5;',
      'const n = JSON.parse(text);',
      "expect(process.platform).toBe('linux');",
      "process.on('message', h);",
    ])
      assert.ok(!needsIsolation(source), source);
  });

  it('HARNESS: the node project shares modules and leaves out exactly the files that need isolation, which node-isolated runs on its own', () => {
    const list = isolatedFiles(REPO);
    // the files that failed when every node file shared a registry (M18.290 diagnosis, N2) are among them
    for (const f of ['packages/cli/src/render.connectors.test.ts', 'packages/cli/src/render.host.test.ts', 'packages/cli/src/svg-witness.test.ts'])
      assert.ok(list.includes(f), f);
    const ps = projects();
    const node = ps.find((p) => p.name === 'node');
    const isolated = ps.find((p) => p.name === 'node-isolated');
    assert.equal(node.isolate, false);
    // the node globs are unchanged, so node and node-isolated together run every node file once
    assert.deepEqual(node.include, ['{packages,packs,apps}/*/src/**/*.test.{ts,tsx}', 'scripts/examples/*.test.ts']);
    assert.deepEqual(node.exclude, ['{packages,packs,apps}/*/src/**/*.browser.test.{ts,tsx}', ...list]);
    assert.deepEqual(isolated.include, list);
    // default isolation, the same environment, and beside the node project before the browser one
    assert.equal(isolated.isolate, undefined);
    assert.equal(isolated.environment, node.environment);
    assert.equal(isolated.groupOrder, node.groupOrder);
    assert.ok(isolated.groupOrder < ps.find((p) => p.name === 'browser').groupOrder);
  });

  it('HARNESS: mutation runs keep one module registry per file: mutate.mjs sets FLUXION_TEST_ISOLATE, and the node project then isolates', () => {
    assert.equal(projects({ FLUXION_TEST_ISOLATE: '1' }).find((p) => p.name === 'node').isolate, true);
    assert.match(
      readFileSync(join(REPO, 'scripts/harness/mutate.mjs'), 'utf8'),
      /env: \{ \.\.\.process\.env, FLUXION_VITEST_CACHE: viteCache, FLUXION_TEST_ISOLATE: '1' \}/,
    );
  });
});
