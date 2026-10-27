// One definition's visual golden (FR-LIB-007, ADR-0193): the definition drawn alone, at its default size
// and style, by the static renderer, as the normalized SVG the repository's goldens compare (NFR-REL-005).
import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { builtinRegistries, normalizeSvg } from '@fluxion/render';
import { renderDocumentToHtml } from '@fluxion/render/ssr';
import { documentBuilder } from '@fluxion/schema/testing';
import { registerShapeDef } from '../pack.js';

/** Space around the shape on its screen. */
const MARGIN = 20;

/**
 * The normalized SVG of `def` drawn alone, at its default size and style, `MARGIN` in from the top left
 * of a screen just large enough, with no text. Throws when the definition is not drawn: it does not
 * register, or its element has no outline with path data (an empty golden proves nothing).
 *
 * @public
 */
export function renderShapeGolden(def: ShapeDef): string {
  const { shapeDefs } = createCoreRegistries();
  const registered = registerShapeDef({ shapeDefs }, def, def.id.slice(0, def.id.indexOf(':')));
  if (!registered.ok) throw new Error(`${def.id}: does not register: ${registered.error.map((d) => `${d.path} ${d.message}`).join('; ')}`);
  const { w, h } = def.defaultSize;
  const doc = documentBuilder({ title: def.id });
  const screen = doc.screen({ size: { w: Math.ceil(w + 2 * MARGIN), h: Math.ceil(h + 2 * MARGIN) } });
  doc.rect(screen, { x: MARGIN, y: MARGIN, w, h, defId: def.id, ...(def.defaultStyle ? { style: def.defaultStyle } : {}) });
  const svg = normalizeSvg(renderDocumentToHtml(doc.build(), { registries: builtinRegistries(shapeDefs) }).html);
  if (!/<path class="fx-outline" d="M[^"]+"/.test(svg)) throw new Error(`${def.id}: renders no outline`);
  return svg;
}
