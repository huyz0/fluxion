// M18.290 (ADR-0218): the node project shares one module registry per worker (`isolate: false`); a node test
// file that changes process-wide state runs in the `node-isolated` project instead, with Vitest's default
// isolation. The list is computed from each file's source at config load, so a new file is classified
// without a hand-kept list to rot. tests/harness/test-isolation.test.mjs holds the markers to account.
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What makes a file change state another file in the same worker would see: module mocks, stubbed globals
 * or env, fake timers, spies on process-wide objects, assignments to globalThis, process.env or the cwd.
 */
export const ISOLATION_MARKERS = [
  /\bvi\.(?:mock|doMock|unmock|doUnmock|hoisted|stubGlobal|stubEnv|useFakeTimers|setSystemTime|resetModules)\s*\(/,
  // a spy on a process-wide object or a built-in global (vi.spyOn(JSON, 'parse')), not on a test's own objects
  /\bvi\.spyOn\(\s*(?:globalThis|global|window|process|console|navigator|performance|crypto|JSON|Math|Date|Object|Array|String|Number|Boolean|Symbol|Promise|Reflect|Intl|Buffer|URL|Error|RegExp|Map|Set|WeakMap|Atomics|structuredClone|fetch|setTimeout|setInterval|queueMicrotask)\b/,
  // a built-in's member replaced by assignment (Math.random = …, Date.now = …)
  /\b(?:Math|Date|JSON|console|performance|crypto|Object|Array|String|Number|Promise|Reflect|Intl|Buffer|URL)\.\w+\s*=(?!=)/,
  /\b(?:globalThis|global)(?:\.\w+|\[[^\]]+\])\s*(?:=(?!=)|\+\+|--)/,
  /\b(?:Object\.defineProperty|Reflect\.(?:set|defineProperty)|Object\.assign)\(\s*(?:globalThis|global|process)\b/,
  /\bprocess\.env(?:\.\w+|\[[^\]]+\])\s*=(?!=)/,
  /\bdelete\s+(?:globalThis|global|process\.env)\b/,
  /\bprocess\.(?:chdir|umask|setUncaughtExceptionCaptureCallback)\s*\(/,
  /\bprocess\.(?:on|once|addListener|prependListener)\(\s*['"](?:uncaughtException|unhandledRejection|exit|SIGINT|SIGTERM)/,
];

/** Whether a test file's source changes process-wide state (one of ISOLATION_MARKERS). */
export const needsIsolation = (source) => ISOLATION_MARKERS.some((m) => m.test(source));

/** The node project's test files, as vitest.config.ts includes them (browser tests aside), relative and sorted. */
export const NODE_TEST_GLOBS = ['{packages,packs,apps}/*/src/**/*.test.{ts,tsx}', 'scripts/examples/*.test.ts'];

/** The node test files under `root` that must run isolated, relative with `/` and sorted. */
export function isolatedFiles(root) {
  const files = NODE_TEST_GLOBS.flatMap((g) => globSync(g, { cwd: root, exclude: (f) => f.includes('node_modules') }));
  return [...new Set(files.map((f) => f.split('\\').join('/')))]
    .filter((f) => !/\.browser\.test\.tsx?$/.test(f) && needsIsolation(readFileSync(join(root, f), 'utf8')))
    .sort();
}
