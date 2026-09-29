// Resolved styles (FR-THM-001/002, 02 §Style, ADR-0015): an element's style becomes CSS-ready values.
// Each field resolves through layers, first match wins: element literal or token ref → theme
// `defaults[kind].variants[variant]` → `defaults[kind]` → `defaults['*']` (theme globals) → built-in
// fallbacks. A token ref becomes `var(--fx-<path>)`, with no value of its own, so a change of token values
// restyles through the screen's CSS variables alone (ADR-0015 amendment, M5.13); an unknown token is
// reported (FLX_TOKEN_UNKNOWN) and the next layer is used.
import type { Diagnostic, Style } from '@fluxion/schema';
import { effectsOf, type ResolvedEffect, type ResolvedShadow, shadowsOf } from './effects.js';
import { finiteIn, isObject, type Layer, Resolver } from './resolver.js';
import type { Theme } from './tokens.js';

/**
 * A colour fill as CSS (a literal or `var(…)`).
 *
 * @public
 */
export type ResolvedColorPaint = {
  /** Paint type. */
  readonly type: 'color';
  /** The CSS colour. */
  readonly css: string;
};

/**
 * One gradient stop with its colour as CSS.
 *
 * @public
 */
export type ResolvedStop = {
  /** Position along the gradient, 0–1. */
  readonly offset: number;
  /** The CSS colour. */
  readonly css: string;
};

/**
 * A gradient fill with resolved stops.
 *
 * @public
 */
export type ResolvedGradientPaint = {
  /** Paint type. */
  readonly type: 'linear-gradient' | 'radial-gradient';
  /** Degrees (linear; 0 = left to right). */
  readonly angle: number;
  /** Stops sorted by offset. */
  readonly stops: readonly ResolvedStop[];
};

/**
 * An image fill from a document asset.
 *
 * @public
 */
export type ResolvedImagePaint = {
  /** Paint type. */
  readonly type: 'image';
  /** The asset record id. */
  readonly assetId: string;
  /** How the image fills the area. */
  readonly fit: 'cover' | 'contain' | 'fill' | 'tile';
};

/**
 * No fill.
 *
 * @public
 */
export type NoPaint = {
  /** Paint type. */
  readonly type: 'none';
};

/**
 * A resolved fill: a CSS colour (literal or `var(…)`), a gradient with resolved stop colours, an image
 * asset, or nothing.
 *
 * @public
 */
export type ResolvedPaint = ResolvedColorPaint | ResolvedGradientPaint | ResolvedImagePaint | NoPaint;

/**
 * A resolved outline.
 *
 * @public
 */
export type ResolvedStroke = {
  /** CSS colour. */
  readonly color: string;
  /** Width (px or `var(…)`). */
  readonly width: string;
  /** Dash pattern as SVG `stroke-dasharray` (`4 2`), when dashed. */
  readonly dash?: string;
  /** Line cap. */
  readonly cap: string;
  /** Line join. */
  readonly join: string;
  /** `center`, `inside` or `outside` the outline (ADR-0019). */
  readonly align: string;
};

/**
 * Resolved text styling.
 *
 * @public
 */
export type ResolvedFont = {
  /** CSS font-family. */
  readonly family: string;
  /** Size (px or `var(…)`). */
  readonly size: string;
  /** Weight. */
  readonly weight: string;
  /** Line height, unitless. */
  readonly lineHeight: string;
  /** Text colour. */
  readonly color: string;
  /** `normal` or `italic`. */
  readonly style: string;
  /** Horizontal alignment. */
  readonly align: string;
  /** Vertical alignment. */
  readonly verticalAlign: string;
};

/**
 * An element's style as CSS values: every field set, token refs as `var(--fx-…)`.
 *
 * @public
 */
export type ResolvedStyle = {
  /** Fill paint. */
  readonly fill: ResolvedPaint;
  /** Outline. */
  readonly stroke: ResolvedStroke;
  /** Opacity, unitless. */
  readonly opacity: string;
  /** Corner radius (px). */
  readonly radius: string;
  /** Text styling. */
  readonly font: ResolvedFont;
  /** Shadows, painted in order (M5.34). */
  readonly shadows: readonly ResolvedShadow[];
  /** Effects, applied in order (M5.34). */
  readonly effects: readonly ResolvedEffect[];
};

