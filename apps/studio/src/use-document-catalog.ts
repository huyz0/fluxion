// The first-party packs' catalog of an open document (FR-LIB-009, M18.32) and their connector types in its routers (M18.251),
// as React hooks of the studio's App.
import type { Core, Registry } from '@fluxion/core';
import { embeddedConnectors } from '@fluxion/format';
import type { Router } from '@fluxion/routing';
import { useEffect, useMemo, useState } from 'react';
import { studioLogger } from './dev-logger.js';
import { webHasher } from './file-session.js';
import { bundledPackCatalog, type DocumentCatalog, documentCatalog, type PackCatalog, registerPackConnectors, usedDefIds } from './pack-catalog.js';

/**
 * The first-party packs' catalog for an open document (M18.32): read once per page, then the definitions the document already
 * uses are loaded, so a document saved without its pack geometry (autosave, an example) draws them.
 */
export function useDocumentCatalog(
  core: Core | undefined,
  saved: readonly { readonly id: string }[],
  /** The first-party packs' read; a port so a test can make it reject (M18.261). */
  readPacks: (hasher: typeof webHasher) => Promise<PackCatalog> = bundledPackCatalog,
): DocumentCatalog | undefined {
  const [packs, setPacks] = useState<PackCatalog | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const logger = studioLogger(window.location.search, console).child('studio');
    readPacks(webHasher).then(
      (p) => {
        if (!live) return;
        for (const refused of p.refused) logger.log('error', 'a first-party pack was refused', { refused });
        setPacks(p);
      },
      // no rejection goes unhandled; the next open reads the catalog again (M18.216)
      (error: unknown) => logger.log('error', 'the first-party packs could not be read', { error: String(error) }),
    );
    return () => {
      live = false;
    };
  }, [readPacks]);
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

/**
 * The first-party packs' connector types in `routers` (an open document's) while it is open (M18.251), except the namespaces
 * the opened file's `entries` carry their own types for (`connectors/<pack>.json`), so a pack connector can be chosen before
 * any save. A refused pack is logged and its connectors drawn as an unknown type. True once they are registered (or there is
 * no document): the document is shown only then, since a drawn route does not follow later router changes.
 */
export function usePackConnectors(routers: Registry<string, Router> | undefined, entries: ReadonlyMap<string, Uint8Array> | undefined): boolean {
  const [ready, setReady] = useState<Registry<string, Router> | undefined>(undefined);
  useEffect(() => {
    if (routers === undefined) return;
    let registered: { dispose(): void } | undefined;
    let live = true;
    const embedded = new Set(embeddedConnectors(entries).map((c) => c.pack));
    const logger = studioLogger(window.location.search, console).child('studio');
    void bundledPackCatalog(webHasher)
      .then((packs) => {
        if (live) registered = registerPackConnectors(packs, routers, embedded, (message) => logger.log('warn', message));
      })
      // a catalog that cannot be read leaves pack connectors drawn as unknown types, never the document unshown
      .catch((error: unknown) => logger.log('error', 'the first-party packs could not be read', { error: String(error) }))
      .finally(() => {
        if (live) setReady(routers);
      });
    return () => {
      live = false;
      registered?.dispose();
      // not shown again until the next registration (a StrictMode remount) is in
      setReady(undefined);
    };
  }, [routers, entries]);
  return routers === undefined || ready === routers;
}
