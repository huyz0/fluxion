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
      // every project, node-isolated too (ADR-0218): the same inventory on every OS, and on Windows one file at a time
      assert.equal(windows.test.projects.length, linux.test.projects.length);
      for (let i = 0; i < linux.test.projects.length; i++) for (const key of ['name', 'include', 'exclude', 'environment', 'isolate']) assert.deepEqual(windows.test.projects[i].test[key], linux.test.projects[i].test[key]);
      const isolated = windows.test.projects.find((p) => p.test.name === 'node-isolated').test;
      assert.equal(isolated.fileParallelism, false);
      assert.equal(linux.test.projects[0].test.fileParallelism, undefined);
      // the same groupOrder on every OS (M18.157); on Windows, where the node project has one worker too, Vitest runs it last (M18.276)
      for (let i = 0; i < linux.test.projects.length; i++) assert.deepEqual(windows.test.projects[i].test.sequence, linux.test.projects[i].test.sequence);
    } finally { Object.defineProperty(process, 'platform', platform); }
  `,
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('NFR-DX-003: browser test files run three at a time on Linux and one at a time on macOS, always after the node project (M18.157; M18.160, cp19 F1)', () => {
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
      const [macNode, macBrowser] = mac.test.projects.map(p => p.test);
      // side by side, Linux's browser files starved the node project's bounded-time tests (drawio-import at 10 s, twice): the browser
      // project runs after the node one on Linux and macOS, so Chromium never shares the machine with them (on Windows, M18.276: one
      // file at a time each, the one-worker node project last)
      for (const [n, b] of [[node, browser], [macNode, macBrowser]]) assert.ok(n.sequence.groupOrder < b.sequence.groupOrder, n.name);
      // the browser project waits more than it computes: three files at once on Linux (M18.157); macOS stays one at a time (M18.44)
      assert.equal(browser.fileParallelism, true);
      assert.equal(browser.maxWorkers, 3);
      assert.equal(macBrowser.fileParallelism, false);
      assert.equal(macBrowser.maxWorkers, undefined);
      for (const p of [node, macNode]) assert.equal(p.fileParallelism, undefined);
      assert.equal(linux.test.fileParallelism, undefined);
      assert.equal(linux.test.maxWorkers, undefined);
      for (const key of ['coverage', 'testTimeout', 'hookTimeout']) assert.deepEqual(mac.test[key], linux.test[key]);
    } finally { Object.defineProperty(process, 'platform', platform); }
  `,
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