/**
 * A style and what resolving it reported.
 *
 * @public
 */
export type StyleResolution = {
  /** The resolved style. */
  readonly style: ResolvedStyle;
  /** FLX_TOKEN_UNKNOWN warnings, one per unknown reference, at its JSON pointer. */
  readonly diagnostics: readonly Diagnostic[];
};

/** Built-in fallbacks: the last layer, so every field has a value even with an empty theme. */
const FALLBACK = {
  fill: 'transparent',
  background: 'transparent',
  stroke: { color: 'currentColor', width: 1, cap: 'butt', join: 'miter', align: 'center' },
  opacity: 1,
  radius: 0,
  font: { family: 'sans-serif', size: 16, weight: 400, lineHeight: 1.2, color: 'currentColor', style: 'normal', align: 'center', verticalAlign: 'middle' },
} as const;

const CAPS: ReadonlySet<string> = new Set(['butt', 'round', 'square']);
const JOINS: ReadonlySet<string> = new Set(['miter', 'round', 'bevel']);
const ALIGNS_STROKE: ReadonlySet<string> = new Set(['center', 'inside', 'outside']);
const FONT_STYLES: ReadonlySet<string> = new Set(['normal', 'italic']);
const ALIGNS: ReadonlySet<string> = new Set(['left', 'center', 'right', 'justify']);
const VERTICAL_ALIGNS: ReadonlySet<string> = new Set(['top', 'middle', 'bottom']);

/**
 * A gradient paint with its stops' colours resolved and sorted by offset; undefined when fewer than two
 * stops resolve (unknown tokens), so the next layer is used (M4.10 review F4).
 */
function gradient(r: Resolver, v: { readonly [k: string]: unknown }, where: ReadonlyArray<string | number>): ResolvedGradientPaint | undefined {
  const raw = Array.isArray(v['stops']) ? v['stops'] : [];
  const stops = raw
    .map((s: unknown, i) => ({
      offset: finiteIn(isObject(s) ? s['offset'] : undefined, 0, 1, Number.NaN),
      css: r.color(isObject(s) ? s['color'] : undefined, [...where, 'stops', i, 'color']),
    }))
    // a stop without a finite offset or a resolved colour is dropped (review round 2 F3)
    .filter((s): s is { offset: number; css: string } => s.css !== undefined && !Number.isNaN(s.offset))
    .sort((a, b) => a.offset - b.offset);
  if (stops.length < 2) return undefined;
  const type = v['type'] === 'radial-gradient' ? 'radial-gradient' : 'linear-gradient';
  return { type, angle: typeof v['angle'] === 'number' && Number.isFinite(v['angle']) ? v['angle'] : 0, stops };
}

/** An image paint with its fit (default `cover`). */
function image(v: { readonly [k: string]: unknown }): ResolvedPaint {
  const fit = v['fit'];
  return { type: 'image', assetId: String(v['assetId']), fit: fit === 'contain' || fit === 'fill' || fit === 'tile' ? fit : 'cover' };
}

/** A colour paint; `transparent` and `none` are no fill. */
const colorPaint = (css: string | undefined): ResolvedPaint | undefined =>
  css === undefined ? undefined : css === 'transparent' || css === 'none' ? { type: 'none' } : { type: 'color', css };

/** A fill: colour value, gradient (stops sorted, colours resolved) or image. */
function paint(r: Resolver, field = 'fill'): ResolvedPaint {
  return r.pick<ResolvedPaint>([field], (v, where) => {
    const type = isObject(v) ? v['type'] : undefined;
    if (isObject(v) && (type === 'linear-gradient' || type === 'radial-gradient')) return gradient(r, v, where);
    if (isObject(v) && type === 'image' && typeof v['assetId'] === 'string') return image(v);
    return colorPaint(r.color(v, where));
  });
}

/**
 * The element kind a style is resolved for, optionally with its definition's default style (a shape's
 * `ShapeDef.defaultStyle`) and that style's JSON pointer for diagnostics.
 *
 * @public
 */
export type StyleKind =
  | string
  | {
      /** The element kind (`shape`, `connector`, …). */
      readonly kind: string;
      /** The definition's default style: under the element's style and variant, over the theme. */
      readonly defaults?: Style;
      /** Where `defaults` is, for diagnostics (default `['definition', 'defaultStyle']`). */
      readonly defaultsAt?: ReadonlyArray<string | number>;
    };

