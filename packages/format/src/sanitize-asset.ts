// Asset bytes that become markup (NFR-SEC-001, ADR-0025): an SVG goes through `sanitizeSvg` before it is drawn, saved as a new asset or
// shown in a preview. Every other media type is bytes the browser decodes as an image, a font or a video: nothing here changes them.
import type { FluxAsset } from './flux-writer.js';
import { inspectSvg, MAX_SVG_CHARS } from './sanitize-svg.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

/**
 * The asset as it may be put in a page: an SVG rebuilt from the allowlist (its media type kept), any other asset as it is. Undefined when
 * an SVG is refused (too large, not SVG, nothing safe left to show).
 *
 * @public
 */
export function sanitizeAsset(asset: FluxAsset): FluxAsset | undefined {
  if (asset.mime !== 'image/svg+xml') return asset;
  const clean = inspectSvg(decodeUtf8(asset.bytes));
  return clean === undefined ? undefined : { ...asset, bytes: encodeUtf8(clean.svg) };
}

/**
 * What drawing an asset would do to it.
 *
 * @public
 */
export type AssetCheck = 'clean' | 'changed' | 'refused';

/**
 * Whether drawing `asset` would change it, for a note to the person who opens the file: `refused` for an SVG that cannot be drawn at all,
 * `changed` for an SVG with something the allowlist removes (an element, a handler, a URL, a style declaration, a doctype), `clean` for
 * the rest. The answer comes from the sanitizer itself, so it cannot disagree with what is drawn.
 *
 * @public
 */
export function checkAsset(asset: FluxAsset): AssetCheck {
  if (asset.mime !== 'image/svg+xml') return 'clean';
  // a character is at most four bytes: more than four times the cap in bytes cannot be within the cap in characters
  if (asset.bytes.length > 4 * MAX_SVG_CHARS) return 'refused';
  const inspected = inspectSvg(decodeUtf8(asset.bytes));
  if (inspected === undefined) return 'refused';
  return inspected.removed > 0 ? 'changed' : 'clean';
}
