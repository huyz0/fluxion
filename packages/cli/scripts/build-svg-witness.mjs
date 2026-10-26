// ADR-0189: ship the same public browser witness as an installed-package asset.
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { domFreeAliases } from '../../../tools/vite-dom-free/index.mjs';

export async function buildSvgWitness() {
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { conditions: ['module', 'browser'], alias: domFreeAliases },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: fileURLToPath(new URL('../dist', import.meta.url)),
      emptyOutDir: false,
      sourcemap: true,
      license: { fileName: 'svg-witness.LICENSES.md' },
      lib: {
        entry: fileURLToPath(import.meta.resolve('@fluxion/render/svg-witness')),
        name: 'FluxionSvgWitness',
        formats: ['iife'],
        fileName: () => 'svg-witness.browser.js',
      },
    },
  });
}
