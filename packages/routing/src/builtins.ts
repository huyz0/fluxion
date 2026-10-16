// The built-in routers (FR-RTE-001, FR-CON-002), registered through the same API as plugins.
import type { Registry } from '@fluxion/core';
import { curvedRouter, polylineRouter } from './curved.js';
import { orthogonalRouter } from './orthogonal.js';
import { type Router, straightRouter } from './router.js';

/**
 * Register the built-in routers (`straight`, `curved`, `polyline`, `orthogonal`) into `routers` (source `core`); a type another source already holds
 * keeps that source's router. Returns the first refusal (a dev host's `requireDescribe`), else the last success.
 *
 * @public
 */
export function registerBuiltinRouters(routers: Registry<string, Router>): ReturnType<Registry<string, Router>['register']> {
  // every built-in is tried; the first refusal is what comes back (the others stay registered), else the last success
  const results = [
    routers.register('straight', straightRouter, 'core'),
    routers.register('curved', curvedRouter, 'core'),
    routers.register('polyline', polylineRouter, 'core'),
    routers.register('orthogonal', orthogonalRouter, 'core'),
  ];
  return results.find((r) => !r.ok) ?? (results[results.length - 1] as (typeof results)[number]);
}
