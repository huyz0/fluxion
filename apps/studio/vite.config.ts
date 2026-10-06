import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { i18nCatalogs } from '../../tools/vite-lingui/catalogs.mjs';
import { lingui } from '../../tools/vite-lingui/index.mjs';

// Studio dev/build (Vite 8 + React 19). E2E builds it and serves the build with `vite preview --port 4317`.
export default defineConfig({
  plugins: [lingui({ catalogs: i18nCatalogs }), react()],
  resolve: { conditions: ['@fluxion/source', 'module', 'browser', 'development|production'] },
  server: { strictPort: true },
});
