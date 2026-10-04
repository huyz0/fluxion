import { defineConfig } from 'tsdown';

// The package comment is a dts banner: API Extractor needs @packageDocumentation at the very top of the
// bundled index.d.ts, above the re-exported regions (as in @fluxion/schema and @fluxion/theme).
const PACKAGE_DOC = `/**
 * \`@fluxion/render\` — React 19 DOM+SVG renderer of a screen, identical in edit and present mode.
 *
 * @packageDocumentation
 */`;

export default defineConfig({
  // the static render path (react-dom/server) is its own entry, `@fluxion/render/ssr`: the main entry, and the one-file player built from it, stay free of the
  // server renderers (ADR-0026)
  entry: ['src/index.ts', 'src/ssr.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { dts: PACKAGE_DOC },
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
