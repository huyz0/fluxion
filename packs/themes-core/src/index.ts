// Public entry of @fluxion/pack-themes-core; the package comment is the dts banner in tsdown.config.ts.
import { definePack, type Pack } from '@fluxion/sdk';
import { THEMES_CORE } from './themes.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

export { THEMES_CORE } from './themes.js';

/**
 * The built-in themes (FR-THM-003), namespace `themes-core`: light, dark, corporate, vibrant, pastel, high-contrast, blueprint and
 * chalkboard. Hosts register it into their core registries like any pack: `themesCorePack.register(registries)`.
 *
 * @public
 */
export const themesCorePack: Pack = definePack({ id: 'themes-core', themes: THEMES_CORE });
