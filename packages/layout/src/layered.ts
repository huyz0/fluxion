// The built-in `layered` layout (05 §3, FR-LAY-002, ADR-0034): flow and hierarchy diagrams in ranks, top to bottom, left to right, bottom to
// top or right to left, backed by `@dagrejs/dagre`. Determinism (FR-LAY-008): nodes and edges go into dagre in canonical order (model
// order, then id) under index names, because dagre keeps nodes in plain objects and breaks on ids such as `constructor`; dagre itself uses
// no randomness. Pinned nodes take part in the ranking through their edges and keep their boxes; the others are placed from the padded
// start of the frame. Overlap with pins, rounding and the cache are the pipeline's (ADR-0033), not this algorithm's.
import dagre from '@dagrejs/dagre';
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `layered` layout.
 *
 * @public
 */
export type LayeredOptions = {
  /** Where ranks run: `down` (default), `right`, `up` or `left`. */
  readonly direction: 'down' | 'right' | 'up' | 'left';
  /** Preset for the two gaps: `compact`, `comfortable` (default) or `spacious`. */
  readonly spacing: 'compact' | 'comfortable' | 'spacious';
  /** Space between boxes of one rank, px (default: from `spacing`). */
  readonly nodeGap?: number | undefined;
  /** Space between ranks, px (default: from `spacing`). */
  readonly rankGap?: number | undefined;
  /** Space between the frame's edge and the diagram, px (default 80). */
  readonly padding: number;
};

const DEFAULTS: LayeredOptions = { direction: 'down', spacing: 'comfortable', padding: 80 };
const KEYS = new Set([...Object.keys(DEFAULTS), 'nodeGap', 'rankGap']);
const DIRECTIONS = ['down', 'right', 'up', 'left'] as const;
const SPACINGS = ['compact', 'comfortable', 'spacious'] as const;
/** dagre's name for each direction. */
const RANKDIR = { down: 'TB', right: 'LR', up: 'BT', left: 'RL' } as const;
/** The node gap and rank gap of each spacing preset, px. */
const GAPS = { compact: [24, 48], comfortable: [40, 80], spacious: [64, 120] } as const;
const fail = (message: string): OptionsResult<LayeredOptions> => ({ ok: false, message });
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One option's value, or why it is refused. */
function option(key: string, value: unknown): string | undefined {
  if (key === 'direction') return DIRECTIONS.includes(value as LayeredOptions['direction']) ? undefined : 'direction must be "down", "right", "up" or "left"';
  if (key === 'spacing') return SPACINGS.includes(value as LayeredOptions['spacing']) ? undefined : 'spacing must be "compact", "comfortable" or "spacious"';
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? undefined : `${key} must be a number of px, 0 or more`;
}

function parseOptions(raw: unknown): OptionsResult<LayeredOptions> {
  if (raw === undefined) return { ok: true, value: DEFAULTS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('layered options must be an object');
  const given = Object.entries(raw).filter(([, value]) => value !== undefined);
  for (const [key, value] of given) {
    if (!KEYS.has(key)) return fail(`unknown layered option "${key}" (direction, spacing, nodeGap, rankGap, padding)`);
    const problem = option(key, value);
    if (problem) return fail(problem);
  }
  return { ok: true, value: { ...DEFAULTS, ...(Object.fromEntries(given) as Partial<LayeredOptions>) } };
}

/**
 * Above this many nodes dagre ranks with its `tight-tree` ranker instead of `network-simplex`: the ranks are slightly less compact, but a
 * 500-node chart is laid out in a quarter of the time (NFR-PERF-005, LAYOUT_500_NODES_MS); a chart this large is not read for its minimal ranks.
 */
const SIMPLEX_MAX_NODES = 200;

/** dagre's centres for `nodes` (by index), ranked along `o.direction`, with the connections `edges` given as index pairs. */
function rank(nodes: readonly LayoutNode[], edges: ReadonlyArray<readonly [number, number]>, o: LayeredOptions): Array<{ x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  const [nodeGap, rankGap] = GAPS[o.spacing];
  g.setGraph({
    rankdir: RANKDIR[o.direction],
    nodesep: o.nodeGap ?? nodeGap,
    ranksep: o.rankGap ?? rankGap,
    marginx: 0,
    marginy: 0,
    ranker: nodes.length > SIMPLEX_MAX_NODES ? 'tight-tree' : 'network-simplex',
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const [i, n] of nodes.entries()) g.setNode(`n${i}`, { width: n.box.w, height: n.box.h });
  for (const [from, to] of edges) g.setEdge(`n${from}`, `n${to}`);
  dagre.layout(g);
  return nodes.map((_, i) => {
    const at = g.node(`n${i}`);
    return { x: at?.x ?? 0, y: at?.y ?? 0 };
  });
}

/** The connections between known, different nodes, as sorted index pairs. */
function edgePairs(input: LayoutInput, index: ReadonlyMap<string, number>): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];
  for (const e of [...(input.edges ?? [])].sort((a, b) => a.order - b.order || compare(a.id, b.id))) {
    const [from, to] = [index.get(e.source), index.get(e.target)];
    if (from !== undefined && to !== undefined && from !== to) pairs.push([from, to]);
  }
  return pairs;
}

function run(input: LayoutInput, o: LayeredOptions): LayoutOutput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  const index = new Map(nodes.map((n, i) => [n.id, i] as const));
  const centres = rank(nodes, edgePairs(input, index), o);
  const loose = nodes.map((n, i) => ({ n, c: centres[i] as { x: number; y: number } })).filter(({ n }) => !n.pinned);
  // the top-left of the placed (unpinned) nodes goes to the padded start of the frame
  const left = Math.min(...loose.map(({ n, c }) => c.x - n.box.w / 2));
  const top = Math.min(...loose.map(({ n, c }) => c.y - n.box.h / 2));
  // a Map, then fromEntries: a record id may be `__proto__`, which an assignment to a plain object would not keep as a key
  const boxes = new Map<string, Box>();
  for (const n of nodes) if (n.pinned) boxes.set(n.id, n.box);
  for (const { n, c } of loose) {
    boxes.set(n.id, {
      x: c.x - n.box.w / 2 - left + input.frame.x + o.padding,
      y: c.y - n.box.h / 2 - top + input.frame.y + o.padding,
      w: n.box.w,
      h: n.box.h,
    });
  }
  return { boxes: Object.fromEntries(boxes) };
}

/**
 * The `layered` layout.
 *
 * @public
 */
export const layeredLayout: LayoutAlgorithm<LayeredOptions> = {
  id: 'layered',
  describe: 'Flow layout by layers along the edges, for diagrams with direction.',
  version: '1',
  schema: z
    .strictObject({
      direction: z.enum(DIRECTIONS).default(DEFAULTS.direction),
      spacing: z.enum(SPACINGS).default(DEFAULTS.spacing),
      nodeGap: z.number().finite().min(0).optional(),
      rankGap: z.number().finite().min(0).optional(),
      padding: z.number().finite().min(0).default(DEFAULTS.padding),
    })
    .default(DEFAULTS),
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions,
  run,
};