/**
 * Resolve `style` for an element of `kind` against `theme` (02 §2 resolution order: the element, its
 * theme variant, its definition's defaults, the theme's defaults for the kind, the theme's globals).
 * `at` is the JSON pointer prefix of the style in the document (for diagnostics), e.g.
 * `['records', id, 'style']`.
 *
 * @public
 */
export function resolveStyle(style: Style | undefined, of: StyleKind, theme: Theme, at: ReadonlyArray<string | number> = ['style']): StyleResolution {
  const { kind, defaults: definition, defaultsAt = ['definition', 'defaultStyle'] } = typeof of === 'string' ? { kind: of } : of;
  const defaults = theme.defaults ?? {};
  const own = defaults[kind];
  // an element's variant, else its definition's (M5.30 review F1)
  const variant = style?.variant ?? definition?.variant;
  const variants = isObject(own?.['variants']) ? own['variants'] : undefined;
  const layers: Layer[] = [
    { values: style, at },
    ...(variant !== undefined && variants && isObject(variants[variant])
      ? [{ values: variants[variant], at: ['theme', 'defaults', kind, 'variants', variant] }]
      : []),
    { values: definition, at: defaultsAt },
    { values: own, at: ['theme', 'defaults', kind] },
    { values: defaults['*'], at: ['theme', 'defaults', '*'] },
  ];
  const r = new Resolver(theme, layers, FALLBACK);
  const px = r.number('px');
  const unitless = r.number('');
  const keyword = (path: readonly string[], allowed: ReadonlySet<string>) => r.pick(path, r.keyword(allowed));
  const dash = r.pick(['stroke', 'dash'], (v) =>
    Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) ? v.join(' ') : undefined,
  );
  const resolved: ResolvedStyle = {
    fill: paint(r),
    stroke: {
      color: r.pick(['stroke', 'color'], r.color),
      width: r.pick(['stroke', 'width'], px),
      ...(dash !== undefined ? { dash } : {}),
      cap: keyword(['stroke', 'cap'], CAPS),
      join: keyword(['stroke', 'join'], JOINS),
      align: keyword(['stroke', 'align'], ALIGNS_STROKE),
    },
    opacity: r.pick(['opacity'], unitless),
    radius: r.pick(['radius'], px),
    font: {
      family: r.pick(['font', 'family'], r.family),
      size: r.pick(['font', 'size'], px),
      weight: r.pick(['font', 'weight'], unitless),
      lineHeight: r.pick(['font', 'lineHeight'], unitless),
      color: r.pick(['font', 'color'], r.color),
      style: keyword(['font', 'style'], FONT_STYLES),
      align: keyword(['font', 'align'], ALIGNS),
      verticalAlign: keyword(['font', 'verticalAlign'], VERTICAL_ALIGNS),
    },
    shadows: shadowsOf(r),
    effects: effectsOf(r),
  };
  return { style: resolved, diagnostics: r.diagnostics };
}

/**
 * A paint and what resolving it reported.
 *
 * @public
 */
export type PaintResolution = {
  /** The resolved paint. */
  readonly paint: ResolvedPaint;
  /** FLX_TOKEN_UNKNOWN warnings at their JSON pointers. */
  readonly diagnostics: readonly Diagnostic[];
};

/**
 * Resolve a screen's `background` (FR-SCR-001): the screen's own paint → theme
 * `defaults.screen.background` → theme globals → none. `at` is the screen record's pointer, e.g.
 * `['records', id]`; the same validation as {@link resolveStyle} applies to every value.
 *
 * @public
 */
export function resolveBackground(background: Style['fill'] | undefined, theme: Theme, at: ReadonlyArray<string | number> = []): PaintResolution {
  const defaults = theme.defaults ?? {};
  const r = new Resolver(
    theme,
    [
      { values: { background }, at },
      { values: defaults['screen'], at: ['theme', 'defaults', 'screen'] },
      { values: defaults['*'], at: ['theme', 'defaults', '*'] },
    ],
    FALLBACK,
  );
  return { paint: paint(r, 'background'), diagnostics: r.diagnostics };
}
