// One Vitest run for the whole repo (NFR-MNT-004, testing.md §1–§6).
//   node          — T0: `*.test.ts(x)` in Node, no DOM, one module registry per worker (ADR-0218)
//   node-isolated — T0: the node files that change process-wide state, each in a fresh registry (ADR-0218)
//   browser — T1: `*.browser.test.ts(x)` in Chromium through Playwright
// Coverage floors per package come from scripts/gates/thresholds.mjs (check-drift guards them).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { t } from './scripts/gates/thresholds.mjs';
import { domFreeAliases } from './tools/vite-dom-free/index.mjs';
import { i18nCatalogs } from './tools/vite-lingui/catalogs.mjs';
import { lingui } from './tools/vite-lingui/index.mjs';
import { DurationsReporter } from './tools/vitest/durations-reporter.mjs';
import { isolatedFiles } from './tools/vitest/isolation.mjs';
import { ProgressReporter } from './tools/vitest/progress-reporter.mjs';

interface Workspace {
  dir: string;
  runtime: string;
  layer: string;
}
const { workspaces } = JSON.parse(readFileSync(new URL('./tools/gen/workspaces.json', import.meta.url), 'utf8')) as { workspaces: Workspace[] };

// testing.md §6: pure packages and packs 90/85, render + player 80/75, editor 70/65; the rest have no floor yet
const floorFor = (w: Workspace): { lines: number; branches: number } | undefined => {
  // packs are definitions (data) and small helpers: held to the pure floors (M5 cp1 F4)
  if (w.runtime === 'pure' || w.layer === 'Pack') return { lines: t('COVERAGE_PURE_LINES'), branches: t('COVERAGE_PURE_BRANCHES') };
  if (w.dir === 'packages/render' || w.dir === 'packages/player') return { lines: t('COVERAGE_RENDER_LINES'), branches: t('COVERAGE_RENDER_BRANCHES') };
  if (w.dir === 'packages/editor') return { lines: t('COVERAGE_EDITOR_LINES'), branches: t('COVERAGE_EDITOR_BRANCHES') };
  return undefined;
};
const floors = Object.fromEntries(
  workspaces.flatMap((w) => {
    const floor = floorFor(w);
    return floor ? [[`${w.dir}/src/**`, floor]] : [];
  }),
);

const SRC = '{packages,packs,apps}/*/src/**';
// ADR-0218 (M18.290): node files that mock modules, stub globals or env, fake timers or spy on process-wide objects
const ISOLATED = isolatedFiles(fileURLToPath(new URL('.', import.meta.url)));
// fast-check seed used in CI (tools/vitest/fast-check.setup.ts); FC_SEED overrides it
const CI_SEED = 20_260_926;
// fast-check runs per property, as the nightly sets it (FC_RUNS); 200, fast-check.setup.ts's default, when unset or not a number
const fcRuns = Number.isFinite(Number(process.env.FC_RUNS || 'x')) ? Number(process.env.FC_RUNS) : 200;
// workspace sources resolve to src/, never to a stale dist/ (ADR-0011)
const conditions = ['@fluxion/source', 'module', 'development|production'];

export default defineConfig({
  plugins: [lingui({ catalogs: i18nCatalogs })],
  // per checkout, not node_modules/.vite: harness sandboxes link the repo's node_modules, and a
  // shared cache would be written by the sandbox and the ladder's test step at once (M1.36).
  // FLUXION_VITEST_CACHE moves it: a tzap run in this checkout (pnpm mutate, also from the harness
  // suite during the ladder) must not rewrite the optimized deps a browser run is serving (M5.29)
  cacheDir: process.env['FLUXION_VITEST_CACHE'] ?? '.vitest-cache',
  resolve: { conditions: [...conditions, 'browser'], alias: domFreeAliases },
  ssr: { resolve: { conditions: [...conditions, 'node'] } },
  test: {
    // the 5 s default is a laptop's: a macOS or Windows runner under coverage takes several times a laptop's time, and a test over the
    // limit there is a red main without a bug (M10.11: four CI runs lost to it). A genuine hang still fails, at 20 s.
    // the nightly's FC_RUNS (10 000) runs each property 50 times the default 200, so the limit grows with it, to 3 min at most: three times
    // the slowest property there (nightly 39387799270: 45 and 63 s against 20), and a hang still fails well inside the job's 30 min
    testTimeout: Math.min(20_000 * Math.max(1, fcRuns / 200), 180_000),
    hookTimeout: 20_000,
    // M18.222: CI's verify job names a per-OS file; scripts/harness/test-headroom.mjs lists tests over half their timeout.
    // M18.283: there each file's start and end is logged too, for the ladder's idle watchdog
    ...(process.env['FLUXION_TEST_DURATIONS']
      ? { reporters: ['default', ...(process.env['GITHUB_ACTIONS'] ? ['github-actions'] : []), new DurationsReporter(), new ProgressReporter()] }
      : {}),
    setupFiles: ['./tools/vitest/fast-check.setup.ts', './tools/vitest/i18n.setup.ts'],
    env: { FC_SEED: process.env.FC_SEED ?? (process.env.CI ? String(CI_SEED) : ''), FC_RUNS: process.env.FC_RUNS ?? '' },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          // Native browser-owning E2E files share this project; select node files with --project 'node*' (node + node-isolated, ADR-0218).
          ...(process.platform === 'win32' ? { fileParallelism: false } : {}),
          // the node project first, then the browser one: Chromium never runs beside node's bounded-time tests (M18.117)
          sequence: { groupOrder: 0 },
          environment: 'node',
          include: [`${SRC}/*.test.{ts,tsx}`, 'scripts/examples/*.test.ts'],
          exclude: [`${SRC}/*.browser.test.{ts,tsx}`, ...ISOLATED],
          // ADR-0218: files in one worker share the module registry, so a file's imports load once per worker, not once per file
          // (39 % of the project's time); the files that change process-wide state run in node-isolated. Select both as `node*`.
          // Mutation runs (scripts/harness/mutate.mjs sets FLUXION_TEST_ISOLATE) keep one registry per file, so a mutant's
          // per-test coverage and verdicts are read as before
          isolate: process.env['FLUXION_TEST_ISOLATE'] === '1',
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          // Keep RAF-driven UI files from competing for browser pages during the full ladder
          // (M18.44: macOS CI timed out under the unchanged 20 s limit). Windows also separates projects.
          // Linux too: run beside the node project (M18.117) they starved its bounded-time tests, so main
          // went red twice. So the browser project runs after the node one (groupOrder 1), and on Linux
          // three files at once: it waits more than it computes, 143 s one at a time against 71 s three wide
          // on 4 cores, every test passing (M18.157 diagnosis). macOS and Windows stay one at a time.
          ...(process.platform === 'linux' ? { fileParallelism: true, maxWorkers: 3 } : { fileParallelism: false }),
          sequence: { groupOrder: 1 },
          include: [`${SRC}/*.browser.test.{ts,tsx}`],
          browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
        },
      },
      {
        extends: true,
        test: {
          name: 'node-isolated',
          ...(process.platform === 'win32' ? { fileParallelism: false } : {}),
          sequence: { groupOrder: 0 },
          environment: 'node',
          include: ISOLATED,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: [`${SRC}/*.{ts,tsx}`],
      exclude: ['**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}', '**/*.d.ts', '**/__fixtures__/**'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: floors,
    },
  },
});
