// Staged-mode scope of the two slowest ladder steps (M4 cp1 F2, NFR-DX-002): the harness tests and
// the Vitest run. A staged commit runs what its staged paths can affect; `pnpm verify` (--all), CI and
// every completion gate still run everything, so nothing goes unchecked before a milestone closes.
// Pure functions over repo-relative paths, so tests/harness/ladder-scope.test.mjs can pin them.
import { BOOKKEEPING_PATHS } from './milestone-checks.mjs';

/** Package, pack and app sources, tests and benches: what a code row changes. */
const SOURCE = /^(packages|packs|apps)\/[^/]+\/(src|bench)\//;

/**
 * Harness test files that read the repo's own package sources or reports (the write-path and
 * kind-switch scans, the docs-to-API and diagnostics-to-docs checks, the open-object scan of the schema,
 * the bench folder, the mode-policy scan of render, the workspace shape, and the coverage floors over every workspace's real sources,
 * which no other staged step judges on node tests alone): run for a sources-only commit.
 * tests/harness/ladder-scope.test pins that every harness file reading package paths is here or in
 * SAMPLE_HARNESS (M4.26 review F1, round 2 F1-F2).
 */
export const SOURCE_HARNESS = [
  'architecture',
  'bench-leg',
  'coverage',
  'diagnostics-doc',
  'docs-consistency',
  'kind-switch',
  'mode-policy',
  'schema-open-objects',
  'workspace-shape',
];

/**
 * Harness files that read workspaces but need no rerun for a sources-only commit, each for a stated
 * reason: they copy a package only as sample material for a gate script whose real-repo run is a step
 * of the same staged ladder (api → typecheck/api, packages → publint/attw, ladder, layering →
 * layering, mutate → the Vitest step), or they read only non-source files (package.json, adapter
 * configs, licences) whose change is not a source path and so runs the whole harness (adapters,
 * licenses, turbo). --all runs them all.
 */
export const SAMPLE_HARNESS = ['adapters', 'api', 'ladder', 'layering', 'licenses', 'mutate', 'packages', 'turbo'];

/**
 * The harness test files to run for `staged` (repo-relative paths) out of `all`: every file when a
 * staged path is neither a source nor bookkeeping; the SOURCE_HARNESS files when sources are staged;
 * none for a bookkeeping-only commit.
 */
export function harnessFiles(staged, all) {
  const bookkeeping = (p) => BOOKKEEPING_PATHS.some((re) => re.test(p));
  if (staged.some((p) => !SOURCE.test(p) && !bookkeeping(p))) return all;
  if (!staged.some((p) => SOURCE.test(p))) return [];
  return all.filter((f) => SOURCE_HARNESS.some((name) => f.endsWith(`/${name}.test.mjs`)));
}

/** Paths the Vitest run reads beyond the workspaces: its config, setup, fixtures, floors, toolchain. */
const VITEST_GLOBAL =
  /^(vitest\.config\.ts|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json|scripts\/gates\/thresholds\.mjs|tools\/vitest\/|fixtures\/)/;
const WORKSPACE = /^((?:packages|packs|apps)\/[^/]+)\//;

/** `dirs` plus every workspace they depend on, transitively (dependsOn names are workspace basenames). */
function withDependencies(dirs, workspaces) {
  const byName = new Map(workspaces.map((w) => [w.dir.split('/').pop(), w]));
  const out = new Set();
  const visit = (dir) => {
    if (out.has(dir)) return;
    out.add(dir);
    const w = workspaces.find((x) => x.dir === dir);
    for (const dep of w?.dependsOn ?? []) if (byName.has(dep)) visit(byName.get(dep).dir);
  };
  for (const d of dirs) visit(d);
  return out;
}

/**
 * What the staged test step runs: `run` false when no staged path is read by Vitest (skip); `browser`
 * true when a staged path is a browser-tested workspace, one of its dependencies, or a global Vitest
 * input; otherwise only the node project runs, and `include` limits coverage to the workspaces
 * without browser tests, so the browser packages' floors are never judged on node tests alone.
 */
export function testScope(staged, workspaces, browserTested) {
  const workspaceOf = (p) => WORKSPACE.exec(p)?.[1];
  const run = staged.some(
    (p) => VITEST_GLOBAL.test(p) || /^examples\//.test(p) || (workspaceOf(p) !== undefined && workspaces.some((w) => w.dir === workspaceOf(p))),
  );
  if (!run) return { run: false, browser: false };
  const affectsBrowser = withDependencies(browserTested, workspaces);
  const browser = staged.some((p) => VITEST_GLOBAL.test(p) || affectsBrowser.has(workspaceOf(p)));
  if (browser) return { run: true, browser: true };
  // the same file pattern as vitest.config.ts's coverage include, narrowed to these workspaces (review F2)
  const include = workspaces.filter((w) => !browserTested.includes(w.dir)).map((w) => `${w.dir}/src/**/*.{ts,tsx}`);
  return { run: true, browser: false, include };
}
