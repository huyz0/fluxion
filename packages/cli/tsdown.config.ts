import { defineConfig } from 'tsdown';
import { buildSvgWitness } from './scripts/build-svg-witness.mjs';

export default defineConfig({
  entry: { index: 'src/index.ts', bin: 'src/bin.ts', 'ops/index': 'src/ops/index.ts', 'svg-witness': 'src/svg-witness.ts' },
  format: 'esm',
  external: ['playwright'], // the optional peer of `render --format png` (ADR-0036): loaded at run time, never bundled
  dts: true,
  clean: true,
  onSuccess: buildSvgWitness,
  sourcemap: true,
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
