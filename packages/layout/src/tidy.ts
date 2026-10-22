// The `tidy` layout (FR-LAY-011, ADR-0045): a minimal-movement cleanup of the boxes as they are, not a re-layout. In order: on each axis the
// nodes whose centres lie within `tolerance` of the first of their run are aligned on one centre (a pinned member's, else the lower median
// member's with its start on the grid); every other unpinned box has its start snapped to the grid; overlaps are removed by the overlap pass,
// which moves an aligned box only off its aligned axis (a box aligned on both axes that overlaps another keeps only its column, so a pile is
// spread along y rather than frozen); and a node that moved further than its bound (`maxMove`, else half its larger side plus the tolerance
// and the grid) is pulled back along its move to the bound, else to where it was, unless both put it on another box: no overlap wins over the
// bound, so only boxes that started on or against another may move further. Sizes and pinned boxes never change. Fixed order, no randomness: deterministic.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { removeOverlap } from './overlap.js';
import type { Boxes } from './passes.js';
import type { LayoutAlgorithm, LayoutConstraint, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

type Axis = 'x' | 'y';

/**
 * Options of the `tidy` layout.
 *
 * @public
 */
export type TidyOptions = {
  /** The grid step starts are snapped to, px; 0 for no grid (default 8). */
  readonly grid: number;
  /** How close two centres must be for their boxes to be aligned, px (default 10). */
  readonly tolerance: number;
  /** The furthest any box may move, px (default: half its larger side plus the tolerance and the grid). */
  readonly maxMove?: number | undefined;
};

const schema = z
  .strictObject({
    grid: z.number().finite().min(0).default(8),
    tolerance: z.number().finite().min(0).default(10),
    maxMove: z.number().finite().min(0).optional(),
  })
  .default({ grid: 8, tolerance: 10 });

const compare = (a: LayoutNode, b: LayoutNode): number => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const centreOf = (b: Box, axis: Axis): number => (axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2);
const startOf = (b: Box, axis: Axis): number => (axis === 'x' ? b.x : b.y);
const sizeOf = (b: Box, axis: Axis): number => (axis === 'x' ? b.w : b.h);
const withStart = (b: Box, axis: Axis, start: number): Box => (axis === 'x' ? { ...b, x: start } : { ...b, y: start });
const onGrid = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid + 0 : v);

/** Runs of nodes along `axis` whose centres lie within `tolerance` of the run's first, in order of centre. */
function runsOf(nodes: readonly LayoutNode[], axis: Axis, tolerance: number): LayoutNode[][] {
  const sorted = [...nodes].sort((a, b) => centreOf(a.box, axis) - centreOf(b.box, axis) || compare(a, b));
  const runs: LayoutNode[][] = [];
  for (const n of sorted) {
    const run = runs.at(-1);
    const first = run?.[0];
    if (run && first && centreOf(n.box, axis) - centreOf(first.box, axis) <= tolerance) run.push(n);
    else runs.push([n]);
  }
  return runs;
}

/** The centre a run is aligned on: its first pinned member's (canonical order), else the lower median member's with its start on the grid. */
function targetOf(run: readonly LayoutNode[], axis: Axis, grid: number): number {
  const pinned = run.filter((n) => n.pinned).sort(compare)[0];
  if (pinned) return centreOf(pinned.box, axis);
  const median = run[Math.floor((run.length - 1) / 2)] as LayoutNode;
  return onGrid(startOf(median.box, axis), grid) + sizeOf(median.box, axis) / 2;
}

/** Align the near-aligned runs on `axis` and put every other unpinned start on the grid; the runs, as constraints that keep them aligned. */
function alignAxis(input: LayoutInput, boxes: Map<string, Box>, axis: Axis, o: TidyOptions): LayoutConstraint[] {
  const aligned: LayoutConstraint[] = [];
  for (const run of runsOf(input.nodes, axis, o.tolerance)) {
    if (run.length > 1) aligned.push({ type: 'align', axis, at: 'center', nodes: run.map((n) => n.id) });
    const target = run.length > 1 ? targetOf(run, axis, o.grid) : undefined;
    for (const n of run.filter((m) => !m.pinned)) {
      const b = boxes.get(n.id) as Box;
      boxes.set(n.id, withStart(b, axis, target === undefined ? onGrid(startOf(b, axis), o.grid) : target - sizeOf(b, axis) / 2));
    }
  }
  return aligned;
}

