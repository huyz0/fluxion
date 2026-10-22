// The built-in `circular` layout (05 §3, FR-LAY-003, ADR-0045): nodes evenly spaced on a circle in canonical order (model order, then id),
// the first at the top, clockwise. Nodes whose hints name a `partition` get one circle per partition, in the order each partition first
// appears, side by side from left to right a rank gap apart; nodes without one share a circle of their own. Each circle's radius is the
// smallest at which every pair of its boxes' circumscribed circles is a node gap apart, so no two boxes overlap.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { compare, GAPS, intoFrame } from './tree.js';
import type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `circular` layout.
 *
 * @public
 */
export type CircularOptions = {
  /** Preset for the two gaps: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Least space between boxes on one circle, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Space between the circles of two partitions, px (default: from `spacing`). */
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

const reach = (n: LayoutNode) => Math.sqrt(n.box.w * n.box.w + n.box.h * n.box.h) / 2;

/** The partition a node's hints name, or `undefined`. */
function partitionOf(n: LayoutNode): string | undefined {
  const p = n.hints?.['partition'];
  return typeof p === 'string' || typeof p === 'number' ? String(p) : undefined;
}

/** The least radius at which `ring`, evenly spaced, keeps every pair of circumscribed circles `gap` apart. */
function radiusOf(ring: readonly LayoutNode[], gap: number): number {
  const n = ring.length;
  let r = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const steps = Math.min(j - i, n - (j - i));
      const need = reach(ring[i] as LayoutNode) + reach(ring[j] as LayoutNode) + gap;
      r = Math.max(r, need / (2 * Math.sin((steps * Math.PI) / n)));
    }
  return r;
}

function run(input: LayoutInput, o: CircularOptions): LayoutOutput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  if (nodes.length === 0) return { boxes: {} };
  const [nodeGap, rankGap] = GAPS[o.spacing];
  const groups = new Map<string | undefined, LayoutNode[]>();
  for (const n of nodes) {
    const key = partitionOf(n);
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const placed = new Map<string, Box>();
  let left = 0;
  for (const ring of groups.values()) {
    const r = radiusOf(ring, o.nodeGap ?? nodeGap);
    const outer = Math.max(...ring.map(reach));
    const cx = left + r + outer;
    for (const [i, n] of ring.entries()) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
      placed.set(n.id, { x: cx + r * Math.cos(a) - n.box.w / 2, y: r * Math.sin(a) - n.box.h / 2, w: n.box.w, h: n.box.h });
    }
    left = cx + r + outer + (o.rankGap ?? rankGap);
  }
  return intoFrame(nodes, placed, input.frame, o.padding);
}

/**
 * The `circular` layout: nodes evenly spaced on a circle, one circle per `partition` hint.
 *
 * @public
 */
export const circularLayout: LayoutAlgorithm<CircularOptions> = {
  id: 'circular',
  describe: 'Nodes evenly spaced on a circle, one circle per partition hint, for cycles and peer groups.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<CircularOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `circular options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run,
};
