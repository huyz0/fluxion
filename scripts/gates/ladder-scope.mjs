// Staged-mode scope of the two slowest ladder steps (M4 cp1 F2, NFR-DX-002): the harness tests and
// the Vitest run. A staged commit runs what its staged paths can affect; `pnpm verify` (--all), CI and
// every completion gate still run everything, so nothing goes unchecked before a milestone closes.
// Pure functions over repo-relative paths, so tests/harness/ladder-scope.test.mjs can pin them.
import { readFileSync } from 'node:fs';
import { repoPath } from './lib.mjs';
import { BOOKKEEPING_PATHS } from './milestone-checks.mjs';

/** Package, pack and app sources, tests and benches, and the generated `--json` schemas a test snapshots: what a code row changes. */
const SOURCE = /^(packages|packs|apps)\/[^/]+\/(src|bench|schemas)\//;

/**
 * Harness test files that read the repo's own package sources or reports (the write-path and
 * kind-switch scans, the docs-to-API and diagnostics-to-docs checks, the open-object scan of the schema,
 * the bench folder, the mode-policy scan of render, the workspace shape): run for a sources-only commit.
 * The coverage floors over every workspace's real sources (tests/harness/coverage, a full test:coverage run in
 * a sandbox, ~100 s on 4 cores) are in SAMPLE_HARNESS: the staged Vitest step judges the touched workspaces' floors,
 * and CI's --all ladder runs the whole-repo run (NFR-DX-002, ci-cd.md §5).
 * tests/harness/ladder-scope.test pins that every harness file reading package paths is here or in
 * SAMPLE_HARNESS (M4.26 review F1, round 2 F1-F2).
 */
export const SOURCE_HARNESS = [
  'architecture',
  'bench-leg',
  'diagnostics-doc',
  'docs-consistency',
  'google-fonts',
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
export const SAMPLE_HARNESS = ['adapters', 'api', 'coverage', 'ladder', 'layering', 'licenses', 'mutate', 'packages', 'turbo'];

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
  'coverage',
  'layering',
  'licenses',
  'milestone-checks',
  'packages',
  'test-titles',
  'turbo',
  'verify-leg',
];

/**
 * The manifest harness a staged commit runs: MANIFEST_HARNESS without the files whose real-repo run is a step of the same staged
 * ladder or CI's (coverage: the staged Vitest step judges the touched workspaces' floors and --all runs the whole-repo run;
 * layering and licenses: the `layering` and `licenses` steps run the gate scripts on the real repo). A commit that adds a workspace
 * went over the 120 s budget on a 4-core machine with them (about 220 s, M9.8); --all and CI run every file (NFR-DX-002).
 */
const STAGED_SKIPPED = ['coverage', 'layering', 'licenses'];
export const STAGED_MANIFEST_HARNESS = MANIFEST_HARNESS.filter((n) => !STAGED_SKIPPED.includes(n));

/**
 * Harness files for a staged doc, e2e spec or gate script that is not a source: the files that read exactly that
 * (docs: the docs-to-API and diagnostics checks and the matrix; e2e: the matrix and the workspace shape, whose
 * sandboxes copy e2e/; a gate script: the tests of that script and of the ladder that runs it). Anything else
 * still runs every file; `--all` (CI) always does (NFR-DX-002, ci-cd.md §5).
 */
export const DOCS_HARNESS = ['architecture', 'diagnostics-doc', 'docs-consistency', 'trace'];
export const E2E_HARNESS = ['trace', 'workspace-shape'];
const LADDER_HARNESS = ['adapters', 'budget', 'ci-workflow', 'docs-consistency', 'ladder', 'ladder-scope', 'review', 'workspace-shape'];
export const GATE_SCRIPT_HARNESS = {
  'scripts/gates/milestone-checks.mjs': ['bench-leg', 'kits', 'ladder-scope', 'milestone-checks', 'verify-leg'],
  'scripts/gates/ladder-scope.mjs': LADDER_HARNESS,
  'scripts/gates/precommit.mjs': LADDER_HARNESS,
  // the budget record and the worst-case commit it times (M8.20): the budget harness file reads both, the scope tests read the commit
  'scripts/gates/check-budget.mjs': ['budget', 'ladder-scope'],
  'scripts/gates/worst-case.mjs': ['budget', 'ladder-scope'],
};

