import { defineConfig } from 'tsdown';

// The package comment is a dts banner: in the bundled index.d.ts, re-exported regions come before index.ts's own text, and API Extractor needs
// @packageDocumentation at the very top (M2.4 review F2, M2.6).
const PACKAGE_DOC = `/**
 * \`@fluxion/geometry\` — Vectors, matrices, bezier/path ops, outline sampling, intersections, bounding boxes, spatial index wrappers.
 *
 * @packageDocumentation
 */`;

export default defineConfig({
  // the boolean operations are their own entry: polybooljs stays out of what the player bundles (ADR-0053)
  entry: { index: 'src/index.ts', boolean: 'src/boolean.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { dts: PACKAGE_DOC },
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
