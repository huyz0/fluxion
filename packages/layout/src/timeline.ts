// The built-in `timeline` layout (05 §3, FR-LAY-003, ADR-0045): events in time order along one axis, one band (lane) per `hints.lane`.
// Nodes are ordered by `hints.date` (a number, or a text such as an ISO 8601 date, which sorts as text after the numbers; nodes without a date come
// last, in model order), ties in canonical order (model order, then id). Each takes its own stretch of the axis, a node gap after the one before, whatever
// its lane, so no two boxes overlap and time never runs backwards. Lanes are bands across the axis in the order each lane first appears (nodes
// without a lane form one lane of their own), a rank gap apart; a band is as thick as its thickest box and centres its boxes.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { compare, GAPS, intoFrame } from './tree.js';
import type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `timeline` layout.
 *
 * @public
 */
export type TimelineOptions = {
  /** Where time runs: `right` (default; lanes are rows) or `down` (lanes are columns). */
  readonly direction: 'right' | 'down';
  /** Preset for the two gaps: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Space between consecutive events along the axis, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Space between lanes, px (default: from `spacing`). */
  readonly rankGap?: number | undefined;
  /** Space between the frame's edge and the diagram, px (default 80). */
  readonly padding: number;
};

const SPACINGS = ['compact', 'comfortable', 'spacious'] as const;
const schema = z
  .strictObject({
    direction: z.enum(['right', 'down']).default('right'),
    spacing: z.enum(SPACINGS).default('comfortable'),
    nodeGap: z.number().finite().min(0).optional(),
    rankGap: z.number().finite().min(0).optional(),
    padding: z.number().finite().min(0).default(80),
  })
  .default({ direction: 'right', spacing: 'comfortable', padding: 80 });

/** The lane a node's hints name (as text), or `undefined`. */
export function laneOf(n: LayoutNode): string | undefined {
  const lane = n.hints?.['lane'];
  return typeof lane === 'string' || typeof lane === 'number' ? String(lane) : undefined;
}

/** `nodes` (already in canonical order) grouped by lane, the lanes in the order each first appears. */
export function groupByLane(nodes: readonly LayoutNode[]): Map<string | undefined, LayoutNode[]> {
  const lanes = new Map<string | undefined, LayoutNode[]>();
  for (const n of nodes) lanes.set(laneOf(n), [...(lanes.get(laneOf(n)) ?? []), n]);
  return lanes;
}

/** A node's date: a number, or a text (ISO 8601 dates and times sort as text); undefined when it has none. */
function dateOf(n: LayoutNode): number | string | undefined {
  const date = n.hints?.['date'];
  return typeof date === 'number' && Number.isFinite(date) ? date : typeof date === 'string' ? date : undefined;
}

const rank = (d: number | string | undefined) => (typeof d === 'number' ? 0 : typeof d === 'string' ? 1 : 2);

/** Earlier first: numbers by value, then texts by code units, then undated; equal dates compare equal, so the stable sort keeps canonical order. */
const byTime = (a: LayoutNode, b: LayoutNode): number => {
  const [da, db] = [dateOf(a), dateOf(b)];
  if (typeof da === 'number' && typeof db === 'number') return da === db ? 0 : da < db ? -1 : 1;
  if (typeof da === 'string' && typeof db === 'string') return compare(da, db);
  return rank(da) - rank(db);
};

type Band = { readonly start: number; readonly thickness: number };

function run(input: LayoutInput, o: TimelineOptions): LayoutOutput {
  const all = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  if (all.length === 0) return { boxes: {} };
  const canonical = all.filter((n) => !n.pinned);
  const [nodeGap, rankGap] = GAPS[o.spacing];
  const along = o.direction === 'right';
  // main axis: along time; cross axis: across the lanes
  const main = (n: LayoutNode) => (along ? n.box.w : n.box.h);
  const cross = (n: LayoutNode) => (along ? n.box.h : n.box.w);
  const bands = new Map<string | undefined, Band>();
  let edge = 0;
  for (const [lane, members] of groupByLane(canonical)) {
    const thickness = Math.max(...members.map(cross));
    bands.set(lane, { start: edge, thickness });
    edge += thickness + (o.rankGap ?? rankGap);
  }
  const placed = new Map<string, Box>();
  let cursor = 0;
  for (const n of [...canonical].sort(byTime)) {
    const band = bands.get(laneOf(n)) as Band;
    const at = band.start + (band.thickness - cross(n)) / 2;
    placed.set(n.id, along ? { x: cursor, y: at, w: n.box.w, h: n.box.h } : { x: at, y: cursor, w: n.box.w, h: n.box.h });
    cursor += main(n) + (o.nodeGap ?? nodeGap);
  }
  for (const n of all) if (n.pinned) placed.set(n.id, n.box);
  return intoFrame(all, placed, input.frame, o.padding);
}

/**
 * The `timeline` layout: events in date order along an axis, one band per lane.
 *
 * @public
 */
export const timelineLayout: LayoutAlgorithm<TimelineOptions> = {
  id: 'timeline',
  describe: 'Timeline: events in date order along one axis, one band per lane hint.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<TimelineOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `timeline options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run,
};
