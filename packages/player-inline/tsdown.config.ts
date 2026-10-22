import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

// In the script, `zod` is an inert stand-in (src/zod-stub.ts, ADR-0026 amendment): the player validates nothing, and the schemas the bundled packages build while loading would
// otherwise keep all of Zod in the file. The library output below keeps its dependencies external like every package.
const ZOD_STUB = fileURLToPath(new URL('./src/zod-stub.ts', import.meta.url));
// With the stand-in, building a schema has no effect, so a schema the script never reads is dropped (M17.32: the player sat at its budget):
// calls through `z` and the schema package's `checkedSchema` are marked pure for the scripts.
const PURE_SCHEMAS = { treeshake: { manualPureFunctions: ['z', 'checkedSchema'] } };

// The outputs (ADR-0154): the package itself (ESM and types, like every library), and `dist/player.inline.js`, the one classic script a
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
    alias: { zod: ZOD_STUB },
    inputOptions: PURE_SCHEMAS,
    deps: { alwaysBundle: [/.*/] },
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: { entryFileNames: 'player.inline.js' },
  },
  {
    // the same script for a page that embeds `<fluxion-player>` (FR-PRS-009): it defines the element and exports nothing
    entry: { 'fluxion-player': 'src/element-entry.ts' },
    format: 'iife',
    platform: 'browser',
    clean: false,
    dts: false,
    sourcemap: false,
    minify: true,
    alias: { zod: ZOD_STUB },
    inputOptions: PURE_SCHEMAS,
    deps: { alwaysBundle: [/.*/] },
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: { entryFileNames: 'fluxion-player.js' },
  },
  {
    // the routing chunk (M16.28, NFR-SIZE-001): the global routing pass alone, a classic script defining `FluxionRouting` that the two
    // scripts above load once the deck is drawn
    entry: { 'fluxion-routing': 'src/routing-chunk.ts' },
    format: 'iife',
    globalName: 'FluxionRouting',
    platform: 'browser',
    clean: false,
    dts: false,
    sourcemap: false,
    minify: true,
    alias: { zod: ZOD_STUB },
    inputOptions: PURE_SCHEMAS,
    deps: { alwaysBundle: [/.*/] },
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: { entryFileNames: 'fluxion-routing.js' },
  },
]);
