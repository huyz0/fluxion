import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
