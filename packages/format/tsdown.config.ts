import { defineConfig } from 'tsdown';

export default defineConfig({
  // the lean reader is its own entry, `@fluxion/format/player` (ADR-0026): what a one-file player imports reaches no validator
  entry: ['src/index.ts', 'src/player.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
});
