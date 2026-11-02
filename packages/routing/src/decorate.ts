// Decorated routes (FR-CON-010): the path generators of pack connector types. A pack's connector definition names a
// built-in router and a decoration; the router lays the route as usual (so bindings, anchors and the global pass are
// the router's) and the decoration turns that route into the strokes drawn. Waves and zigzags fade to nothing at
// both ends, so the drawn line starts and stops exactly where the route does, under its markers.
import type { ConnectorDecoration, ConnectorDef } from '@fluxion/core';
import { createPathSampler, type PathCommand, pathFromCommands, roundCorners, type Vec2 } from '@fluxion/geometry';
import type { Router } from './router.js';

/**
 * One stroke of a decorated route: its path, its width in px, and its part (`line` and `tie` in the stroke colour, `core`
 * a lighter shade of it, drawn over the line).
 *
 * @public
 */
export type DecoratedStroke = {
  /** The stroke's path, screen coordinates. */
  readonly commands: readonly PathCommand[];
  /** Stroke width, px. */
  readonly width: number;
  /** Which part of the decoration it is. */
  readonly part: 'line' | 'core' | 'tie';
};

/**
 * A router that decorates the output of another (a pack connector type): routing uses `base`, the view draws
 * `decoration`.
 *
 * @public
 */
export type DecoratedRouter = Router & {
  /** The built-in router that lays the route. */
  readonly base: string;
  /** How the route is drawn. */
  readonly decoration: ConnectorDecoration;
  /** The definition it was made from, as a save embeds it (FR-LIB-009). */
  readonly def: ConnectorDef;
};

/** Most points one decorated stroke has: a long route with a short wave is drawn coarser, not slower. */
const MAX_POINTS = 4096;
/** Points per wave of a wavy route. */
const PER_WAVE = 16;
/** Spacing of the samples of an offset line, px. */
const OFFSET_STEP = 4;

const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** The polyline through `points`. */
const polyline = (points: readonly Vec2[]): PathCommand[] =>
  points.map((p, i) => ({ kind: i === 0 ? 'M' : 'L', to: { x: r3(p.x), y: r3(p.y) } }) as PathCommand);

/** Longest a mitred corner of an offset line reaches, in offsets: a sharper corner is cut there. */
const MITER_LIMIT = 4;

/** The points of `commands` when they are a move then straight lines only (a polyline), repeats dropped; else undefined. */
function polylinePoints(commands: readonly PathCommand[]): readonly Vec2[] | undefined {
  if (!commands.every((c, k) => c.kind === (k === 0 ? 'M' : 'L'))) return undefined;
  const points: Vec2[] = [];
  for (const c of commands) {
    const p = (c as { readonly to: Vec2 }).to;
    const last = points.at(-1);
    if (last === undefined || last.x !== p.x || last.y !== p.y) points.push(p);
  }
  return points.length < 2 ? undefined : points;
}

