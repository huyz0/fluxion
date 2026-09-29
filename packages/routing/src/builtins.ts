// The built-in routers (FR-RTE-001, FR-CON-002), registered through the same API as plugins.
import type { Registry } from '@fluxion/core';
import { curvedRouter, polylineRouter } from './curved.js';
import { type Router, straightRouter } from './router.js';

/**
 * Register the built-in routers (`straight`, `curved`, `polyline`) into `routers` (source `core`); a type another source already holds
 * keeps that source's router.
 *
 * @public
 */
export function registerBuiltinRouters(routers: Registry<string, Router>): void {
  routers.register('straight', straightRouter, 'core');
  routers.register('curved', curvedRouter, 'core');
  routers.register('polyline', polylineRouter, 'core');
}
