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
