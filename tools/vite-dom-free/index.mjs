// Vite aliases that keep a browser bundle off a DOM-touching entry (ADR-0040): `decode-named-character-reference`, reached through
// `mdast-util-from-markdown`, maps its `browser` export condition to `index.dom.js`, which calls `document.createElement` at load and so
// fails in a worker or a server render. The plain `index.js` has the same table and no DOM.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** The DOM-free entry, or nothing in a tree without `@fluxion/dsl` (the harness sandboxes copy this file, not the packages). */
function plainEntry() {
  const manifest = fileURLToPath(new URL('../../packages/dsl/package.json', import.meta.url));
  if (!existsSync(manifest)) return undefined;
  const fromDsl = createRequire(manifest);
  return createRequire(fromDsl.resolve('mdast-util-from-markdown')).resolve('decode-named-character-reference');
}

const entry = plainEntry();

/** `resolve.alias` entries: the package name to its DOM-free entry (the CommonJS `default` condition, which is `index.js`). */
export const domFreeAliases = entry === undefined ? [] : [{ find: /^decode-named-character-reference$/, replacement: entry }];
