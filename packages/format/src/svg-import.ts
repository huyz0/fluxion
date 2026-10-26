import { parseShapeDef, parseSvgArtwork } from '@fluxion/core';
import { type Diagnostic, err, ok, type Result, type SvgArtwork } from '@fluxion/schema';
import { canonicalJson } from './canonical-json.js';
import { inspectSvgTree } from './sanitize-svg.js';
import { sha256Hex } from './sha256.js';
import { importFonts } from './svg-import-fonts.js';
import { importRouting, importViewport } from './svg-import-geometry.js';
import type { SvgImportOptions, SvgImportResult, SvgPaintReceipt, SvgPaintRequest } from './svg-import-types.js';
import { encodeUtf8 } from './utf8.js';

export type { SvgImportFont, SvgImportOptions, SvgImportResult, SvgPaintReceipt, SvgPaintRequest, SvgPaintWitness } from './svg-import-types.js';

const unsupported = (message: string): Result<never, readonly Diagnostic[]> =>
  err([{ code: 'FLX_SVG_IMPORT_UNSUPPORTED', severity: 'error', path: '', message }]);
function colorContext(options: SvgImportOptions): boolean {
  return Object.values(options.colors ?? {}).every((ref) => options.tokenRefs?.has(ref));
}
function requestFor(artwork: SvgArtwork, fonts: SvgPaintRequest['fonts']): SvgPaintRequest {
  const v = artwork.viewBox;
  const longest = Math.max(v.width, v.height);
  const raster = (length: number) => Math.max(1, Math.min(1024, Math.ceil((length / longest) * 1024)));
  const payload = { artwork, fonts, width: raster(v.width), height: raster(v.height) };
  return { ...payload, identity: sha256Hex(encodeUtf8(canonicalJson(payload))) };
}
function matches(receipt: SvgPaintReceipt, request: SvgPaintRequest): boolean {
  const hashes = receipt?.fontHashes;
  return (
    receipt?.status === 'painted' &&
    receipt.identity === request.identity &&
    Array.isArray(hashes) &&
    hashes.length === request.fonts.length &&
    new Set(hashes).size === hashes.length &&
    request.fonts.every((f) => hashes.includes(f.sha256))
  );
}
/**
 * Convert a single SVG using core validation and an explicit bounded real-renderer witness.
 * Retains source paint; complex routing uses a diagnosed clipped-viewport rectangle.
 * Returned font dependencies must be preserved by the installing/saving host. This is not pack distribution.
 * @public
 */
export async function importSvgShape(input: string, options: SvgImportOptions): Promise<Result<SvgImportResult, readonly Diagnostic[]>> {
  const inspected = inspectSvgTree(input);
  if (!inspected || inspected.removed)
    return err([{ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '', message: 'SVG is missing, oversized or requires sanitizer removals' }]);
  const viewBox = importViewport(inspected.root);
  if (!viewBox) return unsupported('unsupported-viewport: positive finite absolute dimensions or a viewBox are required');
  if (!colorContext(options)) return unsupported('unknown-color-token');
  const initial = parseSvgArtwork({ root: inspected.root, viewBox, ...(options.colors ? { colors: options.colors } : {}) });
  if (!initial.ok) return initial;
  const resolved = importFonts(initial.value.root, options);
  if (resolved.error) return unsupported(resolved.error);
  const paint = parseSvgArtwork({ ...initial.value, root: resolved.root });
  if (!paint.ok) return paint;
  const routing = importRouting(paint.value);
  const definition = parseShapeDef({
    id: options.id,
    artwork: paint.value,
    outline: routing.outline,
    anchors: routing.anchors,
    defaultSize: { w: viewBox.width, h: viewBox.height },
  });
  if (!definition.ok) return definition;
  const request = requestFor(paint.value, resolved.fonts);
  let receipt: SvgPaintReceipt;
  try {
    // The port gets an isolated copy; accidental mutations cannot alter the private candidate.
    receipt = await options.witness(JSON.parse(JSON.stringify(request)) as SvgPaintRequest);
  } catch {
    return unsupported('paint-witness-unavailable');
  }
  if (!matches(receipt, request)) return unsupported('no-visible-witness-or-font-identity-mismatch');
  const diagnostics: readonly Diagnostic[] = routing.exact
    ? []
    : [
        {
          code: 'FLX_SVG_OUTLINE_FALLBACK',
          severity: 'warning',
          path: '/outline',
          message: 'viewport-clipped: conservative routing rectangle, not a tight paint silhouette',
        },
      ];
  return ok({ definition: definition.value, diagnostics, fonts: resolved.fonts });
}
