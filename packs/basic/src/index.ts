// Public entry of @fluxion/pack-basic; the package comment is the dts banner in tsdown.config.ts.
import { definePack, type Pack } from '@fluxion/sdk';
import { rect } from './shapes/rect.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/**
 * The basic shapes (FR-SHP-002), namespace `basic`. Hosts register it into their core registries
 * (ADR-0017): `basicPack.register(registries)`.
 *
 * @public
 */
export const basicPack: Pack = definePack({ id: 'basic', shapes: [rect] });

export { rect };
