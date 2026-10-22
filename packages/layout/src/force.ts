// The built-in `force` layout (05 §3, FR-LAY-003, ADR-0045, ADR-0034): Fruchterman-Reingold on the boxes' centres. Every pair repels with
// k²/d and every edge attracts with d²/k, where k (the ideal edge length) is the mean box diagonal plus the node gap; each step moves a node
// by at most the temperature, which cools linearly to zero over a fixed number of iterations. The start is drawn from the run's seeded
// stream in canonical order (model order, then id), and the arithmetic is only +, -, *, / and square roots, which IEEE 754 fixes exactly
// (no `Math.hypot`, `sin` or `cos`, which engines may round differently), so the same graph and seed give the same boxes on every host;
// positions are rounded to 0.5 px after every step. Pinned nodes push and pull but never move: when there are any, the loose nodes start in
// a square around the pins' middle and the result is not moved into the frame, so links to a pin stay short (review M17.5 F1); without
// pins the result is moved to start `padding` inside the frame. Given `previous` (incremental mode, ADR-0046), it warm-starts: every node
// starts where it was (a new one at the mean of its placed neighbours), only the changed nodes and their neighbours move, for a third of
// the iterations at a quarter of the ideal edge length, and the result stays in the previous space. Boxes may still touch: the pipeline's overlap pass separates
// them. All arranges in the studio already run in a worker (arrange-port.ts), which covers large graphs; the layout itself runs in either.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { createRng } from './rng.js';
import { compare, GAPS, intoFrame } from './tree.js';
import type { LayoutAlgorithm, LayoutCtx, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `force` layout.
 *
 * @public
 */
export type ForceOptions = {
  /** Steps of the simulation (default 300). */
  readonly iterations: number;
  /** Preset for the node gap: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Extra length of an edge over the boxes' mean diagonal, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Space between the frame's edge and the diagram, px (default 80). */
  readonly padding: number;
};

const SPACINGS = ['compact', 'comfortable', 'spacious'] as const;
const schema = z
  .strictObject({
    iterations: z.number().int().min(1).max(2000).default(300),
    spacing: z.enum(SPACINGS).default('comfortable'),
    nodeGap: z.number().finite().min(0).optional(),
    padding: z.number().finite().min(0).default(80),
  })
  .default({ iterations: 300, spacing: 'comfortable', padding: 80 });

/** Rounded to the nearest 0.5 px: the grid the simulation steps on. */
const quantize = (v: number) => Math.round(v * 2) / 2;
const length = (ux: number, uy: number) => Math.sqrt(ux * ux + uy * uy);
/** Directions to push two coincident nodes apart, chosen by the pair (unit vectors, written exactly). */
const APART = [
  [1, 0],
  [0.6, 0.8],
  [0, 1],
  [-0.8, 0.6],
  [-1, 0],
  [-0.6, -0.8],
  [0, -1],
  [0.8, -0.6],
] as const;

/** One step: each node's displacement from repulsion (all pairs) and attraction (edges). */
function forces(x: Float64Array, y: Float64Array, links: readonly (readonly [number, number])[], k: number): [Float64Array, Float64Array] {
  const n = x.length;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let ux = (x[i] as number) - (x[j] as number);
      let uy = (y[i] as number) - (y[j] as number);
      let d = length(ux, uy);
      if (d === 0) {
        // coincident: push apart along a direction fixed by the pair, not by chance
        [ux, uy] = APART[(i * 3 + j) % APART.length] as readonly [number, number];
        d = 1;
      }
      const f = (k * k) / d / d;
      dx[i] = (dx[i] as number) + ux * f;
      dy[i] = (dy[i] as number) + uy * f;
      dx[j] = (dx[j] as number) - ux * f;
      dy[j] = (dy[j] as number) - uy * f;
    }
  for (const [a, b] of links) {
    const ux = (x[a] as number) - (x[b] as number);
    const uy = (y[a] as number) - (y[b] as number);
    const f = length(ux, uy) / k;
    dx[a] = (dx[a] as number) - ux * f;
    dy[a] = (dy[a] as number) - uy * f;
    dx[b] = (dx[b] as number) + ux * f;
    dy[b] = (dy[b] as number) + uy * f;
  }
  return [dx, dy];
}

/** The start: pinned nodes at their centres, the others drawn in a square of `side` (around the pins' middle when there are any). */
function start(nodes: readonly LayoutNode[], pins: readonly LayoutNode[], side: number, rng: () => number): [Float64Array, Float64Array] {
  const middle = (along: (n: LayoutNode) => number) => (pins.length ? pins.reduce((sum, n) => sum + along(n), 0) / pins.length - side / 2 : 0);
  const [left, top] = [middle((n) => n.box.x + n.box.w / 2), middle((n) => n.box.y + n.box.h / 2)];
  // every x, then every y: the order the stream is drawn in is part of the result
  const x = new Float64Array(nodes.map((n) => (n.pinned ? n.box.x + n.box.w / 2 : quantize(left + rng() * side))));
  const y = new Float64Array(nodes.map((n) => (n.pinned ? n.box.y + n.box.h / 2 : quantize(top + rng() * side))));
  return [x, y];
}

/** The edges in canonical order as pairs of node indices; edges to unknown nodes and loops are left out. */
function linksOf(input: LayoutInput, index: ReadonlyMap<string, number>): (readonly [number, number])[] {
  return [...(input.edges ?? [])]
    .sort((a, b) => a.order - b.order || compare(a.id, b.id))
    .flatMap((e) => {
      const [a, b] = [index.get(e.source), index.get(e.target)];
      return a === undefined || b === undefined || a === b ? [] : [[a, b] as const];
    });
}

