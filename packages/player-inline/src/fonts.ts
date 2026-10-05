// The fonts a `.flux` carries (FR-THM-008, FR-FIL-002, M10.32): each font asset becomes a `FontFace` made from the file's own bytes (never a URL, so no
// `font-src` is needed under the file's CSP), and once the faces have loaded their recorded metrics (ADR-0148) are registered, so the page measures
// text as the studio did when it saved. A face that does not load is skipped: its text is drawn in a fallback, as in any browser.
import type { FaceMetrics } from '@fluxion/core';
import type { LoadedFlux } from '@fluxion/format/player';
import { registerFontMetrics } from '@fluxion/player';

type FontMeta = {
  readonly family?: unknown;
  readonly weight?: unknown;
  readonly style?: unknown;
  readonly unicodeRange?: unknown;
  readonly metrics?: unknown;
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** An object whose every value is a finite number. */
const numbers = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(finite);

/** A recorded table is used only when it has the shape the measurer reads, with finite numbers throughout: a file is not trusted to hold a well-formed one. */
function metricsOf(meta: FontMeta, family: string, weight: number, style: 'normal' | 'italic'): FaceMetrics | undefined {
  const m = meta.metrics as Partial<FaceMetrics> | undefined;
  if (m === undefined || !finite(m.unitsPerEm) || !(m.unitsPerEm > 0) || !finite(m.defaultAdvance) || m.defaultAdvance < 0) return undefined;
  if (!numbers(m.advances) || !numbers(m.pairs) || !numbers(m.triples)) return undefined;
  return { ...(m as FaceMetrics), family, weight, style };
}

type Embedded = { readonly family: string; readonly weight: number; readonly style: 'normal' | 'italic'; readonly bytes: Uint8Array; readonly meta: FontMeta };

/** The font assets of `loaded` that carry a family and a weight, with their bytes. */
function embeddedFonts(loaded: LoadedFlux): Embedded[] {
  const out: Embedded[] = [];
  for (const record of Object.values(loaded.document.records)) {
    if (record.type !== 'asset') continue;
    const meta = (record as { font?: FontMeta }).font;
    const bytes = loaded.assets.get((record as { hash: string }).hash)?.bytes;
    if (typeof meta !== 'object' || meta === null || bytes === undefined || typeof meta.family !== 'string' || typeof meta.weight !== 'number') continue;
    out.push({ family: meta.family, weight: meta.weight, style: meta.style === 'italic' ? 'italic' : 'normal', bytes, meta });
  }
  return out;
}

/**
 * Load the font assets of `loaded` into the page. Resolves when every face has loaded or failed; `release` takes the faces out again.
 *
 * @internal
 */
export async function loadEmbeddedFonts(
  loaded: LoadedFlux,
  deps: { readonly fonts?: FontFaceSet; readonly register?: (faces: readonly FaceMetrics[]) => () => void } = {},
): Promise<{ readonly release: () => void }> {
  const fonts = deps.fonts ?? document.fonts;
  const faces: FontFace[] = [];
  const metrics: FaceMetrics[] = [];
  const loading: Promise<void>[] = [];
  for (const { family, weight, style, bytes, meta } of embeddedFonts(loaded)) {
    try {
      const face = new FontFace(family, bytes.slice().buffer, {
        weight: String(weight),
        style,
        ...(typeof meta.unicodeRange === 'string' && { unicodeRange: meta.unicodeRange }),
      });
      const table = metricsOf(meta, family, weight, style);
      fonts.add(face);
      faces.push(face);
      loading.push(
        face.load().then(
          () => void (table !== undefined && metrics.push(table)),
          () => void fonts.delete(face),
        ),
      );
    } catch {
      // a family the browser cannot take: the text falls back
    }
  }
  await Promise.all(loading);
  const unregister = metrics.length > 0 ? (deps.register ?? registerFontMetrics)(metrics) : undefined;
  return {
    release: () => {
      unregister?.();
      for (const f of faces) fonts.delete(f);
    },
  };
}
