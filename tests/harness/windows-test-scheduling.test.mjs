import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Resolve the actual configuration in an isolated process; no production platform override.
test('HARNESS: Windows serializes existing test projects without changing inventory, coverage or limits', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    await import('./vitest.config.ts');
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const config = async (value) => {
      Object.defineProperty(process, 'platform', { ...platform, value });
      return (await import('./vitest.config.ts?platform=' + value)).default;
    };
    try {
      const linux = await config('linux'), windows = await config('win32');
      const [node, browser] = windows.test.projects.map(p => p.test);
      assert.equal(node.name, 'node');
      assert.equal(browser.name, 'browser');
      assert.equal(node.fileParallelism, false);
      assert.equal(browser.fileParallelism, false);
      assert.ok(node.sequence.groupOrder < browser.sequence.groupOrder);
      for (const key of ['coverage', 'testTimeout', 'hookTimeout', 'setupFiles', 'env']) assert.deepEqual(windows.test[key], linux.test[key]);
      for (let i = 0; i < 2; i++) for (const key of ['name', 'include', 'exclude', 'environment']) assert.deepEqual(windows.test.projects[i].test[key], linux.test.projects[i].test[key]);
      assert.equal(linux.test.projects[0].test.fileParallelism, undefined);
      assert.equal(linux.test.projects[0].test.sequence, undefined);
      assert.equal(linux.test.projects[1].test.sequence, undefined);
    } finally { Object.defineProperty(process, 'platform', platform); }
  `,
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('NFR-DX-001: Linux runs browser test files in parallel beside the node project; macOS keeps them serial (M18.117)', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    await import('./vitest.config.ts');
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const config = async (value) => {
      Object.defineProperty(process, 'platform', { ...platform, value });
      return (await import('./vitest.config.ts?platform=' + value)).default;
    };
    try {
      const linux = await config('linux'), mac = await config('darwin');
      const [node, browser] = linux.test.projects.map(p => p.test);
      // one scheduling group: neither project restricts parallelism or orders itself after the other
      for (const p of [node, browser]) {
        assert.equal(p.fileParallelism, undefined, p.name);
        assert.equal(p.sequence, undefined, p.name);
        assert.equal(p.maxWorkers, undefined, p.name);
      }
      assert.equal(mac.test.projects[1].test.fileParallelism, false);
      assert.equal(mac.test.projects[0].test.fileParallelism, undefined);
      for (const key of ['coverage', 'testTimeout', 'hookTimeout']) assert.deepEqual(mac.test[key], linux.test[key]);
    } finally { Object.defineProperty(process, 'platform', platform); }
  `,
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
