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
const DOM_LIBS =
  '(^|/node_modules/)(react|react-dom|jsdom|happy-dom|@testing-library/[^/]+|@vitest/browser[^/]*|vitest/(dist/)?browser[^/]*|playwright|@playwright/[^/]+)(/|$)';

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
      comment:
        'shipped source must not import devDependencies; a peerDependency the package also lists as a devDependency (so its own tests install it) is the host-provided singleton, not a dev tool (React in render, M4.11)',
      severity: 'error',
      from: { path: '^(packages|packs)/[^/]+/src/', pathNot: '\\.(test|spec|stories)\\.[cm]?[jt]sx?$|/__fixtures__/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['npm-peer'] },
    },
    {
      name: 'not-to-undeclared-dep',
      comment: 'shipped source imports only packages its own package.json declares',
      severity: 'error',
      from: { path: '^(packages|packs)/[^/]+/src/', pathNot: '\\.(test|spec|stories)\\.[cm]?[jt]sx?$|/__fixtures__/' },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'an import that does not resolve is a typo or a missing dependency',
      severity: 'error',
      from: {},
      // astro: modules are Astro's virtual modules, resolved by Astro at build time (apps/docs)
      to: { couldNotResolve: true, pathNot: `${target(all)}|^astro:` },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // only our own build outputs: excluding node_modules, or any `dist/` (npm packages resolve into
    // theirs), drops every npm edge, so the dev-dep/undeclared/DOM rules could never fire (M1.27);
    // doNotFollow keeps those edges but does not cruise inside them
    exclude: { path: '^(packages|packs|apps)/[^/]+/(dist|\\.tsbuild|coverage|\\.astro)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      conditionNames: ['@fluxion/source', 'import', 'types', 'default'],
      exportsFields: ['exports'],
      extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'],
    },
  },
};
