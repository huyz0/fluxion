import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', bin: 'src/bin.ts', 'ops/index': 'src/ops/index.ts' },
  format: 'esm',
  external: ['playwright'], // the optional peer of `render --format png` (ADR-0036): loaded at run time, never bundled
  dts: true,
  clean: true,
  sourcemap: true,
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
