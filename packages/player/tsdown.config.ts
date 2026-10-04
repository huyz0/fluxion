import { defineConfig } from 'tsdown';

// The package comment is a dts banner: in the bundled index.d.ts, re-exported regions come before
// index.ts's own text, and API Extractor needs @packageDocumentation at the very top (as core).
const PACKAGE_DOC = `/**
 * \`@fluxion/player\` — Present runtime: navigation, clock and scheduler, transitions, trigger bus, interactions, overlays, responsive, speaker sync.
 *
 * @packageDocumentation
 */`;

export default defineConfig({
  // the mount (React DOM's `createRoot`) is its own entry, `@fluxion/player/mount`: the package's main entry stays free of React DOM and within PLAYER_CORE_GZIP
  entry: ['src/index.ts', 'src/mount.tsx'],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { dts: PACKAGE_DOC },
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