/** The left normal of the segment `a`-`b` (not of zero length). */
function normalOf(a: Vec2, b: Vec2): Vec2 {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

/**
 * The polyline `points` moved `d` to its left, its corners mitred (a corner sharper than the miter limit keeps the
 * miter's direction at that length), so a bend draws a clean corner rather than a cut or a spur.
 */
function offsetPolyline(points: readonly Vec2[], d: number): readonly Vec2[] {
  const normals = points.slice(1).map((b, k) => normalOf(points[k] as Vec2, b));
  return points.map((p, k) => {
    const n1 = normals[k - 1] ?? (normals[k] as Vec2);
    const n2 = normals[k] ?? n1;
    const sum = { x: n1.x + n2.x, y: n1.y + n2.y };
    const len = Math.hypot(sum.x, sum.y);
    // a route doubling back on itself has no miter: the offset of the leg in
    if (len < 1e-9) return { x: p.x + n1.x * d, y: p.y + n1.y * d };
    const m = { x: sum.x / len, y: sum.y / len };
    const reach = Math.min(MITER_LIMIT, 1 / (m.x * n1.x + m.y * n1.y)) * d;
    return { x: p.x + m.x * reach, y: p.y + m.y * reach };
  });
}

/** `n` + 1 arc lengths evenly from 0 to `total`, `n` capped. */
function steps(total: number, n: number): number[] {
  const count = Math.min(MAX_POINTS, Math.max(1, Math.ceil(n)));
  return Array.from({ length: count + 1 }, (_, i) => (total * i) / count);
}

/** Radius a wave's route is rounded to at a bend, in amplitudes: wider than the wave, whose inner side then never folds. */
const BEND_RADIUS = 2;

/** Arc length along a route: its length and its left offset. */
type Along = { readonly total: number; readonly off: (s: number, d: number) => Vec2 };

/** Arc length along `commands`: their length and the point `d` px to the left at arc length `s`; undefined for no length. */
function alongOf(commands: readonly PathCommand[]): Along | undefined {
  const path = pathFromCommands(commands);
  const sampler = path.ok ? createPathSampler(path.value) : undefined;
  const total = sampler?.length ?? 0;
  if (sampler === undefined || !(total > 0)) return undefined;
  return {
    total,
    off: (s, d) => {
      const p = sampler.pointAtLength(s);
      const t = sampler.tangentAtLength(s);
      return { x: p.x - t.y * d, y: p.y + t.x * d };
    },
  };
}

/** Points a wave's route is smoothed at, per averaging reach: finer only costs time, coarser would facet the bends. */
const SMOOTH_PER_REACH = 6;

/**
 * `commands` as points spaced a sixth of `reach` apart (at least 1 px), each averaged with its neighbours up to `reach` px
 * either way (fewer near the ends, which stay where they are): a jog too short to round to the wave's height becomes a
 * gentle slope, so a wave along it never folds into a hook.
 */
function smoothed(route: Along, reach: number): readonly Vec2[] {
  const step = Math.max(1, reach / SMOOTH_PER_REACH);
  const points = steps(route.total, Math.min(MAX_POINTS, route.total / step)).map((s) => route.off(s, 0));
  const n = points.length;
  const span = Math.max(0, Math.round((reach / route.total) * (n - 1)));
  // running sums: each point's window in constant time
  const sums: Vec2[] = [{ x: 0, y: 0 }];
  for (const p of points) {
    const last = sums.at(-1) as Vec2;
    sums.push({ x: last.x + p.x, y: last.y + p.y });
  }
  return points.map((_, k) => {
    const h = Math.min(span, k, n - 1 - k);
    const [a, b] = [sums[k - h] as Vec2, sums[k + h + 1] as Vec2];
    return { x: (b.x - a.x) / (2 * h + 1), y: (b.y - a.y) / (2 * h + 1) };
  });
}

/** Arc length along the polyline `points`, from its own length table (no path sampler to build); undefined for no length. */
function polylineAlong(all: readonly Vec2[]): Along | undefined {
  // repeats dropped: every segment has a direction
  const points = all.filter((p, k) => k === 0 || p.x !== (all[k - 1] as Vec2).x || p.y !== (all[k - 1] as Vec2).y);
  const at = [0];
  for (let k = 1; k < points.length; k++) {
    const [a, b] = [points[k - 1] as Vec2, points[k] as Vec2];
    at.push((at[k - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = at.at(-1) as number;
  if (!(total > 0)) return undefined;
  return {
    total,
    off: (length, d) => {
      const s = Math.max(0, Math.min(total, length));
      // the segment `s` falls in: the last that starts before it
      let [lo, hi] = [0, points.length - 2];
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((at[mid] as number) < s) lo = mid;
        else hi = mid - 1;
      }
      const [a, b] = [points[lo] as Vec2, points[lo + 1] as Vec2];
      const len = (at[lo + 1] as number) - (at[lo] as number);
      const f = (s - (at[lo] as number)) / len;
      const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      return { x: a.x + (b.x - a.x) * f - t.y * d, y: a.y + (b.y - a.y) * f + t.x * d };
    },
  };
}

/**
 * A wave's height and length in px, the route it follows (`commands` with its corners rounded wider than the wave, so a
 * bend turns the wave rather than kinking it; `route` when that has no length), and how much of its height it has at
 * arc length `s`: full a wave from each end.
 */
function waveOf(decoration: { readonly amplitude: number; readonly wavelength: number }, w: number, commands: readonly PathCommand[], route: Along) {
  const [amplitude, wave] = [decoration.amplitude * w, decoration.wavelength * w];
  const rounded = alongOf(roundCorners(commands, BEND_RADIUS * amplitude)) ?? route;
  const along = polylineAlong(smoothed(rounded, BEND_RADIUS * amplitude)) ?? route;
  return { amplitude, wave, along, fade: (s: number) => Math.min(1, s / wave, (along.total - s) / wave) };
}

/**
 * The strokes of `commands` drawn with `decoration` at stroke `width` (px; decoration lengths are in widths).
 *
 * @public
 */
export function decorateRoute(commands: readonly PathCommand[], decoration: ConnectorDecoration, width: number): readonly DecoratedStroke[] {
  const w = width > 0 ? width : 1;
  const route = alongOf(commands);
  if (route === undefined) return [{ commands, width: w, part: 'line' }];
  const { total, off } = route;
  switch (
    decoration.kind // kind-switch-allow: decorations are a closed union of the connector definition schema, not element kinds
  ) {
    case 'wavy': {
      const { amplitude, wave, along, fade } = waveOf(decoration, w, commands, route);
      const at = steps(along.total, (along.total / wave) * PER_WAVE);
      return [{ commands: polyline(at.map((s) => along.off(s, amplitude * fade(s) * Math.sin((2 * Math.PI * s) / wave)))), width: w, part: 'line' }];
    }
    case 'zigzag': {
      const { amplitude, wave, along, fade } = waveOf(decoration, w, commands, route);
      // a corner every half wave, alternating sides, between the route's own ends
      const corners = Array.from({ length: Math.min(MAX_POINTS, Math.max(0, Math.floor(along.total / (wave / 2)))) }, (_, k) => (k + 0.5) * (wave / 2));
      const points = corners.map((s, k) => along.off(s, amplitude * fade(s) * (k % 2 === 0 ? 1 : -1)));
      return [{ commands: polyline([along.off(0, 0), ...points, along.off(along.total, 0)]), width: w, part: 'line' }];
    }
    case 'double': {
      const half = (decoration.gap * w) / 2;
      // a polyline (straight, orthogonal) offsets exactly with mitred corners; a curve is sampled
      const points = polylinePoints(commands);
      const side = (d: number) => (points === undefined ? steps(total, total / OFFSET_STEP).map((s) => off(s, d)) : offsetPolyline(points, d));
      return [
        { commands: polyline(side(half)), width: w, part: 'line' },
        { commands: polyline(side(-half)), width: w, part: 'line' },
      ];
    }
    case 'pipe':
      return [
        { commands, width: w * (1 + 2 * decoration.wall), part: 'line' },
        { commands, width: w, part: 'core' },
      ];
    default: {
      const pitch = decoration.pitch * w;
      const ties: PathCommand[] = [];
      const count = Math.min(MAX_POINTS, Math.max(0, Math.floor(total / pitch - 1e-9)));
      for (let k = 1; k <= count; k++) ties.push(...polyline([off(k * pitch, -1.6 * w), off(k * pitch, 1.6 * w)]));
      return [{ commands, width: 2 * w, part: 'line' }, ...(ties.length === 0 ? [] : [{ commands: ties, width: 0.75 * w, part: 'tie' as const }])];
    }
  }
}

/**
 * The router of pack connector type `def`: `routers`' entry for `def.router` (the route), carrying the decoration
 * (what is drawn); undefined when that router is not registered.
 *
 * @public
 */
export function connectorDefRouter(def: ConnectorDef, routers: { get(id: string): Router | undefined }): DecoratedRouter | undefined {
  const base = routers.get(def.router);
  if (base === undefined) return undefined;
  return {
    describe: def.describe ?? `${def.decoration.kind} connector over the ${def.router} router`,
    route: (r) => base.route(r),
    base: def.router,
    decoration: def.decoration,
    def,
  };
}

/**
 * The pack connector definition `routers` holds as `type` (a decorated router's), else undefined: what a save embeds for a
 * connector of that type (FR-CON-010, FR-LIB-009).
 *
 * @public
 */
export function connectorDefOf(routers: { get(id: string): Router | undefined }, type: string): ConnectorDef | undefined {
  const def = (routers.get(type) as Partial<DecoratedRouter> | undefined)?.def;
  return typeof def === 'object' ? def : undefined;
}

/**
 * The router `type` lays its routes with: a decorated router's base, else `type` itself.
 *
 * @public
 */
export function routerBase(routers: { get(id: string): Router | undefined }, type: string): string {
  const router = routers.get(type) as Partial<DecoratedRouter> | undefined;
  return typeof router?.base === 'string' ? router.base : type;
}