/** The space the pipeline's overlap pass keeps between boxes (its default margin), px. */
const MARGIN = 1;
const lap = (aStart: number, aLen: number, bStart: number, bLen: number): number => Math.min(aStart + aLen, bStart + bLen) - Math.max(aStart, bStart);
/** True when `a` and `b` overlap or are closer than the overlap pass's margin. */
const touches = (a: Box, b: Box): boolean => lap(a.x, a.w, b.x, b.w) + MARGIN > 1e-9 && lap(a.y, a.h, b.y, b.h) + MARGIN > 1e-9;
const touchesAny = (id: string, b: Box, boxes: Boxes): boolean => Object.entries(boxes).some(([other, o]) => other !== id && touches(b, o));

const alignedOn = (aligned: readonly LayoutConstraint[], axis: Axis): Set<string> =>
  new Set(aligned.flatMap((c) => (c.type === 'align' && c.axis === axis ? c.nodes : [])));

/**
 * The align constraints without the y alignment of each box aligned on both axes that overlaps another such box: the overlap pass holds a box
 * aligned on both axes like a pin, so two of them on top of each other would stay there.
 */
function unfrozen(aligned: readonly LayoutConstraint[], boxes: Map<string, Box>): LayoutConstraint[] {
  const inY = alignedOn(aligned, 'y');
  const both = Object.fromEntries([...alignedOn(aligned, 'x')].filter((id) => inY.has(id)).map((id) => [id, boxes.get(id) as Box]));
  const piled = new Set(Object.keys(both).filter((id) => touchesAny(id, both[id] as Box, both)));
  return aligned
    .map((c) => (c.type === 'align' && c.axis === 'y' ? { ...c, nodes: c.nodes.filter((id) => !piled.has(id)) } : c))
    .filter((c) => c.type !== 'align' || c.nodes.length > 1);
}

/** How far node `n` may move: `maxMove`, else half its larger side plus the tolerance and the grid. */
const boundOf = (n: LayoutNode, o: TidyOptions): number => o.maxMove ?? Math.max(n.box.w, n.box.h) / 2 + o.tolerance + o.grid;

/** Pull each unpinned box that moved beyond its bound back along its move to the bound, else to where it was, whichever is on no other box. */
function bounded(input: LayoutInput, boxes: Boxes, o: TidyOptions): Boxes {
  const out: Record<string, Box> = { ...boxes };
  for (const n of input.nodes) {
    const b = boxes[n.id];
    if (n.pinned || !b) continue;
    const [dx, dy] = [b.x - n.box.x, b.y - n.box.y];
    const distance = Math.hypot(dx, dy);
    const bound = boundOf(n, o);
    if (distance <= bound) continue;
    // half a pixel inside the bound, so the pipeline's half-pixel snap cannot carry the box past it
    const to = Math.max(0, bound - 0.5) / distance;
    const back = { ...b, x: n.box.x + dx * to, y: n.box.y + dy * to };
    // where the bound is taken, the box's own first place, when that is free
    const free = [back, n.box].find((place) => !touchesAny(n.id, place, out));
    if (free) out[n.id] = free;
  }
  return out;
}

function run(input: LayoutInput, o: TidyOptions): LayoutOutput {
  const boxes = new Map(input.nodes.map((n) => [n.id, n.box] as const));
  const aligned = unfrozen([...alignAxis(input, boxes, 'x', o), ...alignAxis(input, boxes, 'y', o)], boxes);
  // the overlap pass moves an aligned box only off the axis it is aligned on, so pulling boxes apart keeps the alignment
  const separated = removeOverlap({ ...input, constraints: [...(input.constraints ?? []), ...aligned] }, Object.fromEntries(boxes));
  return { boxes: bounded(input, separated, o) };
}

/**
 * The `tidy` layout: the boxes as they are, near-aligned ones aligned, snapped to the grid and pulled apart, each moved at most its bound.
 *
 * @public
 */
export const tidyLayout: LayoutAlgorithm<TidyOptions> = {
  id: 'tidy',
  describe: 'Tidy up: keeps the boxes where they are, aligns near-aligned ones, snaps to the grid and removes overlaps with bounded moves.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<TidyOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `tidy options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run,
};
