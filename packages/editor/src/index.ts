// Public entry of @fluxion/editor; the package comment is the dts banner in tsdown.config.ts.

export { EditorRoot, type EditorRootProps } from './editor-root.js';
export { LAYOUT_KEY } from './layout.js';
export { newDocument } from './new-document.js';
export { memorySettings, type SettingsStore } from './settings.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
