// Vitest config of the FluxScript example corpus (M12.17): `pnpm --filter @fluxion/dsl test:examples`. The run compiles examples/dsl/*.flux.yaml
// against the first-party packs a host registers, which packages/dsl may not import (check-layering: dsl is L2, packs sit at the host layer).
// So the runner lives here, outside every workspace, as the root scripts do, and reaches the workspaces through their source entry
// (`@fluxion/source`, ADR-0011): each `@fluxion/*` name is aliased to its `src/index.ts`, so no build is needed and no dist can be stale.
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
  cacheDir: process.env.FLUXION_VITEST_CACHE ?? '.vitest-cache',
  resolve: {
    conditions,
    alias: workspaces.map((w) => ({ find: new RegExp(`^${w.name.replace('/', '\\/')}$`), replacement: join(ROOT, w.dir, 'src', 'index.ts') })),
  },
  ssr: { resolve: { conditions } },
  test: { name: 'dsl-examples', environment: 'node', include: ['scripts/dsl/examples.test.ts'], testTimeout: 60_000 },
});
