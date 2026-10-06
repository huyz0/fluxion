// The repository's Lingui plugin (ADR-0023): no Babel. A module that imports a Lingui macro is compiled with the native
// transform (`@lingui/native-tools`); every other module is left to Oxc. A catalog (`locales/<locale>/messages.json`, ICU
// messages keyed by id) is served as a virtual module of compiled messages, so the ICU parser never ships to the browser.
// The same plugin object works in Vite (studio, Storybook, Vitest) and in tsdown (rolldown).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { transform } from '@lingui/native-tools';

const MACRO = /@lingui\/(?:core|react)\/macro/;
const SOURCE = /\.[cm]?[jt]sx?$/;
const VIRTUAL_PREFIX = '\0fluxion-catalog:';

/**
 * The compiled form of one catalog: `{ id: compiled message }` (arrays of tokens, JSON), as the runtime `i18n.load` takes them.
 *
 * @param {Record<string, { message: string }>} catalog the messages of a locale, as `messages.json` holds them
 * @returns {Record<string, unknown>}
 */
export function compileCatalog(catalog) {
  const out = {};
  for (const id of Object.keys(catalog).sort()) out[id] = compileMessage(catalog[id].message);
  return out;
}

/**
 * The source of a virtual module that exports `catalogs`, `{ <locale>: compiled catalog }` for every locale directory under `localesDir`.
 *
 * @param {string} localesDir `.../locales`
 * @returns {string}
 */
export function catalogModule(localesDir) {
  const locales = readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const all = Object.fromEntries(locales.map((l) => [l, compileCatalog(JSON.parse(readFileSync(join(localesDir, l, 'messages.json'), 'utf8')))]));
  return `export const catalogs = ${JSON.stringify(all)};\n`;
}

/**
 * @param {{ catalogs?: Record<string, string>, production?: boolean }} [options] `catalogs` maps a virtual module id (for example `virtual:fluxion/editor-messages`)
 *   to the `locales` directory it serves; `production` keeps only the message id in a descriptor (the catalog holds the text).
 */
export function lingui(options = {}) {
  const catalogs = options.catalogs ?? {};
  let production = options.production ?? false;
  return {
    name: 'fluxion:lingui',
    enforce: 'pre',
    configResolved(config) {
      if (options.production === undefined) production = config.isProduction;
    },
    resolveId(id) {
      return Object.hasOwn(catalogs, id) ? VIRTUAL_PREFIX + id : null;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;
      return catalogModule(catalogs[id.slice(VIRTUAL_PREFIX.length)]);
    },
    async transform(code, id) {
      const file = id.split('?')[0];
      if (!SOURCE.test(file) || file.includes('/node_modules/') || !MACRO.test(code)) return null;
      const result = await transform(code, file, {
        sourceMaps: true,
        macro: { descriptorFields: production ? 'id-only' : 'all' },
      });
      return { code: result.code, map: result.map ?? null };
    },
  };
}
