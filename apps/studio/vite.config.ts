import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Studio dev/build (Vite 8 + React 19). The e2e webServer starts `vite --port 4173 --strictPort`.
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['@fluxion/source', 'module', 'browser', 'development|production'] },
  server: { strictPort: true },
});
