// The catalogs the plugin serves, as virtual modules: one per package with UI (ADR-0023). Every Vite and tsdown config imports this list.
import { fileURLToPath } from 'node:url';

const at = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export const i18nCatalogs = {
  'virtual:fluxion/editor-messages': at('packages/editor/src/locales'),
};
