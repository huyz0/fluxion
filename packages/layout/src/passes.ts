// The `pins` and `snap` post-passes (ADR-0033, ADR-0034, FR-LAY-004, FR-LAY-008): pure functions over the boxes an algorithm returned. The
// pipeline runs them in the fixed order pins, constraints, overlap, snap; `pins` first so that whatever an algorithm did to a pinned node is undone before
// anything else looks at the boxes, `snap` last so that rounding is the final step and cannot be undone by another pass.
import type { Box } from '@fluxion/geometry';
import type { LayoutInput } from './types.js';

/**
 * Boxes by node id, as an algorithm returns them and a post-pass takes them.
 *
 * @public
 */
export type Boxes = { readonly [id: string]: Box };

/**
 * The names of the post-passes, in the order the pipeline runs them.
 *
 * @public
 */
export type PostPassId = 'pins' | 'constraints' | 'overlap' | 'snap';

/** Rounds a coordinate to the half pixel, halves toward +infinity, `-0` as `0` (ADR-0034). */
const quantize = (v: number): number => Math.round(v * 2) / 2 + 0;

/**
 * Put every pinned node back on its input box and drop boxes for ids that are not in the input. A pinned node never moves, whatever the
 * algorithm did; an unpinned node the algorithm forgot is left out (the pipeline decides what to do with it).
 *
 * @public
 */
export function applyPins(input: LayoutInput, boxes: Boxes): Boxes {
  const known = new Map(input.nodes.map((n) => [n.id, n] as const));
  const out = new Map<string, Box>();
  for (const [id, box] of Object.entries(boxes)) {
    const node = known.get(id);
    if (node) out.set(id, node.pinned ? node.box : box);
  }
  for (const n of input.nodes) if (n.pinned) out.set(n.id, n.box);
  return Object.fromEntries(out);
}

/**
 * Round the position of every unpinned box to the half pixel. Sizes and pinned boxes keep their exact values (ADR-0034): a pinned box is the
 * document's own placement, and a size comes from the content, not from layout.
 *
 * @public
 */
export function snapBoxes(input: LayoutInput, boxes: Boxes): Boxes {
  const pinned = new Set(input.nodes.filter((n) => n.pinned).map((n) => n.id));
  return Object.fromEntries(Object.entries(boxes).map(([id, b]) => [id, pinned.has(id) ? b : { x: quantize(b.x), y: quantize(b.y), w: b.w, h: b.h }]));
}
