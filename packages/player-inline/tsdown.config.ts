import { defineConfig } from 'tsdown';

// Two outputs (ADR-0154): the package itself (ESM and types, like every library), and `dist/player.inline.js`, the one classic script a
// `.flux.html` embeds. The script bundles every dependency, targets the browser, is minified, and defines the global `Fluxion`.
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    clean: true,
    sourcemap: true,
    fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)
    // the script below is built separately: the library output keeps its dependencies external, as every package does
  },
  {
    entry: { 'player.inline': 'src/inline.ts' },
    format: 'iife',
    globalName: 'Fluxion',
    platform: 'browser',
    clean: false,
    dts: false,
    sourcemap: false,
    minify: true,
    deps: { alwaysBundle: [/.*/] },
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: { entryFileNames: 'player.inline.js' },
  },
]);
