// The colour and extension codec of theme files (ADR-0055, package-internal): a literal CSS colour as a DTCG colour object and
// back, and the `dev.fluxion.css` text that keeps a round trip exact. Editor/CLI path only.

import { namedColorHex } from './named-colors.js';
import { oklchToCss, parseColor } from './oklch.js';
import type { Token } from './tokens.js';

export const FLUXION = 'dev.fluxion';

export type Json = { [key: string]: unknown };
export const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const hex2 = (byte: number): string => byte.toString(16).padStart(2, '0');

/** A colour that import rebuilds exactly from its DTCG object. */
type Rgba = { readonly rgb: readonly [number, number, number]; readonly alpha: number };

/** The bytes of `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, of a named colour or `transparent`, of `rgb()` or `hsl()`; else undefined. */
function rgbaOf(text: string): Rgba | undefined {
  const t = text.trim().toLowerCase();
  if (t === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t)?.[1] ?? namedColorHex(t);
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map((d) => d + d).join('') : hex;
    const bytes = [0, 2, 4, 6].map((i) => (i < full.length ? Number.parseInt(full.slice(i, i + 2), 16) : 255));
    return { rgb: [bytes[0] as number, bytes[1] as number, bytes[2] as number], alpha: (bytes[3] as number) / 255 };
  }
  if (!/^(rgb|hsl)a?\(/.test(t)) return undefined;
  const color = parseColor(t);
  if (color === undefined) return undefined;
  // the sRGB bytes of the colour, opaque, then its own alpha
  const opaque = oklchToCss({ ...color, alpha: 1 });
  const bytes = [1, 3, 5].map((i) => Number.parseInt(opaque.slice(i, i + 2), 16));
  return { rgb: [bytes[0] as number, bytes[1] as number, bytes[2] as number], alpha: color.alpha };
}

/** The CSS text import writes for an sRGB colour: `#rrggbb`, with `aa` when it is not opaque. */
function srgbText(rgb: readonly number[], alpha: number): string {
  const aa = Math.round(alpha * 255);
  return `#${rgb.map(hex2).join('')}${aa === 255 ? '' : hex2(aa)}`;
}

/** The alpha and three components of a DTCG colour object, or undefined when they are malformed. */
function channelsOf(value: Json): { readonly alpha: number; readonly parts: readonly [number, number, number] } | undefined {
  const alpha = value['alpha'] === undefined ? 1 : value['alpha'];
  const parts = value['components'];
  if (typeof alpha !== 'number' || alpha < 0 || alpha > 1) return undefined;
  // a component may be DTCG's "none" (a powerless channel), read as 0
  const read = Array.isArray(parts) ? parts.map((p) => (p === 'none' ? 0 : p)) : [];
  if (read.length !== 3 || !read.every((p) => typeof p === 'number' && Number.isFinite(p))) return undefined;
  return { alpha, parts: read as [number, number, number] };
}

/** The sRGB bytes of a colour object: from its `hex` when that is `#rrggbb`, else from its components. */
function srgbBytes(value: Json, parts: readonly number[]): number[] {
  const hex = typeof value['hex'] === 'string' && /^#[0-9a-f]{6}$/i.test(value['hex']) ? value['hex'] : undefined;
  if (hex !== undefined) return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return parts.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
}

/** The CSS text of a DTCG colour object, or undefined when it is not one this reader knows. */
export function colorText(value: unknown): string | undefined {
  const channels = isObject(value) ? channelsOf(value) : undefined;
  if (!isObject(value) || channels === undefined) return undefined;
  const { alpha, parts } = channels;
  if (value['colorSpace'] === 'srgb') return srgbText(srgbBytes(value, parts), alpha);
  const fn = value['colorSpace'] === 'oklch' || value['colorSpace'] === 'oklab' ? value['colorSpace'] : undefined;
  return fn === undefined ? undefined : `${fn}(${parts.join(' ')}${alpha === 1 ? '' : ` / ${alpha}`})`;
}

/** The DTCG colour object of a literal CSS colour, or undefined when the format has no colour space for its form. */
export function colorObject(text: string): Json | undefined {
  const rgba = rgbaOf(text);
  if (rgba !== undefined) {
    return {
      colorSpace: 'srgb',
      components: rgba.rgb.map((v) => round4(v / 255)),
      alpha: round4(Math.round(rgba.alpha * 255) / 255),
      hex: `#${rgba.rgb.map(hex2).join('')}`,
    };
  }
  const fn = /^\s*(oklch|oklab)a?\(/i.exec(text)?.[1]?.toLowerCase();
  const color = fn === undefined ? undefined : parseColor(text);
  if (color === undefined) return undefined;
  const rad = (color.h * Math.PI) / 180;
  const components = fn === 'oklch' ? [color.l, color.c, color.h] : [color.l, color.c * Math.cos(rad), color.c * Math.sin(rad)];
  return { colorSpace: fn, components: components.map(round4), alpha: round4(color.alpha) };
}

/** `ext` with `dev.fluxion.css` set to `css` when the colour object does not rebuild `text` exactly. */
export function withCss(ext: Token['$extensions'], text: string, object: Json): Json | undefined {
  if (colorText(object) === text) return ext === undefined ? undefined : { ...ext };
  const own = isObject(ext?.[FLUXION]) ? (ext?.[FLUXION] as Json) : {};
  return { ...ext, [FLUXION]: { ...own, css: text } };
}

/** `ext` without `dev.fluxion.css` (and without what that leaves empty), and the css text it held. */
export function withoutCss(ext: unknown): { readonly ext: Json | undefined; readonly css: string | undefined } {
  if (!isObject(ext) || !isObject(ext[FLUXION]) || !('css' in ext[FLUXION])) return { ext: isObject(ext) ? ext : undefined, css: undefined };
  const { css, ...own } = ext[FLUXION];
  const { [FLUXION]: _dropped, ...rest } = ext;
  const next = Object.keys(own).length > 0 ? { ...rest, [FLUXION]: own } : rest;
  return { ext: Object.keys(next).length > 0 ? next : undefined, css: typeof css === 'string' ? css : undefined };
}
