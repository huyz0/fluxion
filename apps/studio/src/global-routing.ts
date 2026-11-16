// The studio's global routing pass (FR-RTE-003, M16.28), as a hook over an open document; moved out of App.tsx at M19.29.
import { type Core, writable } from '@fluxion/core';
import { createGlobalRouting, type GlobalRouting } from '@fluxion/editor';
import { useEffect, useMemo } from 'react';
import type { OpenDocument } from './bootstrap.js';
import { createRoutePort } from './route-port.js';

/**
 * `registries` with the global routing pass's routes (FR-RTE-003): once the document settles, a routing worker routes every orthogonal
 * connector as one batch and the editor draws those routes while the document is unchanged; they are the routes present mode and the
 * `.flux.html` draw (M16.28). The worker ends when the document closes.
 */
export function useGlobalRouting(core: Core, registries: OpenDocument['registries']): OpenDocument['registries'] {
  // the pass and its worker belong to the effect (a StrictMode remount disposes one, starts the next); registries read it via `live`
  const live = useMemo(() => writable<{ readonly refined: GlobalRouting['refined'] } | undefined>(undefined), [core, registries]);
  useEffect(() => {
    const port = createRoutePort();
    const global = createGlobalRouting(core.store, registries, port);
    live.set({ refined: global.refined });
    return () => {
      live.set(undefined);
      global.dispose();
      port.dispose();
    };
  }, [core, registries, live]);
  return useMemo(() => ({ ...registries, refined: () => live.get()?.refined() }), [registries, live]);
}