/**
 * Other paths, each with the harness files that name it: changesets (the CI workflow and milestone checks read
 * `.changeset`), the docs generators and milestone completion gates (run by their own legs, scanned for portability),
 * the guides of apps/docs (the architecture and workspace-shape tests read that app) and the AGENTS.md notes
 * (the index, portability and size checks read them).
 */
export const NAMED_PATH_HARNESS = [
  [/^\.changeset\/.+\.md$/, ['ci-workflow', 'milestone-checks']],
  // the shared documents: the harness files that name them (the Vitest suites that read them run through VITEST_GLOBAL)
  [/^(examples|fixtures)\/.+\.(json|md)$/, ['milestone-checks', 'tests-kept']],
  [/^scripts\/(docs|fonts|format|fixtures)\/[^/]+\.m?js$/, ['milestone-checks', 'portability', 'size']],
  // a pack's vendored font files, manifest and licence text: data that only the ladder's `licenses` step reads (hashes, licences, paths)
  [/^packs\/[^/]+\/(fonts\/[^/]+|fonts\.json|metrics\.json|catalog\.json|OFL\.txt)$/, []],
  // a package's own test fixtures: read only by that package's tests, which the staged Vitest step runs (the package is staged)
  [/^(packages|packs|apps)\/[^/]+\/__fixtures__\/.+/, []],
  // the bundle budgets: read by the ladder's own `size-limit` step, which the staged ladder runs; no harness file reads them
  [/^\.size-limit\.js$/, []],
  // the Vitest config: the staged Vitest step runs the whole suite for it (VITEST_GLOBAL) and judges the real coverage floors; the scope test names it
  [/^vitest\.config\.ts$/, ['ladder-scope']],
  // the security corpus: hostile inputs read only by Vitest tests (the sanitizer's, in format and editor), which the staged Vitest step runs
  // for any change under specs/security/ (VITEST_GLOBAL), so no harness file needs to
  [/^specs\/security\/corpus\/.+/, []],
  [/^scripts\/gates\/m\d+-complete\.mjs$/, ['milestone-checks', 'portability']],
  [/^apps\/docs\/src\/content\/docs\/guides\/[^/]+\.mdx?$/, ['architecture', 'workspace-shape']],
  [/^knip\.json$/, ['milestone-checks']],
  // the formatter's config: the formatter's own tests and the workspace shape (which reads it)
  [/^biome\.json$/, ['biome', 'workspace-shape']],
  // the scanner's list of accepted advisories: read by the security workflow alone
  [/^osv-scanner\.toml$/, []],
  // a workflow: the tests that read the workflows (pins, permissions, triggers)
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, ['ci-workflow']],
  // the harness files that read the limits; the whole-repo coverage run (also reading them) is CI's, as for sources
  [/^scripts\/gates\/thresholds\.mjs$/, ['biome', 'budget', 'drift', 'ladder-scope', 'licenses', 'portability', 'size']],
  // the licence and drift gates: their own tests (a sandbox copy of scripts/ serves the rest)
  [/^scripts\/gates\/check-licenses\.mjs$/, ['licenses']],
  // the API gate: its own tests (a sandbox copy of scripts/ serves the rest)
  [/^scripts\/gates\/check-api\.mjs$/, ['api']],
  [/^scripts\/gates\/check-drift\.mjs$/, ['drift']],
  [/(^|\/)AGENTS\.md$/, ['build-index', 'portability', 'size', 'workspace-shape']],
];

/** A workspace's manifest. */
const MANIFEST = /^(packages|packs|apps)\/[^/]+\/package\.json$/;
/**
 * What `tools/gen/package.mjs` writes beside a manifest, and the files that list the workspaces: a workspace's build settings,
 * licence and readme, the workspace list, the root tsconfig. They are read by the manifest harness and by the tests of the
 * formatter and the strict tsconfig.
 */
const WORKSPACE_FILES = /^((packages|packs|apps)\/[^/]+\/(tsconfig\.json|tsdown\.config\.ts|LICENSE|README\.md)|tools\/gen\/workspaces\.json|tsconfig\.json)$/;
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
  const needs = staged.map((p) => harnessFor(p, workspaceLock && staged.some((q) => MANIFEST.test(q)), all));
  if (needs.includes(null)) return all;
  const names = new Set(needs.flat());
  return all.filter((f) => [...names].some((name) => f.endsWith(`/${name}.test.mjs`)));
}

