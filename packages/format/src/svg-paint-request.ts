import { parseSvgArtwork } from '@fluxion/core';
import { type Diagnostic, err, ok, type Result, SVG_POLICY_LIMITS, type SvgArtwork } from '@fluxion/schema';
import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';
import { importFonts } from './svg-import-fonts.js';
import type { SvgImportFont, SvgPaintRequest } from './svg-import-types.js';
import { encodeUtf8 } from './utf8.js';

const invalid = (): Result<never, readonly Diagnostic[]> =>
  err([
    {
      code: 'FLX_SVG_IMPORT_INVALID',
      severity: 'error',
      path: '',
      message: 'paint request must be bounded canonical artwork with exact normalized font dependencies',
    },
  ]);

/** Inspect fixed envelopes before reading values; accessors and non-JSON fields are not capabilities. */
function fields(input: unknown, names: readonly string[]): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some((key) => typeof key !== 'string' || !names.includes(key))) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function face(input: unknown): SvgImportFont | undefined {
  const value = fields(input, ['family', 'weight', 'style', 'sha256']);
  if (!value || typeof value['family'] !== 'string' || typeof value['weight'] !== 'number' || typeof value['sha256'] !== 'string') return undefined;
  if (value['family'].length > 256 || value['sha256'].length !== 64) return undefined;
  const style = value['style'];
  if (style !== 'normal' && style !== 'italic') return undefined;
  return { family: value['family'], weight: value['weight'], style, sha256: value['sha256'] };
}

function faces(input: unknown): readonly SvgImportFont[] | undefined {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > SVG_POLICY_LIMITS.maxNodes) return undefined;
  if (Reflect.ownKeys(input).length !== input.length + 1) return undefined;
  const result: SvgImportFont[] = [];
  for (let i = 0; i < input.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, i);
    const parsed = descriptor && 'value' in descriptor ? face(descriptor.value) : undefined;
    if (!parsed) return undefined;
    result.push(parsed);
  }
  return result;
}

function construct(input: unknown, fontInput: unknown): Result<SvgPaintRequest, readonly Diagnostic[]> {
  const fonts = faces(fontInput);
  if (!fonts) return invalid();
  const artwork = parseSvgArtwork(input);
  if (!artwork.ok) return artwork;
  const resolved = importFonts(artwork.value.root, { fonts });
  if (resolved.error || canonicalJson(resolved.root) !== canonicalJson(artwork.value.root) || canonicalJson(resolved.fonts) !== canonicalJson(fonts))
    return invalid();
  const v = artwork.value.viewBox;
  const longest = Math.max(v.width, v.height);
  const raster = (length: number) => Math.max(1, Math.min(1024, Math.ceil((length / longest) * 1024)));
  const payload = { artwork: artwork.value, fonts, width: raster(v.width), height: raster(v.height) };
  return ok({ ...payload, identity: sha256Hex(encodeUtf8(canonicalJson(payload))) });
}

/**
 * Construct a request from normalized checked artwork and its exact used faces, sorted by hash.
 * Refuse missing, duplicate, unused or unnormalized faces/artwork; preserve the importer's canonical
 * raster and identity. Returned artwork and face metadata own their data independently of callers.
 * This pure operation is not a paint observation or verification of the font bytes.
 * @public
 */
export function createSvgPaintRequest(artwork: SvgArtwork, fonts: readonly SvgImportFont[]): Result<SvgPaintRequest, readonly Diagnostic[]> {
  try {
    return construct(artwork, fonts);
  } catch {
    return invalid();
  }
}

/**
 * Validate and snapshot an incoming request using the importer's authoritative constructor.
 * Supplied dimensions and identity must already be canonical; they are never silently repaired.
 * Actual theme resolution, exact font bytes and rendered paint remain the host witness's obligations.
 * @public
 */
export function parseSvgPaintRequest(input: unknown): Result<SvgPaintRequest, readonly Diagnostic[]> {
  try {
    const value = fields(input, ['artwork', 'fonts', 'width', 'height', 'identity']);
    if (!value) return invalid();
    const request = construct(value['artwork'], value['fonts']);
    if (!request.ok) return request;
    return value['identity'] === request.value.identity && value['width'] === request.value.width && value['height'] === request.value.height
      ? request
      : invalid();
  } catch {
    return invalid();
  }
}
