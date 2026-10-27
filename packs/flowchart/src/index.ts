// Public entry of @fluxion/pack-flowchart; the package comment is the dts banner in tsdown.config.ts.
import { definePack, type Pack } from '@fluxion/sdk';
import { flowchartShapes } from './shapes.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/**
 * The flowchart shapes, namespace `flowchart`. Hosts register it into their core registries (ADR-0017), or load its
 * declarative distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const flowchartPack: Pack = definePack({ id: 'flowchart', shapes: flowchartShapes });

export { flowchartShapes };
