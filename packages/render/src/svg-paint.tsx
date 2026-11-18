// Paint on the svg surface (ADR-0056 item 8): colours are resolved literals, never `var(--fx-…)` (Inkscape reads no CSS variables),
// written as presentation attributes; numbers are fixed to three decimals; gradients are SVG 1.1 `<linearGradient>` /
// `<radialGradient>` with literal stops, laid out as the html surface lays them (CSS gradient geometry, M4.30).
import type { ResolvedPaint, Theme } from '@fluxion/theme';
import type { ReactNode, SVGAttributes } from 'react';
import { concreteLength, substitute } from './css-values.js';

/** `v` rounded to 1/1000 (no `-0`), as path data is. */
export const n3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;

/** A resolved CSS value with `theme`'s variables put in: the literal the svg surface writes. */
export const lit = (css: string, theme: Theme): string => substitute(css, theme).trim();

/** A literal colour, or `none` for one that paints nothing or does not resolve. */
const colour = (css: string, theme: Theme): string => {
  const value = lit(css, theme);
  return value === '' ? 'none' : value;
};

/** The stops of a gradient with literal colours (a hard stop shares an offset, so the position is the key). */
const stops = (paint: { readonly stops: ReadonlyArray<{ readonly offset: number; readonly css: string }> }, theme: Theme) =>
  // biome-ignore lint/suspicious/noArrayIndexKey: see above
  paint.stops.map((s, i) => <stop key={i} offset={n3(s.offset)} stopColor={colour(s.css, theme)} />);

/**
 * The fill of `paint` on a `w` × `h` box at (`x`, `y`), as literals: a colour, or a gradient `id` defined beside it. An image paint fills
 * nothing on this surface yet (M20.40), as does `none`.
 */
export function svgPaint(
  paint: ResolvedPaint,
  id: string,
  box: { readonly x?: number; readonly y?: number; readonly w: number; readonly h: number },
  theme: Theme,
): { readonly fill: string; readonly defs?: ReactNode } {
  const { w, h } = box;
  const [x0, y0] = [box.x ?? 0, box.y ?? 0];
  if (paint.type === 'color') return { fill: colour(paint.css, theme) };
  if (paint.type === 'linear-gradient') {
    const a = (paint.angle * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    const half = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
    const [cx, cy] = [x0 + w / 2, y0 + h / 2];
    const defs = (
      <linearGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        x1={n3(cx - half * cos)}
        y1={n3(cy - half * sin)}
        x2={n3(cx + half * cos)}
        y2={n3(cy + half * sin)}
      >
        {stops(paint, theme)}
      </linearGradient>
    );
    return { fill: `url(#${id})`, defs };
  }
  if (paint.type === 'radial-gradient') {
    const defs = (
      <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={n3(x0 + w / 2)} cy={n3(y0 + h / 2)} r={n3(Math.hypot(w, h) / 2)}>
        {stops(paint, theme)}
      </radialGradient>
    );
    return { fill: `url(#${id})`, defs };
  }
  return { fill: 'none' };
}

/** A stroke as SVG presentation attributes. */
export type StrokeAttrs = {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeLinecap: NonNullable<SVGAttributes<SVGElement>['strokeLinecap']>;
  readonly strokeLinejoin: NonNullable<SVGAttributes<SVGElement>['strokeLinejoin']>;
  readonly strokeDasharray?: string;
};

/** A resolved stroke as SVG presentation attributes with literal values; `width` overrides the stroke's own (an inside or outside stroke is drawn doubled). */
export function strokeAttrs(
  s: { readonly color: string; readonly width: string; readonly cap: string; readonly join: string; readonly dash?: string | undefined },
  theme: Theme,
  width?: number,
): StrokeAttrs {
  const dash = s.dash === undefined ? '' : lit(s.dash, theme);
  return {
    stroke: colour(s.color, theme),
    strokeWidth: n3(width ?? concreteLength(s.width, theme)),
    strokeLinecap: (lit(s.cap, theme) || 'butt') as StrokeAttrs['strokeLinecap'],
    strokeLinejoin: (lit(s.join, theme) || 'miter') as StrokeAttrs['strokeLinejoin'],
    ...(dash === '' || dash === 'none' ? {} : { strokeDasharray: dash }),
  };
}

/** A resolved opacity as a number in [0, 1] (1 when it does not resolve). */
export function opacityOf(css: string, theme: Theme): number {
  const n = Number.parseFloat(lit(css, theme));
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}
