// FR-LAY-004: the overlap post-pass leaves no unpinned box overlapping another, and never moves a pinned box.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { overlapCount, removeOverlap } from './overlap.js';
import type { Boxes } from './passes.js';
import type { LayoutInput, LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, order: number, pinned = false): LayoutNode => ({
  id,
  box: { x: 0, y: 0, w: 100, h: 50 },
  order,
  ...(pinned ? { pinned: true } : {}),
});
const input = (nodes: readonly LayoutNode[]): LayoutInput => ({ frame, nodes });
const box = (x: number, y: number, w = 100, h = 50) => ({ x, y, w, h });
type Placed = ReturnType<typeof box>;
/** The gap between two boxes on the axis where they are closer (negative: they overlap on both axes). */
const gap = (a: Placed, b: Placed) => Math.max(Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));

/** Sizes are unchanged, pinned boxes are exact, and every unpinned box is at least the margin from every other box. */
function expectCleared(nodes: readonly LayoutNode[], out: Boxes): void {
  for (const n of nodes) {
    const b = out[n.id] as Placed;
    expect([b.w, b.h]).toEqual([n.box.w, n.box.h]);
    if (n.pinned) expect(b).toEqual(n.box);
    else for (const o of nodes.filter((m) => m !== n)) expect(gap(b, out[o.id] as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
  }
}

describe('overlap pass (FR-LAY-004)', () => {
  it('FR-LAY-004: a fixture of overlapping boxes ends with a margin between them, the earlier box where it was', () => {
    const nodes = [node('a', 0), node('b', 1), node('c', 2)];
    const boxes: Boxes = { a: box(0, 0), b: box(40, 10), c: box(60, 20) };
    const out = removeOverlap(input(nodes), boxes);
    expect(out['a']).toEqual(box(0, 0));
    const [a, b, c] = ['a', 'b', 'c'].map((id) => out[id] as Placed);
    expect(gap(a as Placed, b as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(gap(a as Placed, c as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(gap(b as Placed, c as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(overlapCount(out)).toBe(0);
    for (const id of ['a', 'b', 'c']) expect([out[id]?.w, out[id]?.h]).toEqual([100, 50]);
  });

  it('FR-LAY-004: pinned boxes do not move, and the other box of a pair moves clear of them', () => {
    const nodes = [node('free', 0), node('pin', 1, true)];
    const out = removeOverlap(input(nodes), { free: box(10, 10), pin: box(0, 0) });
    expect(out['pin']).toEqual(box(0, 0));
    expect(gap(out['free'] as Placed, out['pin'] as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
    // the later box is pinned: the earlier, unpinned one is the one that moves
    const reversed = removeOverlap(input([node('pin', 0, true), node('free', 1)]), { pin: box(0, 0), free: box(10, 10) });
    expect(reversed['pin']).toEqual(box(0, 0));
    expect(gap(reversed['free'] as Placed, reversed['pin'] as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it('FR-LAY-004: overlapping pinned pairs stay, are counted, and every other box keeps clear of both', () => {
    const nodes = [node('p', 0, true), node('q', 1, true), node('free', 2)];
    const boxes: Boxes = { p: box(0, 0), q: box(50, 25), free: box(60, 30) };
    const out = removeOverlap(input(nodes), boxes);
    expect([out['p'], out['q']]).toEqual([box(0, 0), box(50, 25)]);
    expect(overlapCount(out)).toBe(1);
    expect(gap(out['free'] as Placed, out['p'] as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(gap(out['free'] as Placed, out['q'] as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it('FR-LAY-004: a box with no free place nearby, or in a pile of identical boxes, still ends clear of every other', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const pile = removeOverlap(input(ids.map((id, i) => node(id, i))), Object.fromEntries(ids.map((id) => [id, box(0, 0)])));
    expect(overlapCount(pile)).toBe(0);
    const wall = node('wall', 0, true);
    const walled = removeOverlap(input([wall, node('x', 1), node('y', 2)]), { wall: box(-5000, -5000, 10_000, 10_000), x: box(0, 0), y: box(0, 0) });
    expect(overlapCount({ x: walled['x'] as Placed, y: walled['y'] as Placed })).toBe(0);
    for (const id of ['x', 'y']) expect(gap(walled[id] as Placed, walled['wall'] as Placed)).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it('FR-LAY-004: preferAxis chooses the axis a pair is separated along, margin the space left, and ids without a box are ignored', () => {
    const nodes = [node('a', 0), node('b', 1), node('ghost', 2)];
    const boxes: Boxes = { a: box(0, 0), b: box(90, 40) };
    const alongX = removeOverlap(input(nodes), boxes, { preferAxis: 'x' });
    const alongY = removeOverlap(input(nodes), boxes, { preferAxis: 'y' });
    expect([alongX['b']?.y, alongY['b']?.x]).toEqual([40, 90]);
    expect(alongX['b']?.x).toBeGreaterThanOrEqual(101 - 1e-6);
    expect(alongY['b']?.y).toBeGreaterThanOrEqual(51 - 1e-6);
    const wide = removeOverlap(input(nodes), boxes, { margin: 20, preferAxis: 'x' });
    expect(wide['b']?.x).toBeGreaterThanOrEqual(120 - 1e-6);
    expect(Object.keys(alongX).sort()).toEqual(['a', 'b']);
  });

  it('FR-LAY-004: for any boxes and pins no unpinned box overlaps or touches another, pinned boxes and sizes are unchanged, and the result is deterministic', () => {
    const tenths = (max: number) => fc.integer({ min: 0, max: max * 10 }).map((n) => n / 10);
    const item = fc.record({ x: tenths(400), y: tenths(300), w: fc.integer({ min: 1, max: 200 }), h: fc.integer({ min: 1, max: 120 }), pinned: fc.boolean() });
    fc.assert(
      fc.property(fc.array(item, { minLength: 1, maxLength: 16 }), fc.constantFrom(undefined, 'x', 'y'), (items, prefer) => {
        const nodes = items.map(
          (it, i) => ({ id: `n${i}`, box: { x: it.x, y: it.y, w: it.w, h: it.h }, order: i, ...(it.pinned ? { pinned: true } : {}) }) as LayoutNode,
        );
        const boxes = Object.fromEntries(nodes.map((n) => [n.id, n.box]));
        const options = prefer ? { preferAxis: prefer } : {};
        const out = removeOverlap(input(nodes), boxes, options);
        expect(removeOverlap(input(nodes), boxes, options)).toEqual(out);
        expectCleared(nodes, out);
      }),
      { numRuns: 300, seed: 20261015 },
    );
  });
});
