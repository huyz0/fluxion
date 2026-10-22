// FR-LAY-003: the built-in `packing` layout: boxes packed into the frame's width, largest first, none overlapping.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type PackingOptions, packingLayout } from './packing.js';
import type { LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, w: number, h: number, order: number): LayoutNode => ({ id, box: { x: 0, y: 0, w, h }, order });
const options = (raw: unknown): PackingOptions => {
  const r = packingLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const overlap = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Fixture packing-50: 50 cards of mixed sizes, a deterministic mix of four widths and three heights. */
function cardsFixture(): LayoutInput {
  const widths = [260, 200, 340, 240];
  const heights = [120, 160, 90];
  return { frame, nodes: Array.from({ length: 50 }, (_, i) => node(`c${i}`, widths[i % 4] as number, heights[(i * 7) % 3] as number, i)) };
}

describe('packing layout (FR-LAY-003)', () => {
  it('FR-LAY-003: golden packing-50; its boxes fill at least 70 % of the frame and stay inside it', () => {
    const input = cardsFixture();
    const out = packingLayout.run(input, options({ nodeGap: 8, padding: 8 })).boxes as Record<string, Placed>;
    const corners = input.nodes.map((n) => `${n.id} ${(out[n.id] as Placed).x},${(out[n.id] as Placed).y}`);
    expect(corners).toEqual(GOLDEN_PACKING_50);
    const boxes = Object.values(out);
    for (const b of boxes) expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= frame.w && b.y + b.h <= frame.h).toBe(true);
    expect(boxes.reduce((s, b) => s + b.w * b.h, 0) / (frame.w * frame.h)).toBeGreaterThanOrEqual(0.7);
  });

  it('FR-LAY-003: for random boxes, none overlap, all keep their sizes, and those that fit stay inside the frame width', () => {
    const sets = fc.array(fc.tuple(fc.integer({ min: 1, max: 600 }), fc.integer({ min: 1, max: 300 })), { minLength: 1, maxLength: 60 });
    fc.assert(
      fc.property(sets, fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 120 }), (sizes, nodeGap, padding) => {
        const input: LayoutInput = { frame, nodes: sizes.map(([w, h], i) => node(`n${i}`, w, h, i)) };
        const out = packingLayout.run(input, options({ nodeGap, padding })).boxes as Record<string, Placed>;
        const placed = input.nodes.map((n) => out[n.id] as Placed);
        for (const [i, b] of placed.entries()) {
          expect([b.w, b.h]).toEqual([input.nodes[i]?.box.w, input.nodes[i]?.box.h]);
          if (b.w <= frame.w - 2 * padding) expect(b.x + b.w).toBeLessThanOrEqual(frame.w - padding);
          for (const o of placed.slice(i + 1)) {
            // a node gap apart, not just apart
            const grown = { x: b.x - nodeGap, y: b.y - nodeGap, w: b.w + 2 * nodeGap, h: b.h + 2 * nodeGap };
            expect(overlap(grown, o)).toBe(false);
          }
        }
      }),
    );
  });

  it('FR-LAY-003: the largest box goes first, top-left; a box wider than the frame starts at the left edge', () => {
    const input: LayoutInput = { frame, nodes: [node('small', 50, 50, 0), node('big', 300, 200, 1)] };
    const out = packingLayout.run(input, options({ padding: 0, nodeGap: 10 })).boxes;
    expect(out['big']).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    expect(out['small']).toEqual({ x: 310, y: 0, w: 50, h: 50 });
    const wide = packingLayout.run({ frame, nodes: [node('w', 3000, 10, 0), node('s', 10, 10, 1)] }, options({ padding: 0, nodeGap: 0 })).boxes;
    expect(wide['w']).toEqual({ x: 0, y: 0, w: 3000, h: 10 });
    expect(wide['s']).toEqual({ x: 0, y: 10, w: 10, h: 10 });
  });

  it('FR-LAY-008: the same boxes in another order give the same result; pinned nodes keep theirs; odd ids work', () => {
    const input: LayoutInput = {
      frame,
      nodes: [node('constructor', 80, 40, 0), { ...node('__proto__', 60, 30, 1), pinned: true, box: { x: 5, y: 6, w: 60, h: 30 } }, node('c', 80, 40, 2)],
    };
    const o = options({});
    const first = packingLayout.run(input, o);
    expect(packingLayout.run({ ...input, nodes: [...input.nodes].reverse() }, o)).toEqual(first);
    expect(Object.keys(first.boxes).sort()).toEqual(['__proto__', 'c', 'constructor']);
    expect(first.boxes['__proto__']).toEqual({ x: 5, y: 6, w: 60, h: 30 });
    // equal areas keep model order
    expect((first.boxes['constructor'] as Placed).x).toBeLessThan((first.boxes['c'] as Placed).x);
    expect(packingLayout.run({ frame, nodes: [] }, o)).toEqual({ boxes: {} });
  });

  it('FR-LAY-001: options are checked against the schema', () => {
    expect(packingLayout.parseOptions({ spacing: 'roomy' })).toMatchObject({ ok: false });
    expect(packingLayout.parseOptions({ nodeGap: -1 })).toMatchObject({ ok: false });
    expect(options(undefined)).toEqual({ spacing: 'comfortable', padding: 80 });
  });
});

// regenerate only for a deliberate change to the algorithm, with the reason in the commit and a `version` bump
const GOLDEN_PACKING_50: readonly string[] = [
  'c0 1296,472',
  'c1 256,344',
  'c2 1296,600',
  'c3 1644,600',
  'c4 1400,8',
  'c5 1704,856',
  'c6 812,176',
  'c7 1160,304',
  'c8 256,856',
  'c9 604,728',
  'c10 8,8',
  'c11 8,866',
  'c12 1564,472',
  'c13 464,344',
  'c14 8,640',
  'c15 356,728',
  'c16 8,176',
  'c17 1308,954',
  'c18 1160,176',
  'c19 1408,304',
  'c20 524,856',
  'c21 812,738',
  'c22 356,8',
  'c23 1060,924',
  'c24 8,512',
  'c25 672,432',
  'c26 812,640',
  'c27 1508,728',
  'c28 276,176',
  'c29 1516,954',
  'c30 1508,176',
  'c31 1656,304',
  'c32 1436,856',
  'c33 1020,796',
  'c34 704,8',
  'c35 256,954',
  'c36 276,512',
  'c37 880,432',
  'c38 1160,698',
  'c39 8,738',
  'c40 544,176',
  'c41 8,964',
  'c42 812,304',
  'c43 8,344',
  'c44 792,924',
  'c45 1228,796',
  'c46 1052,8',
  'c47 504,954',
  'c48 544,600',
  'c49 1088,472',
];
