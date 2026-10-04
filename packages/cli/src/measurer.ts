// How the command line measures text (FR-TXT-002, ADR-0148, M10.33): with the recorded metrics of the bundled fonts and of the fonts the document
// embeds, the same tables the browser adds up once the faces have loaded, and at a fixed advance for any other font. So `fluxion render` fits text
// to a shape as the studio does, without a canvas.
import { FONT_METRICS } from '@fluxion/pack-fonts-core';
import { serverMeasurer } from '@fluxion/render';
import type { DocumentFile } from '@fluxion/schema';
import { readFontMetrics } from '@fluxion/sdk';

/** The recorded metrics the document's own font assets carry (a table that is not well formed is left out). */
function embeddedMetrics(document: DocumentFile) {
  const tables = Object.values(document.records).flatMap((r) => (r.type === 'asset' ? [(r as { font?: { metrics?: unknown } }).font?.metrics] : []));
  return readFontMetrics({ faces: tables }).faces;
}

/**
 * The measurer for `document`: the document's embedded fonts' metrics (which win for the same face), then the bundled fonts', then the fixed advance.
 *
 * @public
 */
export function measurerFor(document: DocumentFile): ReturnType<typeof serverMeasurer> {
  // the document's own tables first: for a face both have, the first of equal distance is the one used
  return serverMeasurer([...embeddedMetrics(document), ...FONT_METRICS]);
}
