// The built-in `packing` layout (05 §3, FR-LAY-003, ADR-0045): boxes packed into the frame's width with a bottom-left skyline. Boxes go
// largest area first (ties in canonical order: model order, then id); each takes the spot on the skyline whose top is lowest, then
// leftmost, where it fits inside the width a node gap from its neighbours. A box wider than the frame starts at the left edge and overhangs.
// Pinned nodes keep their boxes and take no part in the packing: the pipeline's overlap pass separates any box they cover.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { compare, GAPS, intoFrame } from './tree.js';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `packing` layout.
 *
 * @public
 */
export type PackingOptions = {
  /** Preset for the gap: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Space between boxes, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Space between the frame's edge and the diagram, px (default 80). */
  readonly padding: number;
};

const SPACINGS = ['compact', 'comfortable', 'spacious'] as const;
const schema = z
  .strictObject({
    spacing: z.enum(SPACINGS).default('comfortable'),
    nodeGap: z.number().finite().min(0).optional(),
    padding: z.number().finite().min(0).default(80),
  })
  .default({ spacing: 'comfortable', padding: 80 });

/** A run of the skyline: from `x`, `w` wide, filled up to `y`. */
type Segment = { x: number; y: number; w: number };

/** The top of the skyline under `[x, x + w)`: the highest segment that span touches. */
function topUnder(skyline: readonly Segment[], x: number, w: number): number {
  let top = 0;
  for (const s of skyline) if (s.x < x + w && x < s.x + s.w) top = Math.max(top, s.y);
  return top;
}

/** The lowest, then leftmost, spot on the skyline for a box `w` wide within `width`; at the left edge when it is wider. */
function spotFor(skyline: readonly Segment[], w: number, width: number): { x: number; y: number } {
  let best = { x: 0, y: topUnder(skyline, 0, w) };
  for (const s of skyline) {
    if (s.x + w > width) continue;
    const y = topUnder(skyline, s.x, w);
    if (y < best.y || (y === best.y && s.x < best.x)) best = { x: s.x, y };
  }
  return best;
}

/** The skyline with `[x, x + w)` raised to `y`: the segments it covers cut, the new one put in place. */
function raise(skyline: readonly Segment[], x: number, w: number, y: number): Segment[] {
  const out: Segment[] = [];
  for (const s of skyline) {
    if (s.x < x) out.push({ x: s.x, y: s.y, w: Math.min(s.w, x - s.x) });
    if (s.x + s.w > x + w) out.push({ x: Math.max(s.x, x + w), y: s.y, w: s.x + s.w - Math.max(s.x, x + w) });
  }
  out.push({ x, y, w });
  return out.sort((a, b) => a.x - b.x);
}

function run(input: LayoutInput, o: PackingOptions): LayoutOutput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  if (nodes.length === 0) return { boxes: {} };
  const gap = o.nodeGap ?? GAPS[o.spacing][0];
  // each box takes its size plus one gap on the right and below, so the width gains one gap too
  const width = Math.max(0, input.frame.w - 2 * o.padding) + gap;
  const byArea = nodes.filter((n) => !n.pinned).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  let skyline: Segment[] = [{ x: 0, y: 0, w: width }];
  const placed = new Map<string, Box>();
  for (const n of byArea) {
    const [w, h] = [n.box.w + gap, n.box.h + gap];
    const { x, y } = spotFor(skyline, w, width);
    placed.set(n.id, { x, y, w: n.box.w, h: n.box.h });
    skyline = raise(skyline, x, w, y + h);
  }
  for (const n of nodes) if (n.pinned) placed.set(n.id, n.box);
  return intoFrame(nodes, placed, input.frame, o.padding);
}

/**
 * The `packing` layout: boxes packed into the frame's width, largest first.
 *
 * @public
 */
export const packingLayout: LayoutAlgorithm<PackingOptions> = {
  id: 'packing',
  describe: 'Packed: boxes fill the frame row by row on a skyline, largest first, for collections without links.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<PackingOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `packing options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run,
};
