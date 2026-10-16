// The built-in `stack` layout (05 §3, FR-DSL-005): unpinned nodes in model order along one axis, with a gap, from the padded start of
// the frame, aligned on the other axis; pinned nodes keep their boxes and the stack steps past any it would overlap. It is the fallback
// FluxScript places with until `layered` lands in M13 (ADR-0030).
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Options of the `stack` layout.
 *
 * @public
 */
export type StackOptions = {
  /** `down` (default) or `right`. */
  readonly direction: 'down' | 'right';
  /** Space between consecutive boxes, px (default 24). */
  readonly gap: number;
  /** Where narrower boxes sit across the stack (default `start`). */
  readonly align: 'start' | 'center' | 'end';
  /** Space between the frame's edge and the stack, px (default 80). */
  readonly padding: number;
  /** Length along the stack, px, after which a box starts a new line beside the first (default 0: never wrap). Sizes and gaps are counted; a box a pin pushes forward can end a line longer than this. */
  readonly wrap: number;
};

const DEFAULTS: StackOptions = { direction: 'down', gap: 24, align: 'start', padding: 80, wrap: 0 };
const KEYS = new Set(Object.keys(DEFAULTS));

const half = (n: number) => Math.round(n * 2) / 2;
// the cross-axis start of a line rounds up and a box's offset in it rounds down: a box then stays inside its line, and the next line starts past it
const downHalf = (n: number) => Math.floor(n * 2) / 2 || 0;
// the main-axis start rounds up, never down: rounding down could pull a box back over the one before it or a pin (M12.12 review)
const halfUp = (n: number) => Math.ceil(n * 2) / 2 || 0; // no epsilon: a value a hair past a half pixel goes to the next one; `|| 0`: never -0
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const fail = (message: string): OptionsResult<StackOptions> => ({ ok: false, message });

/** One option's value, or why it is refused. */
function option(key: string, value: unknown): string | undefined {
  const nonNegative = typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (key === 'direction') return value === 'down' || value === 'right' ? undefined : 'direction must be "down" or "right"';
  if (key === 'align') return value === 'start' || value === 'center' || value === 'end' ? undefined : 'align must be "start", "center" or "end"';
  return nonNegative ? undefined : `${key} must be a number of px, 0 or more`;
}

function parseOptions(raw: unknown): OptionsResult<StackOptions> {
  if (raw === undefined) return { ok: true, value: DEFAULTS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('stack options must be an object');
  // an option set to undefined is absent, as the schema reads it
  const given = Object.entries(raw).filter(([, value]) => value !== undefined);
  for (const [key, value] of given) {
    if (!KEYS.has(key)) return fail(`unknown stack option "${key}" (direction, gap, align, padding, wrap)`);
    const problem = option(key, value);
    if (problem) return fail(problem);
  }
  return { ok: true, value: { ...DEFAULTS, ...(Object.fromEntries(given) as Partial<StackOptions>) } };
}

/** The box of `n` with its main-axis start at `main` and its cross-axis offset `cross`. */
function boxAt(n: LayoutNode, down: boolean, main: number, cross: number): Box {
  return down ? { x: half(cross), y: halfUp(main), w: n.box.w, h: n.box.h } : { x: halfUp(main), y: half(cross), w: n.box.w, h: n.box.h };
}

/** Where the stack starts, how wide it is across, and how a box sits across it. */
type Axis = { readonly down: boolean; readonly span: number; readonly crossStart: number; readonly o: StackOptions };

/** The cross-axis offset of `n` in the stack. */
function crossOf(axis: Axis, n: LayoutNode): number {
  const slack = axis.span - (axis.down ? n.box.w : n.box.h);
  return axis.crossStart + downHalf(axis.o.align === 'start' ? 0 : axis.o.align === 'center' ? slack / 2 : slack);
}

/** `n` placed at `main` or, when that overlaps a pinned box, past every pinned box it would overlap (each step moves forward). */
function place(axis: Axis, n: LayoutNode, start: number, pinned: readonly Box[]): Box {
  let main = start;
  let box = boxAt(n, axis.down, main, crossOf(axis, n));
  for (let hit = pinned.filter((p) => overlaps(box, p)); hit.length > 0; hit = pinned.filter((p) => overlaps(box, p))) {
    main = Math.max(...hit.map((p) => (axis.down ? p.y + p.h : p.x + p.w))) + axis.o.gap;
    box = boxAt(n, axis.down, main, crossOf(axis, n));
  }
  return box;
}

/** The unpinned nodes cut into lines: one line, or a new line whenever the next box would pass `wrap` px along the stack. */
function linesOf(loose: readonly LayoutNode[], o: StackOptions): LayoutNode[][] {
  const down = o.direction === 'down';
  const lines: LayoutNode[][] = [];
  let extent = 0;
  for (const n of loose) {
    const size = down ? n.box.h : n.box.w;
    const last = lines[lines.length - 1];
    if (last === undefined || (o.wrap > 0 && extent + o.gap + size > o.wrap)) {
      lines.push([n]);
      extent = size;
    } else {
      last.push(n);
      extent += o.gap + size;
    }
  }
  return lines;
}

function run(input: LayoutInput, o: StackOptions): LayoutOutput {
  const down = o.direction === 'down';
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pinned = nodes.filter((n) => n.pinned).map((n) => n.box);
  // a Map, then fromEntries: a record id may be `__proto__`, which an assignment to a plain object would not keep as a key
  const boxes = new Map<string, Box>();
  for (const n of nodes) if (n.pinned) boxes.set(n.id, n.box);
  // each line is a stack of its own, beside the one before it
  let crossStart = halfUp((down ? input.frame.x : input.frame.y) + o.padding);
  for (const line of linesOf(
    nodes.filter((n) => !n.pinned),
    o,
  )) {
    const span = Math.max(...line.map((n) => (down ? n.box.w : n.box.h)));
    const axis: Axis = { down, o, span, crossStart };
    let main = (down ? input.frame.y : input.frame.x) + o.padding;
    for (const n of line) {
      const box = place(axis, n, main, pinned);
      boxes.set(n.id, box);
      main = (down ? box.y + box.h : box.x + box.w) + o.gap;
    }
    crossStart = halfUp(crossStart + span + o.gap);
  }
  return { boxes: Object.fromEntries(boxes) };
}

/**
 * The `stack` layout.
 *
 * @public
 */
export const stackLayout: LayoutAlgorithm<StackOptions> = {
  id: 'stack',
  describe: 'Boxes in one row or column, with an even gap.',
  version: '2', // 2: a box's cross-axis offset rounds down to the half pixel, so wrapped lines never overlap (fractional sizes only)
  schema: z
    .strictObject({
      direction: z.enum(['down', 'right']).default(DEFAULTS.direction),
      gap: z.number().finite().min(0).default(DEFAULTS.gap),
      align: z.enum(['start', 'center', 'end']).default(DEFAULTS.align),
      padding: z.number().finite().min(0).default(DEFAULTS.padding),
      wrap: z.number().finite().min(0).default(DEFAULTS.wrap),
    })
    .default(DEFAULTS),
  capabilities: { pins: true, compound: false, runsIn: 'either' },
  parseOptions,
  run,
};
