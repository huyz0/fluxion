import { defineConfig } from 'tsdown';
import { i18nCatalogs } from '../../tools/vite-lingui/catalogs.mjs';
import { lingui } from '../../tools/vite-lingui/index.mjs';

// The package comment is a dts banner: in the bundled index.d.ts, re-exported regions come before
// index.ts's own text, and API Extractor needs @packageDocumentation at the very top (as core).
const PACKAGE_DOC = `/**
 * \`@fluxion/player\` — Present runtime: navigation, clock and scheduler, transitions, trigger bus, interactions, overlays, responsive, speaker sync.
 *
 * @packageDocumentation
 */`;

export default defineConfig({
  // the element (`@fluxion/player/element`) is its own entry as well: it defines a custom element only when a host asks (ADR-0026)
  // the mount (React DOM's `createRoot`) is its own entry, `@fluxion/player/mount`: the package's main entry stays free of React DOM and within PLAYER_CORE_GZIP
  entry: ['src/index.ts', 'src/mount.tsx', 'src/element.tsx', 'src/react.tsx'],
  // the macros become runtime calls and the English catalog a module of compiled messages (ADR-0023); `@lingui/core` stays external like every dependency
  plugins: [lingui({ catalogs: i18nCatalogs, production: true })],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { dts: PACKAGE_DOC },
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
