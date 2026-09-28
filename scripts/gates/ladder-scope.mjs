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
 * configs, licences): a manifest change runs them through MANIFEST_HARNESS, any other non-source
 * path runs the whole harness (adapters, licenses, turbo). --all runs them all.
 */
export const SAMPLE_HARNESS = ['adapters', 'api', 'ladder', 'layering', 'licenses', 'mutate', 'packages', 'turbo'];

/**
 * Harness files that read a workspace manifest or the lockfile of the real repo (every harness file
 * naming package.json, pnpm-lock or pnpm-workspace, pinned by tests/harness/ladder-scope.test), plus
 * the source harness: run for a commit that changes a workspace's package.json, or a lockfile whose
 * external packages are unchanged (M4.29).
 */
export const MANIFEST_HARNESS = [
  ...SOURCE_HARNESS,
  'adapters',
  'budget',
  'ci-workflow',
  'layering',
  'licenses',
  'packages',
  'test-titles',
  'turbo',
  'verify-leg',
];

/** A workspace's manifest. */
const MANIFEST = /^(packages|packs|apps)\/[^/]+\/package\.json$/;
/** A workspace's API report: written by check-api --update and checked by the ladder's api step. */
const API_REPORT = /^(packages|packs|apps)\/[^/]+\/api\/[^/]+\.api\.md$/;
/** The traceability matrix, generated from the tests by check-trace --write. */
const TRACE_MATRIX = 'docs/requirements/40-traceability.md';

// the importers section runs from its key to the next top-level key
const IMPORTERS = /^importers:\n(?:[ \t][^\n]*\n|\n)*/m;

/**
 * The external dependencies the importers section resolves, as sorted `importer name version` lines:
 * workspace links (`version: link:…`) and the dependency kind are left out, so adding a workspace
 * link or moving a dependency between kinds does not change the list, while any external version an
 * importer resolves to does (M4.29 review F1).
 */
function externalImports(section) {
  const out = [];
  let importer = '';
  let name = '';
  for (const line of section.split('\n')) {
    const m = /^( *)(.*?):?\s*$/.exec(line);
    const indent = m?.[1].length ?? 0;
    const text = (m?.[2] ?? '').replace(/^'|'$/g, '');
    if (indent === 2) importer = text;
    else if (indent === 6) name = text;
    else if (indent === 8 && text.startsWith('version: ') && !text.startsWith('version: link:')) out.push(`${importer} ${name} ${text}`);
  }
  return out.sort().join('\n');
}

/**
 * True when two pnpm lockfiles differ only in workspace links: every external package, version,
 * catalog and setting is byte-identical outside the `importers:` section, and inside it every
 * importer resolves the same external dependencies to the same versions (`externalImports`).
 */
export function lockfileWorkspaceOnly(before, after) {
  const [b, a] = [before, after].map((text) => text.replace(/\r\n/g, '\n'));
  const section = (text) => IMPORTERS.exec(text)?.[0] ?? '';
  return b.replace(IMPORTERS, '') === a.replace(IMPORTERS, '') && externalImports(section(b)) === externalImports(section(a));
}

/**
 * The harness test files to run for `staged` (repo-relative paths) out of `all`, in `all`'s order:
 * the SOURCE_HARNESS files for sources and API reports, the MANIFEST_HARNESS files for workspace
 * manifests and a workspace-only lockfile change staged with a manifest (`lockfileWorkspaceOnly`), `trace` for the
 * traceability matrix, nothing for bookkeeping, and every file for any other path.
 */
export function harnessFiles(staged, all, { lockfileWorkspaceOnly: workspaceLock = false } = {}) {
  const needs = staged.map((p) => harnessFor(p, workspaceLock && staged.some((q) => MANIFEST.test(q))));
  if (needs.includes(null)) return all;
  const names = new Set(needs.flat());
  return all.filter((f) => [...names].some((name) => f.endsWith(`/${name}.test.mjs`)));
}

/** The harness files one staged path needs, or null for every file. */
function harnessFor(p, workspaceLock) {
  if (BOOKKEEPING_PATHS.some((re) => re.test(p))) return [];
  if (SOURCE.test(p) || API_REPORT.test(p)) return SOURCE_HARNESS;
  if (MANIFEST.test(p) || (p === 'pnpm-lock.yaml' && workspaceLock)) return MANIFEST_HARNESS;
  if (p === TRACE_MATRIX) return ['trace'];
  return null;
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
export function testScope(stagedPaths, workspaces, browserTested, { lockfileWorkspaceOnly: workspaceLock = false } = {}) {
  // a workspace-only lockfile change is the staged manifests' change, scoped by their workspaces
  const staged = workspaceLock && stagedPaths.some((p) => MANIFEST.test(p)) ? stagedPaths.filter((p) => p !== 'pnpm-lock.yaml') : stagedPaths;
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
