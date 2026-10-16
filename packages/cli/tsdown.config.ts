import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', bin: 'src/bin.ts', 'ops/index': 'src/ops/index.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