/** The names of the harness files in `all` whose text contains `path`. */
function naming(path, all) {
  return all
    .filter((f) => {
      try {
        return readFileSync(repoPath(f), 'utf8').includes(path);
      } catch {
        return false;
      }
    })
    .map((f) => f.replace(/^.*\/(.+)\.test\.mjs$/, '$1'));
}

/** The harness files one staged path needs, or null for every file. */
function harnessFor(p, workspaceLock, all = []) {
  if (BOOKKEEPING_PATHS.some((re) => re.test(p))) return [];
  if (SOURCE.test(p) || API_REPORT.test(p)) return SOURCE_HARNESS;
  if (MANIFEST.test(p) || (p === 'pnpm-lock.yaml' && workspaceLock)) return STAGED_MANIFEST_HARNESS;
  if (WORKSPACE_FILES.test(p)) return [...STAGED_MANIFEST_HARNESS, 'biome', 'tsconfig-strict'];
  if (p === TRACE_MATRIX) return ['trace'];
  if (/^e2e\//.test(p)) return E2E_HARNESS;
  // a doc: the docs files, and every harness file that names this very path (its real copy is read)
  // (not the files whose real-repo run is a ladder step or CI's: coverage, layering, licenses; M9.26)
  if (/^docs\/.+\.md$/.test(p)) return [...DOCS_HARNESS, ...naming(p, all).filter((n) => !STAGED_SKIPPED.includes(n))];
  // a harness test file reruns itself; a shared helper (anything else under tests/harness) runs every file
  const own = /^tests\/harness\/([^/]+)\.test\.mjs$/.exec(p);
  if (own) return [own[1]];
  return GATE_SCRIPT_HARNESS[p] ?? NAMED_PATH_HARNESS.find(([re]) => re.test(p))?.[1] ?? null;
}

/** Paths the Vitest run reads beyond the workspaces: its config, setup, fixtures, floors, toolchain. */
const VITEST_GLOBAL =
  /^(vitest\.config\.ts|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json|scripts\/gates\/thresholds\.mjs|tools\/vitest\/|fixtures\/|specs\/security\/)/;
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

/**
 * Whether the packaging checks (publint, attw: a package's manifest, exports and built types) can be affected:
 * false when every staged path is a source, an API report, an e2e spec, a doc, milestone-checks.mjs or bookkeeping, none of which
 * changes a manifest or a build setting. A private app's manifest and tsconfig, a workspace-only lockfile change (`lockfileWorkspaceOnly`) and a
 * workspace list whose publishable libraries are unchanged (`librariesUnchanged`) are inert too. CI's `--all` ladder always runs them (NFR-DX-002, ci-cd.md §5).
 */
export function packagingNeeded(staged, { lockfileWorkspaceOnly: workspaceLock = false, librariesUnchanged = false } = {}) {
  // milestone-checks.mjs judges milestone legs and rows; it reads no manifest, export or build setting
  const inert = (p) =>
    p === 'scripts/gates/milestone-checks.mjs' ||
    // the fixture generator reads documents, not a manifest, an export or a build setting
    p === 'scripts/fixtures/gen.mjs' ||
    // the scope module itself and the harness tests decide and test which checks run, and pack nothing (CI's `--all` ladder is the backstop for a scope change that hides a packaging check)
    p === 'scripts/gates/ladder-scope.mjs' ||
    /^tests\/harness\/[^/]+\.test\.mjs$/.test(p) ||
    p === 'knip.json' ||
    p === 'osv-scanner.toml' ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) ||
    p === 'scripts/gates/thresholds.mjs' ||
    SOURCE.test(p) ||
    API_REPORT.test(p) ||
    /^e2e\//.test(p) ||
    /^docs\/.+\.md$/.test(p) ||
    // notes and documents no manifest, export or build setting reads
    /^\.changeset\/.+\.md$/.test(p) ||
    /^(examples|fixtures)\//.test(p) ||
    /(^|\/)AGENTS\.md$/.test(p) ||
    /^apps\/docs\/src\/content\//.test(p) ||
    BOOKKEEPING_PATHS.some((re) => re.test(p)) ||
    // the checks pack the publishable libraries (packages/* and packs/*) only: a private app's manifest and tsconfig are not packed; a lockfile that
    // changes workspace links alone adds no package to any library; a workspace list with the same libraries checks the same ones
    /^apps\/[^/]+\/(package|tsconfig)\.json$/.test(p) ||
    (p === 'pnpm-lock.yaml' && workspaceLock) ||
    (p === 'tools/gen/workspaces.json' && librariesUnchanged);
  return !staged.every(inert);
}
