// Decorated routes (FR-CON-010): the path generators of pack connector types. A pack's connector definition names a
// built-in router and a decoration; the router lays the route as usual (so bindings, anchors and the global pass are
// the router's) and the decoration turns that route into the strokes drawn. Waves and zigzags fade to nothing at
// both ends, so the drawn line starts and stops exactly where the route does, under its markers.
import type { ConnectorDecoration, ConnectorDef } from '@fluxion/core';
import { createPathSampler, type PathCommand, pathFromCommands, type Vec2 } from '@fluxion/geometry';
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

/** A wave's height and length in px, and how much of its height it has at arc length `s`: full a wave from each end. */
function waveOf(decoration: { readonly amplitude: number; readonly wavelength: number }, w: number, total: number) {
  const wave = decoration.wavelength * w;
  return { amplitude: decoration.amplitude * w, wave, fade: (s: number) => Math.min(1, s / wave, (total - s) / wave) };
}

/**
 * The strokes of `commands` drawn with `decoration` at stroke `width` (px; decoration lengths are in widths).
 *
 * @public
 */
export function decorateRoute(commands: readonly PathCommand[], decoration: ConnectorDecoration, width: number): readonly DecoratedStroke[] {
  const w = width > 0 ? width : 1;
  const path = pathFromCommands(commands);
  const sampler = path.ok ? createPathSampler(path.value) : undefined;
  const total = sampler?.length ?? 0;
  if (sampler === undefined || !(total > 0)) return [{ commands, width: w, part: 'line' }];
  /** The point `d` px to the left of the route at arc length `s`. */
  const off = (s: number, d: number): Vec2 => {
    const p = sampler.pointAtLength(s);
    const t = sampler.tangentAtLength(s);
    return { x: p.x - t.y * d, y: p.y + t.x * d };
  };
  /** `n` + 1 arc lengths evenly from 0 to the end, `n` capped. */
  const steps = (n: number) => {
    const count = Math.min(MAX_POINTS, Math.max(1, Math.ceil(n)));
    return Array.from({ length: count + 1 }, (_, i) => (total * i) / count);
  };
  switch (
    decoration.kind // kind-switch-allow: decorations are a closed union of the connector definition schema, not element kinds
  ) {
    case 'wavy': {
      const { amplitude, wave, fade } = waveOf(decoration, w, total);
      const at = steps((total / wave) * PER_WAVE);
      return [{ commands: polyline(at.map((s) => off(s, amplitude * fade(s) * Math.sin((2 * Math.PI * s) / wave)))), width: w, part: 'line' }];
    }
    case 'zigzag': {
      const { amplitude, wave, fade } = waveOf(decoration, w, total);
      // a corner every half wave, alternating sides, between the route's own ends
      const corners = Array.from({ length: Math.min(MAX_POINTS, Math.max(0, Math.floor(total / (wave / 2)))) }, (_, k) => (k + 0.5) * (wave / 2));
      const points = corners.map((s, k) => off(s, amplitude * fade(s) * (k % 2 === 0 ? 1 : -1)));
      return [{ commands: polyline([off(0, 0), ...points, off(total, 0)]), width: w, part: 'line' }];
    }
    case 'double': {
      const half = (decoration.gap * w) / 2;
      // a polyline (straight, orthogonal) offsets exactly with mitred corners; a curve is sampled
      const points = polylinePoints(commands);
      const side = (d: number) => (points === undefined ? steps(total / OFFSET_STEP).map((s) => off(s, d)) : offsetPolyline(points, d));
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
  };
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
