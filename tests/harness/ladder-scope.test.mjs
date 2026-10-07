// NFR-DX-002 (M4 cp1 F2, F3, F8): the staged ladder runs what the staged paths can affect; the gates
// batch their titled Vitest runs; the demo check reads the rendered content, not only its screens.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  apiScope,
  DOCS_HARNESS,
  E2E_HARNESS,
  GATE_SCRIPT_HARNESS,
  harnessFiles,
  licensesNeeded,
  lockfileLockedOnly,
  lockfileWorkspaceOnly,
  MANIFEST_HARNESS,
  NAMED_PATH_HARNESS,
  packagingDirs,
  packagingNeeded,
  SAMPLE_HARNESS,
  SOURCE_HARNESS,
  testScope,
  workspaceCatalogOnly,
} from '../../scripts/gates/ladder-scope.mjs';
import { checkDemoHtml, titled } from '../../scripts/gates/milestone-checks.mjs';
import { REPO } from './helpers.mjs';

const workspaces = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8')).workspaces;
const BROWSER = ['packages/render', 'packages/editor'];
const file = (n) => `tests/harness/${n}.test.mjs`;
const ALL = [...new Set(['api', 'drift', 'trace', ...MANIFEST_HARNESS])].map(file);

describe('staged ladder scope (NFR-DX-002)', () => {
  it('a staged change outside the browser packages runs no browser tests', () => {
    // cli is no dependency of render or editor: the node project only, coverage without the browser packages
    const cli = testScope(['packages/cli/src/main.ts', 'docs/backlog/current.md'], workspaces, BROWSER);
    assert.equal(cli.run, true);
    assert.equal(cli.browser, false);
    assert.ok(cli.include.includes('packages/cli/src/**/*.{ts,tsx}'));
    assert.ok(cli.include.includes('packages/core/src/**/*.{ts,tsx}'));
    assert.ok(!cli.include.some((g) => g.startsWith('packages/render/') || g.startsWith('packages/editor/')));
    // core is a dependency of render: the browser project runs
    assert.deepEqual(testScope(['packages/core/src/store.ts'], workspaces, BROWSER), { run: true, browser: true });
    assert.deepEqual(testScope(['packages/render/src/x.tsx'], workspaces, BROWSER), { run: true, browser: true });
    // an API report is read by no Vitest test: it does not start the Vitest step, while a source next to it does
    assert.deepEqual(testScope(['packages/core/api/core.testing.api.md'], workspaces, BROWSER), { run: false, browser: false });
    assert.equal(testScope(['packages/core/api/core.testing.api.md', 'packages/core/src/store.ts'], workspaces, BROWSER).run, true);
    // a workspace's README, AGENTS.md and licence are read by no Vitest test either: a notes-only change runs none, with a source it does
    assert.deepEqual(testScope(['packages/render/README.md', 'packages/render/AGENTS.md', 'packages/render/LICENSE'], workspaces, BROWSER), {
      run: false,
      browser: false,
    });
    assert.equal(testScope(['packages/render/README.md', 'packages/render/src/x.tsx'], workspaces, BROWSER).browser, true);
    // global Vitest inputs run everything
    for (const p of [
      'vitest.config.ts',
      'pnpm-lock.yaml',
      'fixtures/docs/minimal.flux.json',
      'scripts/gates/thresholds.mjs',
      'specs/security/corpus/svg-x.svg',
    ])
      assert.deepEqual(testScope([p], workspaces, BROWSER), { run: true, browser: true }, p);
    // nothing Vitest reads: no run
    assert.deepEqual(testScope(['docs/architecture/04-rendering-and-editor.md', 'scripts/gates/m4-complete.mjs'], workspaces, BROWSER), {
      run: false,
      browser: false,
    });
    // the demo is read by the CLI tests (node)
    assert.equal(testScope(['examples/r0-static.flux.json'], workspaces, BROWSER).browser, false);
  });

  it('a source-only commit runs the source harness files; any other path runs them all', () => {
    const sources = harnessFiles(['packages/render/src/view.tsx', '.harness/progress.md', 'docs/backlog/current.md'], ALL);
    assert.deepEqual(
      sources,
      SOURCE_HARNESS.map((n) => `tests/harness/${n}.test.mjs`),
    );
    assert.deepEqual(harnessFiles(['packages/core/src/x.ts', 'scripts/gates/lib.mjs'], ALL), ALL);
    assert.deepEqual(harnessFiles(['scripts/gates/lib.mjs'], ALL), ALL);
    // an API report is checked against dist by the ladder's api step: the source harness (M4.29)
    assert.deepEqual(harnessFiles(['packages/core/api/core.api.md'], ALL), SOURCE_HARNESS.map(file));
    // bookkeeping only: nothing the harness reads changed
    assert.deepEqual(harnessFiles(['.harness/state.json', 'docs/backlog/current.md', 'docs/milestones/M4.md'], ALL), []);
  });

  it('NFR-DX-002: a doc, an e2e spec or a gate script runs the files that read it, not every file', () => {
    const only = (names) => ALL.filter((f) => names.some((n) => f.endsWith(`/${n}.test.mjs`)));
    // literal names, not the exported constants: widening a constant must fail here (M7 final F7)
    assert.deepEqual(harnessFiles(['docs/standards/ci-cd.md'], ALL), only(['architecture', 'diagnostics-doc', 'docs-consistency', 'trace']));
    // a doc some harness file reads by name also runs that file (F1, F2 of the M7.32 review)
    assert.deepEqual(harnessFiles(['docs/harness/dry-runs.md'], ALL), only(['architecture', 'diagnostics-doc', 'docs-consistency', 'trace', 'kits']));
    assert.deepEqual(
      harnessFiles(['docs/architecture/01-overview.md'], ALL),
      // the layering run over the real repo is the ladder's `layering` step, not this list's
      only(['architecture', 'diagnostics-doc', 'docs-consistency', 'trace', 'workspace-shape']),
    );
    assert.deepEqual(harnessFiles(['e2e/x.spec.ts'], ALL), only(['trace', 'workspace-shape']));
    // the package hygiene gate's own tests, not the whole harness (M10.54)
    assert.deepEqual(harnessFiles(['scripts/gates/check-packages.mjs'], ALL), only(['packages']));
    // the API gate's own tests, not the whole harness (M10.29)
    assert.deepEqual(harnessFiles(['scripts/gates/check-api.mjs'], ALL), only(['api']));
    assert.deepEqual(harnessFiles(['scripts/gates/milestone-checks.mjs'], ALL), only(['bench-leg', 'kits', 'ladder-scope', 'milestone-checks', 'verify-leg']));
    for (const [path, names] of Object.entries(GATE_SCRIPT_HARNESS)) assert.deepEqual(harnessFiles([path], ALL), only(names), path);
    assert.deepEqual(harnessFiles(['tests/harness/drift.test.mjs'], ALL), only(['drift']));
    assert.deepEqual(harnessFiles(['tests/harness/helpers.mjs'], ALL), ALL);
    for (const [, names] of NAMED_PATH_HARNESS) for (const n of names) assert.ok(readdirSync(join(REPO, 'tests/harness')).includes(`${n}.test.mjs`), n);
    assert.deepEqual(
      harnessFiles(['.changeset/m7-core.md', 'scripts/docs/keyboard-shortcuts.mjs', 'packages/editor/AGENTS.md'], ALL),
      only(['ci-workflow', 'milestone-checks', 'portability', 'size', 'build-index', 'workspace-shape']),
    );
    assert.deepEqual(harnessFiles(['scripts/gates/m7-complete.mjs'], ALL), only(['milestone-checks', 'portability']));
    assert.deepEqual(harnessFiles(['knip.json'], ALL), only(['milestone-checks']));
    assert.deepEqual(harnessFiles(['biome.json'], ALL), only(['biome', 'workspace-shape']));
    assert.deepEqual(harnessFiles(['scripts/gates/check-licenses.mjs'], ALL), only(['licenses']));
    assert.deepEqual(harnessFiles(['scripts/gates/check-drift.mjs'], ALL), only(['drift']));
    // what a new workspace adds beside its manifest runs the manifest harness and the formatter and tsconfig tests, not every file
    const workspaceFiles = only([
      'adapters',
      'biome',
      'budget',
      'ci-workflow',
      'docs-consistency',
      'architecture',
      'bench-leg',
      'diagnostics-doc',
      'format-spec',
      'google-fonts',
      'kind-switch',
      'milestone-checks',
      'mode-policy',
      'packages',
      'schema-open-objects',
      'test-titles',
      'tsconfig-strict',
      'turbo',
      'verify-leg',
      'workspace-shape',
    ]);
    for (const p of ['packs/x/tsconfig.json', 'packs/x/tsdown.config.ts', 'packs/x/LICENSE', 'packs/x/README.md', 'tools/gen/workspaces.json', 'tsconfig.json'])
      assert.deepEqual(harnessFiles([p], ALL), workspaceFiles, p);
    // vendored fonts and their manifest are read by the licenses step alone; the vendor script is scanned like the docs scripts
    assert.deepEqual(
      harnessFiles(
        [
          'packs/fonts-core/fonts/x.woff2',
          'packs/fonts-core/fonts.json',
          'packs/fonts-core/metrics.json',
          'packs/fonts-core/catalog.json',
          'packs/fonts-core/OFL.txt',
        ],
        ALL,
      ),
      [],
    );
    // the bundle budgets are read by the ladder's size-limit step alone
    assert.deepEqual(harnessFiles(['.size-limit.js'], ALL), []);
    // the ignore list is read by git alone, the Lighthouse config by the milestone checks, the CI evidence gate by its own tests
    assert.deepEqual(harnessFiles(['.gitignore'], ALL), []);
    assert.deepEqual(harnessFiles(['lighthouserc.mjs'], ALL), only(['milestone-checks']));
    assert.deepEqual(harnessFiles(['scripts/gates/check-ci-evidence.mjs'], ALL), only(['ci-evidence']));
    // the nightly's previous-Playwright script has its own tests and the workflow tests
    const withScript = [...ALL, file('previous-playwright')];
    assert.deepEqual(
      harnessFiles(['scripts/ci/previous-playwright.mjs'], withScript),
      withScript.filter((f) => ['previous-playwright', 'ci-workflow'].some((n) => f.endsWith(`/${n}.test.mjs`))),
    );
    assert.ok(harnessFiles(['scripts/ci/previous-playwright.mjs'], withScript).includes(file('previous-playwright')));
    // the R1 demo file is read by its e2e spec, its generator by the milestone checks and the portability scan
    assert.deepEqual(harnessFiles(['examples/r1-mvp-deck.flux.html'], ALL), []);
    assert.deepEqual(harnessFiles(['scripts/examples/make-r1-demo.mjs'], ALL), only(['milestone-checks', 'portability', 'size']));
    // the format specification is read by the docs checks alone
    assert.deepEqual(harnessFiles(['specs/format/flux-1.0.md'], ALL), only(['docs-consistency', 'format-spec']));
    // an app's page and static files are built by the Vite build step, which the ladder runs
    assert.deepEqual(harnessFiles(['apps/studio/index.html', 'apps/studio/public/manifest.webmanifest'], ALL), []);
    // the Vitest config is judged by the Vitest step itself, which runs everything for it; only the scope test names it
    assert.deepEqual(harnessFiles(['vitest.config.ts'], ALL), only(['ladder-scope']));
    // the security corpus is read by the sanitizer's tests alone, which the Vitest step runs
    assert.deepEqual(
      harnessFiles(['specs/security/corpus/svg-x.svg', 'specs/security/corpus/links.json', 'specs/security/corpus/expected/svg-x.svg'], ALL),
      [],
    );
    // a package's own fixtures are read by its tests alone, which the Vitest step runs
    assert.deepEqual(harnessFiles(['packages/format/__fixtures__/zip/x.b64', 'packs/x/__fixtures__/y.json'], ALL), []);
    assert.deepEqual(harnessFiles(['scripts/fonts/page-recorder.js'], ALL), only(['milestone-checks', 'portability', 'size']));
    assert.deepEqual(harnessFiles(['scripts/fonts/vendor.mjs'], ALL), only(['milestone-checks', 'portability', 'size']));
    assert.deepEqual(harnessFiles(['scripts/format/goldens.mjs'], ALL), only(['milestone-checks', 'portability', 'size']));
    assert.deepEqual(harnessFiles(['osv-scanner.toml'], ALL), []);
    assert.deepEqual(harnessFiles(['.github/workflows/milestone-gate.yml'], ALL), only(['ci-workflow']));
    assert.deepEqual(
      harnessFiles(['fixtures/docs/minimal.flux.json', 'examples/r0-static.flux.json', 'examples/README.md'], ALL),
      only(['milestone-checks', 'tests-kept']),
    );
    assert.deepEqual(
      harnessFiles(['scripts/gates/thresholds.mjs'], ALL),
      only(['biome', 'budget', 'drift', 'ladder-scope', 'licenses', 'portability', 'size']),
    );
    // one path of any other kind in the commit still runs every file
    assert.deepEqual(harnessFiles(['e2e/x.spec.ts', 'scripts/gates/lib.mjs'], ALL), ALL);
    // every named file exists
    for (const n of [...DOCS_HARNESS, ...E2E_HARNESS, ...Object.values(GATE_SCRIPT_HARNESS).flat()])
      assert.ok(readdirSync(join(REPO, 'tests/harness')).includes(`${n}.test.mjs`), n);
  });

  it('NFR-DX-002: the packaging checks run for a manifest, a lockfile or a build setting, not for sources, reports, specs and docs', () => {
    assert.equal(
      packagingNeeded([
        'packages/core/src/x.ts',
        'packages/cli/schemas/validate.output.json',
        'packages/core/api/core.api.md',
        'e2e/a.spec.ts',
        'docs/a.md',
        'scripts/gates/milestone-checks.mjs',
        'scripts/gates/thresholds.mjs',
        'knip.json',
        'osv-scanner.toml',
        '.github/workflows/milestone-gate.yml',
        '.harness/state.json',
        '.changeset/m8-editor.md',
        'examples/arrange-demo.flux.json',
        'examples/README.md',
        'fixtures/docs/minimal.flux.json',
        'packages/editor/AGENTS.md',
        'apps/docs/src/content/docs/guides/screens-and-arranging.md',
      ]),
      false,
    );
    // a whole-repo coverage run in a sandbox is CI's: a sources-only commit does not rerun it, the Vitest step judges the floors
    assert.ok(!SOURCE_HARNESS.includes('coverage') && SAMPLE_HARNESS.includes('coverage'));
    // a private app's manifest and tsconfig, a workspace-only lockfile and an unchanged library list are not packed
    assert.equal(packagingNeeded(['apps/studio/package.json', 'apps/studio/tsconfig.json']), false);
    assert.equal(
      packagingNeeded(['specs/format/flux-1.0.md', 'scripts/gates/m10-complete.mjs', '.size-limit.js', 'scripts/examples/make-r1-demo.mjs', 'biome.json']),
      false,
    );
    assert.equal(packagingNeeded(['apps/studio/index.html', 'apps/studio/public/manifest.webmanifest']), false);
    assert.equal(packagingNeeded(['apps/studio/package.json', 'pnpm-lock.yaml'], { lockfileWorkspaceOnly: true }), false);
    assert.equal(packagingNeeded(['apps/studio/package.json', 'pnpm-lock.yaml']), true);
    assert.equal(packagingNeeded(['tools/gen/workspaces.json'], { librariesUnchanged: true }), false);
    assert.equal(packagingNeeded(['tools/gen/workspaces.json']), true);
    // the fixture generator, the scope module and the harness tests read documents and test titles, not a manifest or a build setting
    assert.equal(
      packagingNeeded(['scripts/fixtures/gen.mjs', 'fixtures/docs/doc20.flux.json', 'scripts/gates/ladder-scope.mjs', 'tests/harness/ladder-scope.test.mjs']),
      false,
    );
    assert.equal(harnessFiles(['scripts/fixtures/gen.mjs'], ALL).includes(file('milestone-checks')), true);
    // publint and attw pack only the libraries whose packing the commit can change; a root setting or a manifest outside a library packs all
    assert.deepEqual(packagingDirs(['packages/cli/package.json', 'pnpm-lock.yaml', 'docs/a.md'], { lockfileWorkspaceOnly: true }), ['packages/cli']);
    assert.deepEqual(packagingDirs(['packages/cli/package.json', 'packs/basic/tsdown.config.ts', 'packages/cli/src/x.ts']), ['packages/cli', 'packs/basic']);
    assert.equal(packagingDirs(['packages/cli/package.json', 'tsconfig.base.json']), undefined);
    assert.equal(packagingDirs(['packages/cli/package.json', 'pnpm-lock.yaml']), undefined);
    assert.deepEqual(packagingDirs(['docs/a.md', 'packages/cli/src/x.ts']), []);
    // the API step checks the reports of the libraries a commit touches, TypeDoc when a library source changed; a root setting, the workspace list or the gate's helpers checks all; the gate's own script is run over the whole repo by its harness test
    assert.deepEqual(apiScope(['packages/player/src/a.ts', 'packs/basic/src/b.ts', 'e2e/x.ts', 'docs/a.md']), {
      dirs: ['packages/player', 'packs/basic'],
      typedoc: true,
    });
    assert.deepEqual(apiScope(['packages/player/src/a.test.ts', 'packages/player/src/b.stories.tsx', 'packages/player/api/player.api.md']), {
      dirs: ['packages/player'],
      typedoc: false,
    });
    assert.deepEqual(apiScope(['docs/a.md', 'e2e/x.ts', 'scripts/gates/check-api.mjs']), { dirs: [], typedoc: false });
    for (const p of ['tools/gen/workspaces.json', 'scripts/gates/lib.mjs', 'typedoc.json', 'package.json', 'pnpm-lock.yaml', 'tsconfig.base.json'])
      assert.equal(apiScope(['packages/player/src/a.ts', p]), undefined, p);
    // the format specification states numbers the loader and the writer hold: their sources run the test that keeps them together
    for (const p of [
      'packages/format/src/loader-core.ts',
      'packages/format/src/flux-writer.ts',
      'packages/schema/src/document-file.ts',
      'specs/format/flux-1.0.md',
    ])
      assert.ok(harnessFiles([p], ALL).includes(file('format-spec')), p);
    // the embed example is read by its e2e spec alone
    assert.deepEqual(harnessFiles(['examples/embed/index.html'], ALL), []);
    // the licence check reads manifests, the lockfile, licence texts and a pack's font data: a source or a test changes none of them
    assert.equal(
      licensesNeeded(['packages/player/src/element.tsx', 'packages/player/api/player.api.md', 'docs/a.md', 'e2e/x.ts', 'packs/basic/src/a.ts']),
      false,
    );
    for (const p of [
      'packages/player/package.json',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'packages/player/LICENSE',
      'NOTICE',
      'packs/fonts-core/fonts.json',
      'packs/fonts-core/fonts/a.woff2',
      'packs/fonts-core/src/x.woff2',
      '.npmrc',
      'tools/gen/workspaces.json',
      'scripts/gates/check-licenses.mjs',
    ])
      assert.equal(licensesNeeded(['packages/player/src/a.ts', p]), true, p);
    // the API gate's script changes no manifest, export or build setting
    assert.equal(packagingNeeded(['scripts/gates/check-api.mjs', 'packages/core/api/core.testing.api.md']), false);
    // the ladder's own script decides which checks run and packs nothing
    assert.equal(packagingNeeded(['scripts/gates/precommit.mjs', 'docs/a.md']), false);
    // a library's manifest still runs them, whatever the lockfile did
    assert.equal(packagingNeeded(['packages/core/package.json', 'pnpm-lock.yaml'], { lockfileWorkspaceOnly: true, librariesUnchanged: true }), true);
    for (const p of ['packages/core/package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'packages/core/tsup.config.ts', 'scripts/gates/check-packages.mjs'])
      assert.equal(packagingNeeded(['packages/core/src/x.ts', p]), true, p);
  });

  it('a workspace manifest or a workspace-only lockfile runs the manifest harness; an external lockfile change runs them all (M4.29)', () => {
    // literal names: the whole-repo api, coverage, layering and licenses runs are the staged ladder's steps and CI's, not this list's
    const manifest = MANIFEST_HARNESS.filter((n) => !['api', 'coverage', 'layering', 'licenses'].includes(n)).map(file);
    assert.ok(!manifest.some((f) => /\/(api|coverage|layering|licenses)\.test\.mjs$/.test(f)));
    assert.deepEqual(
      harnessFiles(['packages/render/package.json', 'packages/render/src/x.tsx'], ALL),
      ALL.filter((f) => manifest.includes(f)),
    );
    assert.deepEqual(
      harnessFiles(['pnpm-lock.yaml', 'packages/render/package.json'], ALL, { lockfileWorkspaceOnly: true }),
      ALL.filter((f) => manifest.includes(f)),
    );
    assert.deepEqual(harnessFiles(['pnpm-lock.yaml', 'packages/render/package.json'], ALL), ALL);
    assert.deepEqual(harnessFiles(['package.json'], ALL, { lockfileWorkspaceOnly: true }), ALL);
    // a lockfile staged without a workspace manifest is never taken as workspace-only (review F1)
    assert.deepEqual(harnessFiles(['pnpm-lock.yaml'], ALL, { lockfileWorkspaceOnly: true }), ALL);
    assert.deepEqual(testScope(['pnpm-lock.yaml'], workspaces, BROWSER, { lockfileWorkspaceOnly: true }), { run: true, browser: true });
    assert.deepEqual(harnessFiles(['docs/requirements/40-traceability.md', '.harness/progress.md'], ALL), [file('trace')]);
    // the Vitest scope: a workspace-only lockfile is the manifests' workspaces, not a global input
    assert.deepEqual(testScope(['pnpm-lock.yaml', 'packages/cli/package.json'], workspaces, BROWSER, { lockfileWorkspaceOnly: true }).browser, false);
    assert.deepEqual(testScope(['pnpm-lock.yaml', 'packages/cli/package.json'], workspaces, BROWSER), { run: true, browser: true });
  });

  it('lockfileWorkspaceOnly: only workspace links may differ', () => {
    const lines = (...l) => `${l.join('\n')}\n`;
    const react = (version, integrity) => lines(`  react@${version}:`, `    resolution: {integrity: ${integrity}}`, '');
    const lock = (importers, packages) =>
      lines("lockfileVersion: '9.0'", '', 'settings:', '  autoInstallPeers: true', '', 'importers:', '', '  .:', '    devDependencies: {}', '') +
      importers +
      lines('packages:', '') +
      packages +
      lines('snapshots:', '') +
      packages;
    const base = lock('', react('19.2.0', 'sha512-a'));
    assert.equal(lockfileWorkspaceOnly(base, base), true);
    // a workspace link added to a package's importer entry
    const link = lines(
      '  packages/render:',
      '    dependencies:',
      "      '@fluxion/geometry':",
      '        specifier: workspace:*',
      '        version: link:../geometry',
      '',
    );
    assert.equal(lockfileWorkspaceOnly(base, lock(link, react('19.2.0', 'sha512-a'))), true);
    // an importer resolving an external dependency to another version already in packages: is not (review F1)
    const importsReact = (version) =>
      lines('  packages/render:', '    dependencies:', '      react:', '        specifier: ^19.0.0', `        version: ${version}`, '');
    const both = react('19.2.0', 'sha512-a') + react('19.2.1', 'sha512-b');
    assert.equal(lockfileWorkspaceOnly(lock(importsReact('19.2.0'), both), lock(importsReact('19.2.1'), both)), false);
    // the same external dependency moved between dependency kinds is
    const asDev = lines('  packages/render:', '    devDependencies:', '      react:', '        specifier: ^19.0.0', '        version: 19.2.0', '');
    assert.equal(lockfileWorkspaceOnly(lock(importsReact('19.2.0'), both), lock(asDev, both)), true);
    // CRLF checkouts compare equal
    assert.equal(lockfileWorkspaceOnly(base, base.replaceAll('\n', '\r\n')), true);
    // an external version, a new package or a setting is not workspace-only
    assert.equal(lockfileWorkspaceOnly(base, lock('', react('19.2.1', 'sha512-b'))), false);
    assert.equal(
      lockfileWorkspaceOnly(base, lock('', react('19.2.0', 'sha512-a') + lines('  left-pad@1.0.0:', '    resolution: {integrity: sha512-c}', ''))),
      false,
    );
    assert.equal(lockfileWorkspaceOnly(base, base.replace('autoInstallPeers: true', 'autoInstallPeers: false')), false);
  });

  it('NFR-DX-002: a workspace newly linked to an already-locked package runs the manifest harness, a new package runs them all (M12.29)', () => {
    const lines = (...l) => `${l.join('\n')}\n`;
    const yaml = lines('  yaml@2.9.1:', '    resolution: {integrity: sha512-y}', '');
    const lock = (catalogs, importers, packages) =>
      lines("lockfileVersion: '9.0'", '', 'settings:', '  autoInstallPeers: true', '', 'catalogs:', '  default:') +
      catalogs +
      lines('', 'importers:', '', '  .:', '    devDependencies: {}', '') +
      importers +
      lines('packages:', '') +
      packages +
      lines('snapshots:', '') +
      packages;
    const entry = lines('    yaml:', '      specifier: 2.9.1', '      version: 2.9.1');
    const uses = lines('  packages/dsl:', '    dependencies:', '      yaml:', "        specifier: 'catalog:'", '        version: 2.9.1', '');
    const before = lock('', '', yaml);
    const after = lock(entry, uses, yaml);
    // a catalog entry and an importer resolving to a package already locked: nothing new is fetched
    assert.equal(lockfileLockedOnly(before, after), true);
    assert.equal(lockfileLockedOnly(before, after.replaceAll('\n', '\r\n')), true);
    // a new package, a changed integrity or a setting is not
    assert.equal(lockfileLockedOnly(before, lock(entry, uses, yaml + lines('  left-pad@1.0.0:', '    resolution: {integrity: sha512-c}', ''))), false);
    assert.equal(lockfileLockedOnly(before, lock(entry, uses, yaml.replace('sha512-y', 'sha512-z'))), false);
    assert.equal(lockfileLockedOnly(before, after.replace('autoInstallPeers: true', 'autoInstallPeers: false')), false);
    // a version change to another locked version is not an addition: an importer's or a catalog's (M12.29 review F1)
    const two = yaml + lines('  yaml@2.9.2:', '    resolution: {integrity: sha512-w}', '');
    assert.equal(lockfileLockedOnly(lock(entry, uses, two), lock(entry, uses.replace('version: 2.9.1', 'version: 2.9.2'), two)), false);
    const bumped = entry.replace('specifier: 2.9.1', 'specifier: 2.9.2').replace('version: 2.9.1', 'version: 2.9.2');
    assert.equal(lockfileLockedOnly(lock(entry, '', two), lock(bumped, '', two)), false);
    // a second catalog entry added beside the first is still an addition
    const zod = lines('    zod:', '      specifier: 4.6.5', '      version: 4.6.5');
    assert.equal(lockfileLockedOnly(lock(entry, uses, yaml), lock(entry + zod, uses, yaml)), true);
    // pnpm-workspace.yaml: only the catalog block may differ (a comment line inside it included)
    const ws = (catalog) =>
      lines(
        'packages:',
        '  - packages/*',
        '',
        'catalog:',
        '  # one version per dependency',
        '  zod: 4.6.5',
        ...catalog,
        '',
        'overrides:',
        '  tmp@<0.2.7: 0.2.7',
      );
    assert.equal(workspaceCatalogOnly(ws([]), ws(['  yaml: 2.9.1 # parsing'])), true);
    assert.equal(workspaceCatalogOnly(ws([]), ws([]).replace('tmp@<0.2.7: 0.2.7', 'tmp@<0.2.8: 0.2.8')), false);
    assert.equal(workspaceCatalogOnly(ws([]), ws([]).replace('  - packages/*', '  - packages/*\n  - tools/*')), false);
    // the harness scope: with a manifest, the lockfile and the catalog run the manifest harness; without the flag or a manifest, all
    const manifest = ALL.filter((f) =>
      MANIFEST_HARNESS.filter((n) => !['api', 'coverage', 'layering', 'licenses'].includes(n))
        .map(file)
        .includes(f),
    );
    const staged = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/dsl/package.json'];
    assert.deepEqual(harnessFiles(staged, ALL, { lockedDependency: true }), manifest);
    assert.deepEqual(harnessFiles(staged, ALL), ALL);
    assert.deepEqual(harnessFiles(['pnpm-lock.yaml', 'pnpm-workspace.yaml'], ALL, { lockedDependency: true }), ALL);
  });

  it('every harness file that names a manifest or the lockfile is a manifest harness file (M4.29)', () => {
    const readers = readdirSync(join(REPO, 'tests/harness'))
      .filter((f) => f.endsWith('.test.mjs') && f !== 'ladder-scope.test.mjs')
      .filter((f) => /package.json|pnpm-lock|pnpm-workspace/.test(readFileSync(join(REPO, 'tests/harness', f), 'utf8')))
      .map((f) => f.replace('.test.mjs', ''));
    assert.ok(readers.length >= 5, `found ${readers.length} readers`);
    assert.deepEqual(
      readers.filter((f) => !MANIFEST_HARNESS.includes(f)),
      [],
    );
    for (const name of MANIFEST_HARNESS) assert.ok(readdirSync(join(REPO, 'tests/harness')).includes(`${name}.test.mjs`), name);
  });

  // M4.26 review F1: a harness file that reads the repo's package paths is classified, never missed
  it('every harness file that reads package paths is a source or sample harness file', () => {
    // literal package paths, and paths built from variables or workspace loops (review round 2 F1)
    const reads =
      /join\(REPO, '(packages|packs|apps)|REPO, `(packages|packs|apps)|sandbox\(\[[^\]]*'(packages|packs|apps)\/|'--package', 'packages\/|join\(REPO, [a-z]\w*(\.\w+)?[,)]|workspaces\.map\(\(w\) => w\.dir\)|\.\.\.workspaces/;
    const readers = readdirSync(join(REPO, 'tests/harness'))
      .filter((f) => f.endsWith('.test.mjs') && f !== 'ladder-scope.test.mjs')
      .filter((f) => reads.test(readFileSync(join(REPO, 'tests/harness', f), 'utf8')))
      .map((f) => f.replace('.test.mjs', ''));
    assert.ok(readers.length >= 5, `found ${readers.length} readers`);
    assert.deepEqual(
      readers.filter((f) => !SOURCE_HARNESS.includes(f) && !SAMPLE_HARNESS.includes(f)),
      [],
    );
    // and every listed name is a real harness file
    for (const name of [...SOURCE_HARNESS, ...SAMPLE_HARNESS]) assert.ok(readdirSync(join(REPO, 'tests/harness')).includes(`${name}.test.mjs`), name);
  });

  it('titled batches one run per project', () => {
    const calls = [];
    const runner = (args) => {
      calls.push(args);
      const out = args.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
      const pattern = args[args.indexOf('-t') + 1];
      const titles = pattern.split('|').map((t) => t.replace(/\\(.)/g, '$1'));
      writeFileSync(out, JSON.stringify({ testResults: [{ assertionResults: titles.map((title) => ({ fullName: `suite ${title}`, status: 'passed' })) }] }));
      return { status: 0, stdout: '', stderr: '' };
    };
    const verdict = titled(
      [
        ['M4.9', 'FR-THM-001: a (b) title', 'theme'],
        ['M4.4', 'NFR-MNT-006: another', 'core'],
        ['M4.11', 'FR-SCR-001: in the browser', 'render', {}, 'browser'],
        ['M4.14', 'FR-SHP-001: also browser', 'render', {}, 'browser'],
      ],
      { runner },
    );
    assert.equal(verdict, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((a) => a[a.indexOf('--project') + 1]),
      ['node', 'browser'],
    );
    assert.ok(calls[0].includes('packages/theme') && calls[0].includes('packages/core'));
    // a title the run did not pass is reported with its row
    const failing = (args) => {
      const out = args.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
      writeFileSync(out, JSON.stringify({ testResults: [{ assertionResults: [{ fullName: 'x FR-THM-001: one', status: 'passed' }] }] }));
      return { status: 0, stdout: '', stderr: '' };
    };
    assert.equal(
      titled(
        [
          ['A', 'FR-THM-001: one', 'theme'],
          ['B', 'FR-THM-001: two', 'theme'],
        ],
        { runner: failing },
      ),
      'B "FR-THM-001: two": 0 passing test(s), need 1',
    );
  });

  it('the demo check fails a screen without a shape, connector or token style', () => {
    const shape = '<div class="fx-el" data-el-id="a" data-kind="shape"><svg><path d="M0 0" fill="var(--fx-color-surface, #fff)"/></svg></div>';
    const connector =
      '<div class="fx-el" data-el-id="c" data-kind="connector"><svg><path d="M0 0L9 9" stroke="var(--fx-color-connector, #334155)"/></svg></div>';
    const screen = (body) => `<section class="fx-screen" style="--fx-color-primary:#2563eb">${body}</section>`;
    assert.equal(checkDemoHtml(`<html>${screen(shape + connector)}${screen(shape + connector)}</html>`, 2), true);
    assert.equal(checkDemoHtml(screen(shape + connector), 2), '1 .fx-screen (want 2)');
    assert.equal(checkDemoHtml(`${screen(shape + connector)}${screen(connector)}`, 2), 'screen 2 lacks a shape');
    const noPath = '<div class="fx-el" data-el-id="c" data-kind="connector"><svg></svg></div>';
    assert.equal(checkDemoHtml(`${screen(shape + noPath)}${screen(shape + connector)}`, 2), 'screen 1 lacks a connector path');
    const plain =
      '<section class="fx-screen"><div class="fx-el" data-kind="shape"></div><div class="fx-el" data-kind="connector"><svg><line/></svg></div></section>';
    assert.equal(checkDemoHtml(`${plain}${screen(shape + connector)}`, 2), 'screen 1 lacks a token style');
  });

  it('NFR-DX-002: the ladder imports every scope function it calls (a missing import fails only when that step runs)', async () => {
    const source = readFileSync(join(REPO, 'scripts/gates/precommit.mjs'), 'utf8');
    const imported = /import \{([^}]*)\} from '\.\/ladder-scope\.mjs';/.exec(source)?.[1] ?? '';
    const scope = await import('../../scripts/gates/ladder-scope.mjs');
    const body = source.replace(/import \{[^}]*\} from '\.\/ladder-scope\.mjs';/, '');
    for (const name of Object.keys(scope).filter((n) => typeof scope[n] === 'function')) {
      if (new RegExp(`(?<![\\w.])${name}\\(`).test(body))
        assert.match(imported, new RegExp(`\\b${name}\\b`), `${name} is called by precommit.mjs and not imported`);
    }
  });
});
