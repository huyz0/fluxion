// The built-in `radial` layout (05 §3, FR-LAY-003, ADR-0045): the tree of the edges (as `tree` builds it) on rings around its root, one
// ring per depth. A node's angle is the middle of its share of its parent's arc, the shares in proportion to the leaves below each
// child, so wide subtrees get wide arcs. Each ring's radius is the smallest that keeps every box clear of the ring inside it (the boxes'
// circumscribed circles a rank gap apart) and of its neighbours on the ring (centres at least the circles plus a node gap apart), so no
// two boxes overlap by construction. A forest hangs its roots on the first ring around an empty centre. The first child starts at the
// top and children go clockwise.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { compare, forestOf, GAPS, intoFrame } from './tree.js';
import type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `radial` layout.
 *
 * @public
 */
export type RadialOptions = {
  /** Preset for the two gaps: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Least space between boxes on one ring, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Least space between the boxes of one ring and the next, px (default: from `spacing`). */
  readonly rankGap?: number | undefined;
  /** Space between the frame's edge and the diagram, px (default 80). */
  readonly padding: number;
};

const SPACINGS = ['compact', 'comfortable', 'spacious'] as const;
const schema = z
  .strictObject({
    spacing: z.enum(SPACINGS).default('comfortable'),
    nodeGap: z.number().finite().min(0).optional(),
    rankGap: z.number().finite().min(0).optional(),
    padding: z.number().finite().min(0).default(80),
  })
  .default({ spacing: 'comfortable', padding: 80 });

/** The id of the empty centre a forest's roots hang from; never a record id, which is never empty. */
const CENTRE = '';
const TURN = 2 * Math.PI;
/** Half the diagonal of a box: the radius of its circumscribed circle. */
const reach = (n: LayoutNode | undefined) => (n === undefined ? 0 : Math.hypot(n.box.w, n.box.h) / 2);

type Arcs = { readonly angle: ReadonlyMap<string, number>; readonly rings: readonly (readonly string[])[]; readonly depthOf: ReadonlyMap<string, number> };

/** Each node's angle (the middle of its share of its parent's arc, shares by leaf count, from the top, clockwise) and ring. */
function arcs(centre: string, kids: (id: string) => readonly string[]): Arcs {
  const leaves = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const k = kids(id);
    const n = k.length === 0 ? 1 : k.reduce((sum, c) => sum + countLeaves(c), 0);
    leaves.set(id, n);
    return n;
  };
  countLeaves(centre);
  const angle = new Map<string, number>([[centre, 0]]);
  const rings: string[][] = [];
  const depthOf = new Map<string, number>();
  const place = (id: string, from: number, span: number, depth: number) => {
    let at = from;
    const ring = rings[depth] ?? [];
    rings[depth] = ring;
    for (const c of kids(id)) {
      const share = (span * (leaves.get(c) as number)) / (leaves.get(id) as number);
      angle.set(c, at + share / 2);
      ring.push(c);
      depthOf.set(c, depth);
      place(c, at, share, depth + 1);
      at += share;
    }
  };
  place(centre, -Math.PI / 2, TURN, 0);
  return { angle, rings: rings.filter((ring) => ring.length > 0), depthOf };
}

/** The least radius at which every pair of boxes on `ring` is `gap` apart, their circumscribed circles at their angles. */
function ringClearance(ring: readonly string[], angle: ReadonlyMap<string, number>, reachOf: (id: string) => number, gap: number): number {
  let r = 0;
  for (const [i, a] of ring.entries())
    for (const b of ring.slice(i + 1)) {
      const apart = Math.abs((angle.get(a) as number) - (angle.get(b) as number)) % TURN;
      const theta = Math.min(apart, TURN - apart);
      const need = reachOf(a) + reachOf(b) + gap;
      r = Math.max(r, theta >= Math.PI ? need / 2 : need / (2 * Math.sin(theta / 2)));
    }
  return r;
}

function run(input: LayoutInput, o: RadialOptions): LayoutOutput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  if (nodes.length === 0) return { boxes: {} };
  const [nodeGap, rankGap] = GAPS[o.spacing];
  const gap = { node: o.nodeGap ?? nodeGap, rank: o.rankGap ?? rankGap };
  const forest = forestOf(nodes, input);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reachOf = (id: string) => reach(byId.get(id));
  const centre = forest.roots.length === 1 ? (forest.roots[0] as string) : CENTRE;
  const { angle, rings, depthOf } = arcs(centre, (id) => (id === CENTRE ? forest.roots : (forest.children.get(id) ?? [])));
  // ring radii, inside out: clear of the ring inside and of the neighbours on the ring
  const radius: number[] = [];
  let inner = reachOf(centre);
  for (const [d, ring] of rings.entries()) {
    const outer = Math.max(...ring.map(reachOf));
    radius[d] = Math.max((radius[d - 1] ?? 0) + inner + outer + gap.rank, ringClearance(ring, angle, reachOf, gap.node));
    inner = outer;
  }
  const placed = new Map<string, Box>();
  for (const n of nodes) {
    const depth = depthOf.get(n.id);
    const r = depth === undefined ? 0 : (radius[depth] as number);
    const a = angle.get(n.id) as number;
    placed.set(n.id, { x: r * Math.cos(a) - n.box.w / 2, y: r * Math.sin(a) - n.box.h / 2, w: n.box.w, h: n.box.h });
  }
  return intoFrame(nodes, placed, input.frame, o.padding);
}

/**
 * The `radial` layout: the tree of the edges on rings around its root, arcs shared by leaf count.
 *
 * @public
 */
export const radialLayout: LayoutAlgorithm<RadialOptions> = {
  id: 'radial',
  describe: 'Tree on rings around its root, one ring per depth, for hierarchies seen from the centre.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<RadialOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `radial options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run,
};