/** Each node not `held` moved along its displacement by at most `temperature`, onto the 0.5 px grid. */
function move(held: readonly boolean[], [x, y]: [Float64Array, Float64Array], [dx, dy]: [Float64Array, Float64Array], temperature: number): void {
  for (const [i, still] of held.entries()) {
    const d = length(dx[i] as number, dy[i] as number);
    if (still || d === 0) continue;
    const by = Math.min(d, temperature) / d;
    x[i] = quantize((x[i] as number) + (dx[i] as number) * by);
    y[i] = quantize((y[i] as number) + (dy[i] as number) * by);
  }
}

/** The warm start (ADR-0046): previous centres, a new node at the mean of its placed neighbours (else of every placed node). */
function warmStart(
  nodes: readonly LayoutNode[],
  previous: { readonly [id: string]: Box },
  links: readonly (readonly [number, number])[],
): [Float64Array, Float64Array] {
  const at = nodes.map((n) => {
    const p = n.pinned ? n.box : Object.hasOwn(previous, n.id) ? previous[n.id] : undefined;
    return p ? ([p.x + p.w / 2, p.y + p.h / 2] as const) : undefined;
  });
  const mean = (points: ReadonlyArray<readonly [number, number] | undefined>): readonly [number, number] => {
    const known = points.filter((p): p is readonly [number, number] => p !== undefined);
    const n = Math.max(1, known.length);
    return [known.reduce((s, p) => s + p[0], 0) / n, known.reduce((s, p) => s + p[1], 0) / n];
  };
  const everywhere = mean(at);
  const placed = at.map((p, i) => {
    if (p) return p;
    const near = links.flatMap(([a, b]) => (a === i ? [at[b]] : b === i ? [at[a]] : [])).filter((q) => q !== undefined);
    return near.length ? mean(near) : everywhere;
  });
  return [new Float64Array(placed.map((p) => quantize(p[0]))), new Float64Array(placed.map((p) => quantize(p[1])))];
}

/** Which nodes may not move in a warm start: pinned ones, and unchanged ones with no changed or new neighbour. */
function heldWarm(nodes: readonly LayoutNode[], input: LayoutInput, links: readonly (readonly [number, number])[]): boolean[] {
  const previous = input.previous ?? {};
  const changed = new Set(input.changed ?? []);
  const loose = nodes.map((n) => !n.pinned && (changed.has(n.id) || !Object.hasOwn(previous, n.id)));
  const free = [...loose];
  for (const [a, b] of links) {
    if (loose[a]) free[b] = !(nodes[b] as LayoutNode).pinned;
    if (loose[b]) free[a] = !(nodes[a] as LayoutNode).pinned;
  }
  return free.map((f) => !f);
}

/** An incremental run: warm start, a third of the iterations, cooler, in the previous space. */
function runWarm(
  nodes: readonly LayoutNode[],
  input: LayoutInput,
  links: readonly (readonly [number, number])[],
  [k, steps]: readonly [number, number],
): LayoutOutput {
  const [x, y] = warmStart(nodes, input.previous ?? {}, links);
  const held = heldWarm(nodes, input, links);
  for (let step = 0; step < steps; step++) move(held, [x, y], forces(x, y, links, k), (k / 4) * (1 - step / steps));
  return {
    boxes: Object.fromEntries(
      nodes.map((n, i) => [n.id, n.pinned ? n.box : { x: (x[i] as number) - n.box.w / 2, y: (y[i] as number) - n.box.h / 2, w: n.box.w, h: n.box.h }]),
    ),
  };
}

function run(input: LayoutInput, o: ForceOptions, ctx?: LayoutCtx): LayoutOutput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  if (nodes.length === 0) return { boxes: {} };
  const rng = ctx?.rng ?? createRng(0);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links = linksOf(input, index);
  // at least 1 px: boxes of no size with no gap would make it 0 and the attraction 0 / 0 (review M17.5 F2)
  const k = Math.max(1, nodes.reduce((sum, n) => sum + length(n.box.w, n.box.h), 0) / nodes.length + (o.nodeGap ?? GAPS[o.spacing][0]));
  if (input.previous) return runWarm(nodes, input, links, [k, Math.ceil(o.iterations / 3)]);
  const side = k * Math.sqrt(nodes.length);
  const pins = nodes.filter((n) => n.pinned);
  const [x, y] = start(nodes, pins, side, rng);
  const held = nodes.map((n) => n.pinned === true);
  for (let step = 0; step < o.iterations; step++) move(held, [x, y], forces(x, y, links, k), (side / 10) * (1 - step / o.iterations));
  const placed = new Map<string, Box>(
    nodes.map((n, i) => [n.id, { x: (x[i] as number) - n.box.w / 2, y: (y[i] as number) - n.box.h / 2, w: n.box.w, h: n.box.h }]),
  );
  // with pins the simulation is already in the pins' space: moving the loose boxes would part them from the pins
  return pins.length
    ? { boxes: Object.fromEntries(nodes.map((n) => [n.id, n.pinned ? n.box : (placed.get(n.id) as Box)])) }
    : intoFrame(nodes, placed, input.frame, o.padding);
}

/**
 * The `force` layout: a seeded force-directed layout, for networks without a direction.
 *
 * @public
 */
export const forceLayout: LayoutAlgorithm<ForceOptions> = {
  id: 'force',
  describe: 'Force-directed (seeded): linked boxes pull together and all others push apart, for networks without a direction.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, incremental: true, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<ForceOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `force options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run,
};
