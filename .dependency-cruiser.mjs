// Layer rules from docs/architecture/01-overview.md §2 (NFR-MNT-001), enforced by check-layering.mjs.
// tools/gen/workspaces.json is the single source of allowed edges: `dependsOn` lists the only
// workspaces a package may import. Imports are matched both resolved (packages/<x>/…) and by bare
// name (@fluxion/<x>), so a violation is named correctly even before the package is linked.
import { readFileSync } from 'node:fs';

const { workspaces } = JSON.parse(readFileSync(new URL('./tools/gen/workspaces.json', import.meta.url), 'utf8'));
const short = (w) => w.dir.split('/').at(-1);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (xs) => xs.map(esc).join('|');
const all = workspaces.map(short);

// a workspace, whether reached through its folder or its package name
const target = (names) =>
  `^(${workspaces
    .filter((w) => names.includes(short(w)))
    .map((w) => `${esc(w.dir)}/|${esc(w.name)}($|/)|node_modules/${esc(w.name)}/`)
    .join('|')})`;
const DOM_LIBS = '(^|/node_modules/)(react|react-dom|jsdom|happy-dom|@testing-library/[^/]+|@vitest/browser[^/]*|playwright|@playwright/[^/]+)(/|$)';

const layerRules = workspaces.map((w) => {
  const forbidden = all.filter((n) => n !== short(w) && !w.dependsOn.includes(n));
  return {
    name: `layer-${short(w)}`,
    comment: `${w.name} may import only ${w.dependsOn.length ? w.dependsOn.join(', ') : 'no other workspace'} (workspaces.json dependsOn; overview "May depend on")`,
    severity: 'error',
    from: { path: `^${esc(w.dir)}/` },
    to: { path: target(forbidden) },
  };
});
const pure = workspaces.filter((w) => w.runtime === 'pure');

export default {
  forbidden: [
    ...layerRules,
    {
      name: 'player-not-editor',
      comment: 'player must never import editor: the saved file embeds the player only (rule 3)',
      severity: 'error',
      from: { path: '^packages/player/' },
      to: { path: target(['editor']) },
    },
    {
      name: 'packs-sdk-only',
      comment: 'packs import only @fluxion/sdk among workspaces (rule 4, FR-EXT-001)',
      severity: 'error',
      from: { path: '^packs/' },
      to: { path: target(all.filter((n) => n !== 'sdk' && !workspaces.some((w) => w.dir === `packs/${n}`))) },
    },
    {
      name: 'pure-no-node',
      comment: `pure packages (${alt(pure.map(short))}) import no node:* or Node built-ins (rule 2; inject ports)`,
      severity: 'error',
      from: { path: `^(${alt(pure.map((w) => w.dir))})/` },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'pure-no-dom',
      comment: 'pure packages import no DOM or React library (rule 2)',
      severity: 'error',
      from: { path: `^(${alt(pure.map((w) => w.dir))})/` },
      to: { path: DOM_LIBS },
    },
    {
      name: 't0-tests-no-dom',
      comment: 'T0 tests (*.test.ts, not *.browser.test.*) import nothing from DOM packages (testing.md rule 2)',
      severity: 'error',
      from: { path: '\\.test\\.[cm]?[jt]sx?$', pathNot: '\\.browser\\.test\\.[cm]?[jt]sx?$' },
      to: { path: DOM_LIBS },
    },
    {
      name: 'no-deep-import',
      comment: "only a package's exports entry points: no @fluxion/<x>/<path> and no relative path into another workspace (rule 5)",
      severity: 'error',
      from: {},
      to: { path: `^(${workspaces.map((w) => `${esc(w.name)}/`).join('|')})` },
    },
    {
      name: 'no-relative-cross-workspace',
      comment: 'a relative import that leaves its own workspace is a deep import (rule 5)',
      severity: 'error',
      from: { path: '^(packages|packs|apps)/([^/]+)/' },
      to: { dependencyTypes: ['local'], path: '^(packages|packs|apps)/', pathNot: '^$1/$2/' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'not-to-dev-dep',
      comment: 'shipped source must not import devDependencies',
      severity: 'error',
      from: { path: '^(packages|packs)/[^/]+/src/', pathNot: '\\.(test|spec|stories)\\.[cm]?[jt]sx?$|/__fixtures__/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'an import that does not resolve is a typo or a missing dependency',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, pathNot: target(all) },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|\\.tsbuild|coverage|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      conditionNames: ['@fluxion/source', 'import', 'types', 'default'],
      exportsFields: ['exports'],
      extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'],
    },
  },
};
