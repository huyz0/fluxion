// The first-party packs' catalog of an open document (FR-LIB-009, M18.32), as a React hook of the studio's App.
import type { Core } from '@fluxion/core';
import { useEffect, useMemo, useState } from 'react';
import { studioLogger } from './dev-logger.js';
import { webHasher } from './file-session.js';
import { bundledPackCatalog, type DocumentCatalog, documentCatalog, type PackCatalog, usedDefIds } from './pack-catalog.js';

/**
 * The first-party packs' catalog for an open document (M18.32): read once per page, then the definitions the document already
 * uses are loaded, so a document saved without its pack geometry (autosave, an example) draws them.
 */
export function useDocumentCatalog(core: Core | undefined, saved: readonly { readonly id: string }[]): DocumentCatalog | undefined {
  const [packs, setPacks] = useState<PackCatalog | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void bundledPackCatalog(webHasher).then((p) => {
      if (!live) return;
      for (const refused of p.refused)
        studioLogger(window.location.search, console).child('studio').log('error', 'a first-party pack was refused', { refused });
      setPacks(p);
    });
    return () => {
      live = false;
    };
  }, []);
  const catalog = useMemo(() => {
    if (core === undefined || packs === undefined) return undefined;
    const logger = studioLogger(window.location.search, console).child('studio');
    return documentCatalog(packs, core.registries.shapeDefs, new Set(saved.map((s) => s.id)), (message) => logger.log('warn', message));
  }, [core, packs, saved]);
  useEffect(() => {
    if (catalog !== undefined && core !== undefined) void catalog.resolve(usedDefIds(core.store.toDocument().records));
  }, [catalog, core]);
  return catalog;
}
