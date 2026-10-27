import { defineConfig } from 'tsdown';

// The package comment is a dts banner: in the bundled index.d.ts, imports from other packages come
// before index.ts's own text, and API Extractor needs @packageDocumentation at the very top (as schema).
const PACKAGE_DOC = `/**
 * \`@fluxion/sdk\` — Public plugin API: stable contracts, manifest schema, component contract, test harness.
 *
 * @packageDocumentation
 */`;

export default defineConfig({
  // the testing entry is its own module: the renderer and test builders stay out of the main bundle
  entry: { index: 'src/index.ts', 'testing/index': 'src/testing/index.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { dts: PACKAGE_DOC },
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
