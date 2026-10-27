// The network pack's checked-in distribution (FR-LIB-007, ADR-0048, ADR-0050, ADR-0194): pack/, __golden__/ and pack-versions.json
// must equal what the SDK suite builds from the exported `networkSource`, load through the host loader, carry no vendor brand, draw
// inside each box, and agree with the package version and CHANGELOG.md. Runs only compare and never write. To regenerate the files,
// run `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run -u packs/network` (both are needed), then a plain run to check them; after
// `changeset version`, `node scripts/packs/sync-versions.mjs` does both for every pack.
import { type CheckedInShapePack, checkShapePack, shapePackExpectation } from '@fluxion/sdk/testing';
import { describe, expect, it } from 'vitest';
import { networkSource } from './index.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

/** Only an explicit write run (see the top) may rewrite the files; every other run, a gate's included, compares. */
const WRITE = (import.meta as { readonly env?: Readonly<Record<string, string | undefined>> }).env?.['VITE_FLUXION_WRITE_PACK'] === '1';
/** Files read as checked in, by their path below `dir`. */
const below = (raw: Record<string, string>, dir: string) => Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.replace(dir, ''), text]));
const checkedIn: CheckedInShapePack = {
  pack: below(import.meta.glob('../pack/**/*.json', { query: '?raw', import: 'default', eager: true }), '../pack/'),
  goldens: below(import.meta.glob('../__golden__/**/*', { query: '?raw', import: 'default', eager: true }), '../__golden__/'),
  packageJson: import.meta.glob('../package.json', { query: '?raw', import: 'default', eager: true })['../package.json'] ?? '',
  versions: import.meta.glob('../pack-versions.json', { query: '?raw', import: 'default', eager: true })['../pack-versions.json'],
  changelog: import.meta.glob('../CHANGELOG.md', { query: '?raw', import: 'default', eager: true })['../CHANGELOG.md'],
};

describe('the network declarative pack (FR-LIB-007)', () => {
  it('FR-LIB-003, FR-LIB-007, NFR-LIC-003: the checked-in files are the build of the exported source, with no problem', async () => {
    if (WRITE) {
      // a write run needs the variable and `-u` together: the variable alone (say, leaked into a gate) fails, never writes
      expect(expect.getState().snapshotState.snapshotUpdateState, 'VITE_FLUXION_WRITE_PACK=1 needs `vitest run -u`').toBe('all');
      const expected = shapePackExpectation(networkSource, checkedIn.versions);
      for (const [path, text] of Object.entries(expected.pack)) await expect(text).toMatchFileSnapshot(`../pack/${path}`);
      for (const [path, text] of Object.entries(expected.goldens)) await expect(text).toMatchFileSnapshot(`../__golden__/${path}`);
      await expect(expected.versions).toMatchFileSnapshot('../pack-versions.json');
      return;
    }
    expect(await checkShapePack(networkSource, checkedIn)).toEqual({ files: [], loading: [], brands: [], bounds: [], versions: [] });
  });
});
