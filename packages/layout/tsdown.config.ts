import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', worker: 'src/worker/index.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
