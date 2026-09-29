import { defineConfig } from 'tsdown';

// The package comment is a dts banner: in the bundled index.d.ts, re-exported regions come before
// index.ts's own text, and API Extractor needs @packageDocumentation at the very top (as core).
const PACKAGE_DOC = `/**
 * \`@fluxion/editor\` — Edit overlay, tools state machine, panels, inspector, library, timeline and interaction editors, AI panel.
 *
 * @packageDocumentation
 */`;

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { dts: PACKAGE_DOC },
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
