// One definition's visual golden (FR-LIB-007, ADR-0193): the definition drawn alone, at its default size
// and style, by the static renderer, as the normalized SVG the repository's goldens compare (NFR-REL-005). Artwork text of a 1.1
// definition is drawn under its exact fonts' private aliases (ADR-0192), so the golden names the bytes it needs.
import { type ArtworkFontBinding, createCoreRegistries, createRegistry, type ShapeDef } from '@fluxion/core';
import { builtinRegistries, normalizeSvg } from '@fluxion/render';
import { renderDocumentToHtml } from '@fluxion/render/ssr';
import { documentBuilder } from '@fluxion/schema/testing';
import { registerShapeDef } from '../pack.js';

/** A drawing element with the geometry it needs: path data, points, a size or a radius, or a second end (cp20 F4); or text with content, drawn only under its bound alias (M18.81). */
const DRAWN_ELEMENT =
  '<(?:path\\b[^>]*\\sd="[^"]+"|(?:polyline|polygon)\\b[^>]*\\spoints="[^"]+"|rect\\b[^>]*\\swidth="[^"]+"|circle\\b[^>]*\\sr="[^"]+"|ellipse\\b[^>]*\\srx="[^"]+"|line\\b[^>]*\\sx2="[^"]+"|text\\b[^>]*>(?:\\s*<tspan\\b[^>]*>)*[^<]*[^<\\s])';
/** An artwork viewport with a drawn element before it closes (M18.29: imported icons draw artwork, not an outline). */
const ARTWORK_DRAWN = new RegExp(`<svg[^>]*class="fx-artwork"[^>]*>(?:(?!</svg>)[\\s\\S])*?${DRAWN_ELEMENT}`);
/** Space around the shape on its screen. */
const MARGIN = 20;

/**
 * The normalized SVG of `def` drawn alone, at its default size and style, `MARGIN` in from the top left
 * of a screen just large enough, with no text. A 1.1 definition's artwork text is drawn under `fonts`, its alias
 * bindings (none drops that text, as a host without the bytes would). Throws when the definition is not drawn: it does
 * not register, or its element has no outline with path data, or, for imported artwork (which replaces the
 * outline), no artwork viewport holding a drawn element (an empty golden proves nothing).
 *
 * @public
 */
export function renderShapeGolden(def: ShapeDef, fonts: readonly ArtworkFontBinding[] = []): string {
  const { shapeDefs } = createCoreRegistries();
  const registered = registerShapeDef({ shapeDefs }, def, def.id.slice(0, def.id.indexOf(':')));
  if (!registered.ok) throw new Error(`${def.id}: does not register: ${registered.error.map((d) => `${d.path} ${d.message}`).join('; ')}`);
  const { w, h } = def.defaultSize;
  const doc = documentBuilder({ title: def.id });
  const screen = doc.screen({ size: { w: Math.ceil(w + 2 * MARGIN), h: Math.ceil(h + 2 * MARGIN) } });
  doc.rect(screen, { x: MARGIN, y: MARGIN, w, h, defId: def.id, ...(def.defaultStyle ? { style: def.defaultStyle } : {}) });
  const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
  if (fonts.length) artworkFonts.register(def.id, fonts, def.id.slice(0, def.id.indexOf(':')));
  const svg = normalizeSvg(renderDocumentToHtml(doc.build(), { registries: builtinRegistries(shapeDefs, undefined, undefined, artworkFonts) }).html);
  if (def.artwork) {
    if (!ARTWORK_DRAWN.test(svg)) throw new Error(`${def.id}: renders no artwork`);
  } else if (!/<path class="fx-outline" d="M[^"]+"/.test(svg)) throw new Error(`${def.id}: renders no outline`);
  return svg;
}
