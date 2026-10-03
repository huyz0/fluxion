// The font sources of the studio's picker (FR-THM-008, M9.17): the bundled families, the Google Fonts catalog and its fetch, and
// the files a user uploads, all added to the open document through `addFont`.
import type { Core } from '@fluxion/core';
import { type AssetStore, addFont, type FontLibraryDeps, type FontOutcome, type FontSources } from '@fluxion/editor';
import { FONTS_CORE } from '@fluxion/pack-fonts-core';
import { createId, type Random } from '@fluxion/schema';
import { addGoogleFont, type CatalogFamily, type Fetch, loadCatalog } from './google-fonts.js';

/** The weights and styles asked of Google for a family: regular and bold, upright and italic, as far as the family has them. */
const WEIGHTS = [400, 700];
const STYLES = ['normal', 'italic'] as const;

/** The bundled families, once each, in the order the pack lists them. */
export const bundledFamilies = (): readonly string[] => [...new Set(FONTS_CORE.map((f) => f.family))];

/**
 * The picker's sources for the document of `core`: fonts are added through `assets` (the bytes) and `core.execute` (the record),
 * Google through `http`.
 */
export function fontSources(core: Core, assets: AssetStore, random: Random, http: Fetch = (url, init) => fetch(url, init)): FontSources {
  const deps: FontLibraryDeps = { execute: core.execute, assets, newId: () => createId(random) };
  let catalog: Promise<readonly CatalogFamily[]> | undefined;
  const families = () => {
    // a catalog that failed to load is asked for again next time
    catalog ??= loadCatalog().catch((error: unknown) => {
      catalog = undefined;
      throw error;
    });
    return catalog;
  };
  return {
    bundled: bundledFamilies(),
    catalog: async () => (await families()).map((f) => ({ family: f.family, category: f.category })),
    addGoogle: async (name): Promise<FontOutcome> => {
      const family = (await families()).find((f) => f.family === name);
      if (family === undefined) return { ok: false, message: `${name} is not in the catalog` };
      const added = await addGoogleFont(deps, http, family, { weights: WEIGHTS, styles: STYLES });
      return added.ok ? { ok: true, family: family.family } : { ok: false, message: added.error.message };
    },
    upload: async (file): Promise<FontOutcome> => {
      const added = await addFont(deps, { bytes: file.bytes, name: file.name, source: 'upload' });
      if (!added.ok) return { ok: false, message: added.error.message };
      const asset = core.store.get(added.value) as unknown as { font: { family: string } };
      return { ok: true, family: asset.font.family };
    },
  };
}
