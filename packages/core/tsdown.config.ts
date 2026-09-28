import { defineConfig } from 'tsdown';

// The package comment is a dts banner: in the bundled index.d.ts, re-exported regions come before
// index.ts's own text, and API Extractor needs @packageDocumentation at the very top (as schema, M2.6).
const PACKAGE_DOC = `/**
 * \`@fluxion/core\` — Document store (records + signals), transactions, commands, undo/redo, queries, registries.
 *
 * @packageDocumentation
 */`;

export default defineConfig({
  // the testing entry is its own module: test fakes stay out of the main bundle
  entry: { index: 'src/index.ts', 'testing/index': 'src/testing/index.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { dts: PACKAGE_DOC },
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
