import { defineConfig } from 'tsdown';

// The package comment is a dts banner: in the bundled index.d.ts, external imports (zod) and
// re-exported regions come before index.ts's own text, and API Extractor needs
// @packageDocumentation at the very top (M2.4 review F2, M2.6).
const PACKAGE_DOC = `/**
 * \`@fluxion/schema\` — Zod 4 schemas and TS types for every record; IDs; validation errors; JSON Schema generation; migrations.
 *
 * @packageDocumentation
 */`;

export default defineConfig({
  // the testing entry is its own module: fast-check stays out of the main bundle
  entry: { index: 'src/index.ts', 'testing/index': 'src/testing/index.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { dts: PACKAGE_DOC },
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
