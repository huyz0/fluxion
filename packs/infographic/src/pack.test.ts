// The infographic pack's checked-in distribution (FR-LIB-007, ADR-0048, ADR-0050, ADR-0194, ADR-0199): pack/, __golden__/ and
// pack-versions.json must equal what the SDK suite builds from the exported `infographicSource`, through the one shared pack test
// (`testShapePack`). Runs only compare and never write. To regenerate the files, run
// `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/infographic -u` (both are needed), then a plain run to check them; after
// `changeset version`, `node scripts/packs/sync-versions.mjs` does both for every pack.
import { testShapePack } from '@fluxion/sdk/testing';
import { describe } from 'vitest';
import { infographicSource } from './index.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

describe('the infographic declarative pack (FR-LIB-003, FR-LIB-007, NFR-LIC-003)', () => {
  testShapePack(infographicSource, {
    pack: import.meta.glob('../pack/**/*.json', { query: '?raw', import: 'default', eager: true }),
    goldens: import.meta.glob('../__golden__/**/*', { query: '?raw', import: 'default', eager: true }),
    packageJson: import.meta.glob('../package.json', { query: '?raw', import: 'default', eager: true }),
    versions: import.meta.glob('../pack-versions.json', { query: '?raw', import: 'default', eager: true }),
    changelog: import.meta.glob('../CHANGELOG.md', { query: '?raw', import: 'default', eager: true }),
  });
});
