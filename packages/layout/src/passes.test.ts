// FR-LAY-004 and FR-LAY-008: the pins and snap post-passes.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyPins, snapBoxes } from './passes.js';
import type { LayoutInput, LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, x: number, y: number, pinned = false): LayoutNode => ({
  id,
  box: { x, y, w: 100, h: 50 },
  order: 0,
  ...(pinned ? { pinned: true } : {}),
});
const input = (nodes: readonly LayoutNode[]): LayoutInput => ({ frame, nodes });

describe('post-passes (FR-LAY-004, FR-LAY-008)', () => {
  it('FR-LAY-004: the pins pass puts a pinned node back on its input box, whatever the algorithm did to it', () => {
    const nodes = [node('free', 10, 10), node('pin', 300, 200, true)];
    const moved = { free: { x: 40, y: 50, w: 100, h: 50 }, pin: { x: 0, y: 0, w: 999, h: 999 } };
    expect(applyPins(input(nodes), moved)).toEqual({ free: moved.free, pin: { x: 300, y: 200, w: 100, h: 50 } });
  });

  it('FR-LAY-004: the pins pass adds a pinned node the algorithm left out and drops ids the input does not have', () => {
    const nodes = [node('free', 10, 10), node('pin', 300, 200, true)];
    const out = applyPins(input(nodes), { free: { x: 1, y: 2, w: 100, h: 50 }, ghost: { x: 5, y: 5, w: 1, h: 1 } });
    expect(Object.keys(out).sort()).toEqual(['free', 'pin']);
    expect(out['pin']).toEqual({ x: 300, y: 200, w: 100, h: 50 });
    expect(applyPins(input([node('__proto__', 1, 2, true)]), {})).toHaveProperty('__proto__');
  });

  it('FR-LAY-008: the snap pass rounds positions to the half pixel, halves toward +infinity, and never produces -0', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => node(id, 0, 0));
    const out = snapBoxes(input(nodes), {
      a: { x: 10.2, y: 10.3, w: 100.1, h: 50.7 },
      b: { x: -0.25, y: -0.24, w: 1, h: 1 },
      c: { x: -0.75, y: 0.75, w: 1, h: 1 },
      d: { x: 0.25, y: 0.74, w: 1, h: 1 },
      e: { x: 1e-12, y: -1e-12, w: 1, h: 1 },
    });
    expect(out['a']).toEqual({ x: 10, y: 10.5, w: 100.1, h: 50.7 });
    expect(out['b']).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(Object.is(out['b']?.x, 0) && Object.is(out['b']?.y, 0)).toBe(true);
    expect(out['c']).toEqual({ x: -0.5, y: 1, w: 1, h: 1 });
    expect(out['d']).toEqual({ x: 0.5, y: 0.5, w: 1, h: 1 });
    expect(Object.is(out['e']?.x, 0) && Object.is(out['e']?.y, 0)).toBe(true);
  });

  it('FR-LAY-008: snapping leaves pinned boxes exact, and is idempotent for any boxes', () => {
    const coordinate = fc.double({ min: -2000, max: 2000, noNaN: true });
    fc.assert(
      fc.property(fc.array(fc.tuple(coordinate, coordinate, fc.boolean()), { minLength: 1, maxLength: 20 }), (items) => {
        const nodes = items.map(([x, y, pinned], i) => node(`n${i}`, x, y, pinned));
        const boxes = Object.fromEntries(nodes.map((n) => [n.id, n.box]));
        const once = snapBoxes(input(nodes), boxes);
        expect(snapBoxes(input(nodes), once)).toEqual(once);
        for (const n of nodes) {
          const b = once[n.id] as { x: number; y: number; w: number; h: number };
          if (n.pinned) expect(b).toEqual(n.box);
          else {
            expect(Math.abs((b.x * 2) % 1)).toBe(0);
            expect(Math.abs((b.y * 2) % 1)).toBe(0);
            expect(Math.abs(b.x - n.box.x)).toBeLessThanOrEqual(0.5);
            expect([b.w, b.h]).toEqual([n.box.w, n.box.h]);
          }
        }
      }),
      { numRuns: 300, seed: 20261015 },
    );
  });
});
