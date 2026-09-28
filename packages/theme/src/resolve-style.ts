// Resolved styles (FR-THM-001/002, 02 §Style, ADR-0015): an element's style becomes CSS-ready values.
// Each field resolves through layers, first match wins: element literal or token ref → theme
// `defaults[kind].variants[variant]` → `defaults[kind]` → `defaults['*']` (theme globals) → built-in
// fallbacks. A token ref becomes `var(--fx-<path>, <theme value>)`, so a theme switch restyles through
// CSS variables; an unknown token is reported (FLX_TOKEN_UNKNOWN) and the next layer is used.
import { colorSchema, DIAGNOSTIC_CODES, type Diagnostic, jsonPointer, type Style, type TokenRef } from '@fluxion/schema';
import { cssValue, familyCss, resolveToken, tokenPath } from './resolve.js';
import { cssVarName, FAMILY, isValidToken, type Theme, TOKEN_REF } from './tokens.js';

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
 * An element's style as CSS values: every field set, token refs as `var(--fx-…, fallback)`.
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

type Layer = { readonly values: unknown; readonly at: ReadonlyArray<string | number> };

/** Built-in fallbacks: the last layer, so every field has a value even with an empty theme. */
const FALLBACK = {
  fill: 'transparent',
  stroke: { color: 'currentColor', width: 1, cap: 'butt', join: 'miter' },
  opacity: 1,
  radius: 0,
  font: { family: 'sans-serif', size: 16, weight: 400, lineHeight: 1.2, color: 'currentColor', style: 'normal', align: 'center', verticalAlign: 'middle' },
} as const;

