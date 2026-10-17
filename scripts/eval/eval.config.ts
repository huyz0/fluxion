// Vitest config of the recorded eval (M15.14): like scripts/dsl/examples.config.ts, it reaches the workspaces through their source entry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const ROOT = join(import.meta.dirname, '..', '..');
const { workspaces } = JSON.parse(readFileSync(join(ROOT, 'tools/gen/workspaces.json'), 'utf8')) as {
  workspaces: { readonly dir: string; readonly name: string }[];
};
const conditions = ['@fluxion/source', 'module', 'node', 'development|production'];

export default defineConfig({
  root: ROOT,
  cacheDir: process.env['FLUXION_VITEST_CACHE'] ?? '.vitest-cache',
  resolve: {
    conditions,
    alias: workspaces.map((w) => ({ find: new RegExp(`^${w.name.replace('/', '\\/')}$`), replacement: join(ROOT, w.dir, 'src', 'index.ts') })),
  },
  ssr: { resolve: { conditions } },
  test: { name: 'eval', environment: 'node', include: ['scripts/eval/eval.test.ts'], testTimeout: 120_000 },
});
