// A stroke as drawn (ADR-0019, FR-EDT-004): the band of signed distance it covers along its outline
// (centred on it, inside it or outside it), and its miter spikes. Hit-testing and its index bounds
// read strokes through this module.
import { outlineDistance } from '@fluxion/core';
import { type Box, boxFromPoints, boxUnion, type Path, pointInPath, type Vec2 } from '@fluxion/geometry';
import type { ResolvedStroke } from '@fluxion/theme';
import { miterWedges, nearWedge, type Wedge } from './stroke-join.js';

/**
 * A theme's CSS variables by name (`toCssVars`).
 *
 * @public
 */
export type CssVars = { readonly [name: string]: string | undefined };

/** A resolved length (`2`, `4px`, `var(--fx-…)`) as px with the theme's values; 0 when it is none. */
export function lengthOf(css: string, vars: CssVars): number {
  // tzap disable next-line StringLiteral: an unknown variable parses to NaN, then 0, whatever replaces it
  const n = Number.parseFloat(css.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars[name] ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Where a stroke is drawn (ADR-0019): its width, and whether it is centred on the outline, inside it
 * or outside it (an open outline's stroke is always centred). A transparent stroke draws nothing.
 */
export type Stroke = { readonly width: number; readonly align: 'center' | 'inside' | 'outside' };

export function strokeOf(stroke: ResolvedStroke, closed: boolean, vars: CssVars): Stroke {
  const width = stroke.color === 'transparent' ? 0 : lengthOf(stroke.width, vars);
  const align = closed && (stroke.align === 'inside' || stroke.align === 'outside') ? stroke.align : 'center';
  return { width, align };
}

/** The band a stroke covers, as signed distances from its outline (negative inside). */
export function band(s: Stroke): readonly [number, number] {
  if (s.align === 'inside') return [-s.width, 0];
  return s.align === 'outside' ? [0, s.width] : [-s.width / 2, s.width / 2];
}

/** How far a stroke is drawn beyond its outline. */
// tzap disable next-line ArithmeticOperator, ConditionalExpression: a larger bound only adds candidates, which the exact test then drops
export const outward = (s: Stroke): number => Math.max(0, band(s)[1]);

/**
 * Whether a point at `d` from the outline, `inside` it or not, is on the stroke `s` or within
 * `tolerance` of it.
 */
export function onStroke(s: Stroke, d: number, inside: boolean, tolerance: number): boolean {
  const signed = inside ? -d : d;
  const [from, to] = band(s);
  return signed >= from - tolerance && signed <= to + tolerance;
}

/** A stroked outline: the band along it and the miter spikes at its joints, in its own coordinates. */
export type Stroked = { readonly path: Path; readonly stroke: Stroke; readonly wedges: readonly Wedge[] };

/**
 * `path` stroked with `resolved`. An inside or outside stroke is drawn twice as wide and clipped to
 * one side of the outline (ADR-0019), so only its spikes on that side are drawn.
 */
export function stroked(path: Path, resolved: ResolvedStroke, vars: CssVars): Stroked {
  const stroke = strokeOf(resolved, path.closed, vars);
  const half = stroke.align === 'center' ? stroke.width / 2 : stroke.width;
  // tzap disable next-line EqualityOperator, ConditionalExpression: a stroke of width 0 has spikes of size 0, within the band's margin
  const all = stroke.width > 0 && resolved.join === 'miter' ? miterWedges(path, half) : [];
  const wedges = stroke.align === 'center' ? all : all.filter((w) => pointInPath(path, w[0], 'nonzero') === (stroke.align === 'inside'));
  return { path, stroke, wedges };
}

/** Whether `l`, `inside` the outline or not, is on the stroke or within `tolerance` of it. */
export const onStroked = (s: Stroked, l: Vec2, inside: boolean, tolerance: number): boolean =>
  onStroke(s.stroke, outlineDistance(s.path, l), inside, tolerance) || s.wedges.some((w) => nearWedge(l, w, tolerance));

/** The box of a stroked outline: its outline's, grown by the stroke, and its spikes'. */
export function strokedBounds(s: Stroked, outline: Box): Box {
  const grown = grow(outline, outward(s.stroke));
  const tips = boxFromPoints(s.wedges.map((w) => w[0]));
  return tips === null ? grown : boxUnion(grown, tips);
}

/**
 * How far a stroke is drawn from its outline, on whichever side.
 *
 * @public
 */
export function reachOf(s: Stroke): number {
  const [from, to] = band(s);
  return Math.max(-from, to);
}

/** `b` grown by `d` on every side. */
export const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