// the strict reference syntax (names only), so a ref can never put other CSS into a var() name
const isRef = (v: unknown): v is TokenRef => typeof v === 'string' && TOKEN_REF.test(v);
const isObject = (v: unknown): v is { readonly [k: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value at `path` in `values`, or undefined. */
const at = (values: unknown, path: readonly string[]): unknown => path.reduce<unknown>((v, k) => (isObject(v) ? v[k] : undefined), values);

/** The resolution context: the theme, the layers, and the diagnostics it collects. */
class Resolver {
  readonly diagnostics: Diagnostic[] = [];
  readonly theme: Theme;
  readonly layers: readonly Layer[];

  constructor(theme: Theme, layers: readonly Layer[]) {
    this.theme = theme;
    this.layers = layers;
  }

  /**
   * A token ref as `var(--fx-…, theme value)`, or undefined (reported) when the theme has no such token
   * or its value is not a valid token (a theme object never parsed; M4.10 review round 2 F1).
   */
  ref(ref: TokenRef, where: ReadonlyArray<string | number>): string | undefined {
    const token = resolveToken(this.theme, ref);
    if (token.ok && isValidToken(token.value)) return `var(${cssVarName(tokenPath(ref))}, ${cssValue(token.value)})`;
    this.diagnostics.push({
      code: 'FLX_TOKEN_UNKNOWN',
      severity: DIAGNOSTIC_CODES.FLX_TOKEN_UNKNOWN,
      path: jsonPointer([...where]),
      message: token.ok ? `token ${ref} of theme ${this.theme.name} is not a valid token` : token.error.message,
    });
    return undefined;
  }

  /** The first layer's value at `path` that `convert` accepts; FALLBACK's otherwise. */
  pick<T>(path: readonly string[], convert: (v: unknown, where: ReadonlyArray<string | number>) => T | undefined): T {
    for (const layer of this.layers) {
      const v = at(layer.values, path);
      if (v === undefined) continue;
      const out = convert(v, [...layer.at, ...path]);
      if (out !== undefined) return out;
    }
    return convert(at(FALLBACK, path), []) as T;
  }

  /** A colour field: literal, token ref, or transformed token (color-mix in OKLCH). */
  color: (v: unknown, where: ReadonlyArray<string | number>) => string | undefined = (v, where) => {
    if (isRef(v)) return this.ref(v, where);
    // only a CSS colour: a literal from unvalidated theme defaults cannot carry other CSS (M4.10 review F2)
    if (typeof v === 'string') return colorSchema.safeParse(v).success ? v : undefined;
    if (isObject(v) && isRef(v['token'])) {
      const base = this.ref(v['token'], [...where, 'token']);
      return base === undefined ? undefined : transformed(base, isObject(v['transform']) ? v['transform'] : {});
    }
    return undefined;
  };

  /** A numeric field with a CSS unit (`px`, or '' for unitless): number or token ref. */
  number = (unit: string) => (v: unknown, where: ReadonlyArray<string | number>) =>
    isRef(v) ? this.ref(v, where) : typeof v === 'number' && Number.isFinite(v) ? `${v}${unit}` : undefined;

  /** A font family: a token ref, or one name quoted and escaped as CSS (markup and control characters refused). */
  family: (v: unknown, where: ReadonlyArray<string | number>) => string | undefined = (v, where) =>
    isRef(v) ? this.ref(v, where) : typeof v === 'string' && FAMILY.test(v) ? familyCss(v) : undefined;

  /** A keyword field: only a value of its allow-list (M4.10 review F2). */
  keyword = (allowed: ReadonlySet<string>) => (v: unknown) => (typeof v === 'string' && allowed.has(v) ? v : undefined);
}

const CAPS: ReadonlySet<string> = new Set(['butt', 'round', 'square']);
const JOINS: ReadonlySet<string> = new Set(['miter', 'round', 'bevel']);
const FONT_STYLES: ReadonlySet<string> = new Set(['normal', 'italic']);
const ALIGNS: ReadonlySet<string> = new Set(['left', 'center', 'right', 'justify']);
const VERTICAL_ALIGNS: ReadonlySet<string> = new Set(['top', 'middle', 'bottom']);

/** `v` clamped to [min, max] when it is a finite number; `otherwise` when it is not. */
const finiteIn = (v: unknown, min: number, max: number, otherwise: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : otherwise;

/** A colour with a ColorTransform: lighten mixes with white (black when negative), alpha with transparent. */
function transformed(base: string, t: { readonly [k: string]: unknown }): string {
  let css = base;
  // finite and clamped, so the percentages are valid CSS (M4.10 review round 2 F2)
  const lighten = finiteIn(t['lighten'], -1, 1, 0);
  if (lighten !== 0) css = `color-mix(in oklch, ${css}, ${lighten > 0 ? 'white' : 'black'} ${Math.round(Math.abs(lighten) * 100)}%)`;
  const alpha = finiteIn(t['alpha'], 0, 1, 1);
  if (alpha !== 1) css = `color-mix(in oklch, ${css} ${Math.round(alpha * 100)}%, transparent)`;
  return css;
}

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
function paint(r: Resolver): ResolvedPaint {
  return r.pick<ResolvedPaint>(['fill'], (v, where) => {
    const type = isObject(v) ? v['type'] : undefined;
    if (isObject(v) && (type === 'linear-gradient' || type === 'radial-gradient')) return gradient(r, v, where);
    if (isObject(v) && type === 'image' && typeof v['assetId'] === 'string') return image(v);
    return colorPaint(r.color(v, where));
  });
}

/**
 * Resolve `style` for an element of `kind` against `theme` (02 §Style resolution order). `at` is the
 * JSON pointer prefix of the style in the document (for diagnostics), e.g. `['records', id, 'style']`.
 *
 * @public
 */
export function resolveStyle(style: Style | undefined, kind: string, theme: Theme, at: ReadonlyArray<string | number> = ['style']): StyleResolution {
  const defaults = theme.defaults ?? {};
  const own = defaults[kind];
  const variant = style?.variant;
  const variants = isObject(own?.['variants']) ? own['variants'] : undefined;
  const layers: Layer[] = [
    { values: style, at },
    ...(variant !== undefined && variants && isObject(variants[variant])
      ? [{ values: variants[variant], at: ['theme', 'defaults', kind, 'variants', variant] }]
      : []),
    { values: own, at: ['theme', 'defaults', kind] },
    { values: defaults['*'], at: ['theme', 'defaults', '*'] },
  ];
  const r = new Resolver(theme, layers);
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
  };
  return { style: resolved, diagnostics: r.diagnostics };
}
