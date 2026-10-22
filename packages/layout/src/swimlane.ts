// The built-in `swimlane` layout (05 §3, FR-LAY-003, ADR-0045): a flow in lanes x phases. The phases are `layered`'s ranks over all the
// unpinned nodes and every edge, lanes or not, so a step always comes after the step that hands over to it, across lanes too (review M17.7
// F1). Then the lane pass: each lane (`hints.lane`, in the order each first appears; nodes without one form a lane of their own) is a band
// across the ranks, the bands a rank gap apart in that order. Inside a band, boxes keep their place along the ranks and are dealt to tracks,
// each box to the first track whose last box ends a node gap before it starts, so no two overlap; a band is as thick as its tracks. Pinned
// nodes keep their boxes and are in no band.
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { layeredLayout } from './layered.js';
import { groupByLane } from './timeline.js';
import { compare, GAPS, intoFrame } from './tree.js';
import type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `swimlane` layout.
 *
 * @public
 */
export type SwimlaneOptions = {
  /** Where ranks run: `right` (default; lanes are rows) or `down` (lanes are columns). */
  readonly direction: 'right' | 'down';
  /** Preset for the two gaps: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Space between boxes of one rank and between tracks of a lane, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Space between ranks and between lanes, px (default: from `spacing`). */
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

/** A box seen along the ranks (`at`, `size`) and across them (`thickness`). */
type Span = { readonly id: string; readonly at: number; readonly size: number; readonly thickness: number };
type Track = { end: number; thickness: number; readonly spans: Span[] };

/** `spans` (sorted by `at`) dealt to tracks: each to the first whose last box ends `gap` before it starts. */
function tracksOf(spans: readonly Span[], gap: number): Track[] {
  const tracks: Track[] = [];
  for (const s of spans) {
    const track = tracks.find((t) => t.end + gap <= s.at);
    if (track) {
      track.spans.push(s);
      track.end = s.at + s.size;
      track.thickness = Math.max(track.thickness, s.thickness);
    } else tracks.push({ end: s.at + s.size, thickness: s.thickness, spans: [s] });
  }
  return tracks;
}

/** Where each box of one lane goes across the ranks, from `start`; returns the band's thickness. */
function band(tracks: readonly Track[], start: number, gap: number, across: Map<string, number>): number {
  let edge = start;
  for (const t of tracks) {
    for (const s of t.spans) across.set(s.id, edge + (t.thickness - s.thickness) / 2);
    edge += t.thickness + gap;
  }
  return edge - gap - start;
}

function run(input: LayoutInput, o: SwimlaneOptions): LayoutOutput {
  const all = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  if (all.length === 0) return { boxes: {} };
  const loose = all.filter((n) => !n.pinned);
  const rows = o.direction === 'right';
  const [nodeGap, rankGap] = [o.nodeGap ?? GAPS[o.spacing][0], o.rankGap ?? GAPS[o.spacing][1]];
  const options = { direction: o.direction, spacing: o.spacing, nodeGap: o.nodeGap, rankGap: o.rankGap, padding: 0 };
  const ranked: Readonly<Record<string, Box>> =
    loose.length === 0 ? {} : layeredLayout.run({ frame: input.frame, nodes: loose, edges: input.edges ?? [] }, options).boxes;
  const spanOf = (n: LayoutNode): Span => {
    const b = ranked[n.id] as Box;
    return rows ? { id: n.id, at: b.x, size: b.w, thickness: b.h } : { id: n.id, at: b.y, size: b.h, thickness: b.w };
  };
  const across = new Map<string, number>();
  let edge = 0;
  for (const members of groupByLane(loose).values()) {
    // a stable sort: boxes at the same place keep canonical order
    const spans = members.map(spanOf).sort((a, b) => a.at - b.at);
    edge += band(tracksOf(spans, nodeGap), edge, nodeGap, across) + rankGap;
  }
  const placed = new Map<string, Box>(all.filter((n) => n.pinned).map((n) => [n.id, n.box]));
  for (const n of loose) {
    const b = ranked[n.id] as Box;
    placed.set(n.id, rows ? { ...b, y: across.get(n.id) as number } : { ...b, x: across.get(n.id) as number });
  }
  return intoFrame(all, placed, input.frame, o.padding);
}

/**
 * The `swimlane` layout: a layered flow inside each lane, the lanes stacked.
 *
 * @public
 */
export const swimlaneLayout: LayoutAlgorithm<SwimlaneOptions> = {
  id: 'swimlane',
  describe: 'Swimlanes: a layered flow inside each lane hint, the lanes stacked as bands.',
  version: '1',
  schema,
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions(raw: unknown): OptionsResult<SwimlaneOptions> {
    const r = schema.safeParse(raw);
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `swimlane options: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  },
  run,
};
