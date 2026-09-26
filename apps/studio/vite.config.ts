import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Studio dev/build (Vite 8 + React 19). E2E builds it and serves the build with `vite preview --port 4317`.
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['@fluxion/source', 'module', 'browser', 'development|production'] },
  server: { strictPort: true },
});
