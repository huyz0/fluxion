import { defineConfig } from 'tsdown';

// The package comment is a dts banner: API Extractor needs @packageDocumentation at the very top of the
// bundled index.d.ts, above the re-exported regions (as in @fluxion/schema; M4.9 review F3).
const PACKAGE_DOC = `/**
 * \`@fluxion/theme\` — Token model (DTCG), token resolution, palette generation (OKLCH), contrast checks, CSS-variable emission.
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
