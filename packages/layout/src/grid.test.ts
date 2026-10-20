// FR-LAY-002: the built-in `grid` layout, and FR-LAY-001's options contract for it.
import { createRegistry } from '@fluxion/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type GridOptions, gridLayout, registerBuiltInLayouts } from './index.js';
import type { LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const SIZES: ReadonlyArray<readonly [number, number]> = [
  [100, 50],
  [120, 60],
  [80, 40],
  [90, 30],
  [110, 55],
  [70, 20],
  [120, 60],
  [60, 60],
  [100, 10],
];
const node = (id: string, [w, h]: readonly [number, number], order: number, at?: { x: number; y: number }): LayoutNode => ({
  id,
  box: { x: at?.x ?? 0, y: at?.y ?? 0, w, h },
  order,
  ...(at ? { pinned: true } : {}),
});
const options = (raw: unknown): GridOptions => {
  const r = gridLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const nine = SIZES.map((s, i) => node(`n${i + 1}`, s, i));
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

type Placed = { x: number; y: number; w: number; h: number };

/** Pinned boxes are unchanged, and no box overlaps another unless both are pinned (the document's own placement). */
function expectNoOverlap(nodes: readonly LayoutNode[], boxes: { readonly [id: string]: Placed }): void {
  const placed = nodes.map((n) => ({ n, b: boxes[n.id] as Placed }));
  for (const { n, b } of placed) {
    if (n.pinned) expect(b).toEqual(n.box);
    for (const other of placed.filter((o) => o.n !== n && !(n.pinned && o.n.pinned))) expect(overlaps(b, other.b)).toBe(false);
  }
}

describe('grid layout (FR-LAY-002)', () => {
  it('FR-LAY-002: fixture grid-3x3 gives row-major boxes in equal cells with the configured gap', () => {
    const out = gridLayout.run({ frame, nodes: nine }, options({ gap: 10, padding: 0 }));
    const at = (id: string) => out.boxes[id];
    // cells are 120 x 60 (the widest and tallest box), 130 x 70 apart
    expect([at('n1'), at('n2'), at('n3')]).toEqual([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 130, y: 0, w: 120, h: 60 },
      { x: 260, y: 0, w: 80, h: 40 },
    ]);
    expect([at('n4')?.y, at('n5')?.x, at('n6')?.x, at('n7')?.y, at('n8')?.x, at('n9')?.y]).toEqual([70, 130, 260, 140, 130, 140]);
  });

  it('FR-LAY-002: align centres or ends a box in its cell, on the half-pixel grid', () => {
    const centred = gridLayout.run({ frame, nodes: nine }, options({ gap: 10, padding: 0, align: 'center' }));
    expect(centred.boxes['n1']).toEqual({ x: 10, y: 5, w: 100, h: 50 });
    expect(centred.boxes['n3']).toEqual({ x: 280, y: 10, w: 80, h: 40 });
    const ended = gridLayout.run({ frame, nodes: nine }, options({ gap: 10, padding: 0, align: 'end' }));
    expect(ended.boxes['n1']).toEqual({ x: 20, y: 10, w: 100, h: 50 });
    const odd = gridLayout.run(
      { frame, nodes: [node('a', [11, 10], 0), node('b', [10, 10], 1)] },
      options({ gap: 0, padding: 0, align: 'center', columns: 2 }),
    );
    expect(odd.boxes['b']).toEqual({ x: 11.5, y: 0, w: 10, h: 10 });
  });

  it('FR-LAY-002: columns, padding and the frame origin set where the grid starts and how wide a row is', () => {
    const out = gridLayout.run({ frame: { x: 100, y: 200, w: 800, h: 600 }, nodes: nine.slice(0, 4) }, options({ columns: 2, gap: 0, padding: 20 }));
    expect([out.boxes['n1'], out.boxes['n2'], out.boxes['n3']]).toEqual([
      { x: 120, y: 220, w: 100, h: 50 },
      { x: 240, y: 220, w: 120, h: 60 },
      { x: 120, y: 280, w: 80, h: 40 },
    ]);
    expect(gridLayout.run({ frame, nodes: [] }, options({})).boxes).toEqual({});
  });

  it('FR-LAY-002: pinned boxes are not moved and the grid skips the cells they cover', () => {
    const pin = node('p', [120, 60], 0, { x: 130, y: 0 });
    const out = gridLayout.run(
      { frame, nodes: [nine[0] as LayoutNode, pin, nine[1] as LayoutNode, nine[2] as LayoutNode, nine[3] as LayoutNode] },
      options({ gap: 10, padding: 0 }),
    );
    expect(out.boxes['p']).toEqual(pin.box);
    expect(out.boxes['n1']).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(out.boxes['n2']).toEqual({ x: 260, y: 0, w: 120, h: 60 });
    expect(out.boxes['n3']).toEqual({ x: 0, y: 70, w: 80, h: 40 });
  });

  it('FR-LAY-002: the same input gives the same boxes, and no unpinned box overlaps another, for any sizes, gaps, columns, frame and pins', () => {
    // tenths of a pixel, zero sizes and big pins included: the half-pixel rounding of cells is what keeps boxes apart
    const tenths = (max: number) => fc.integer({ min: 0, max: max * 10 }).map((n) => n / 10);
    const size = fc.tuple(tenths(300), tenths(200));
    const pinned = fc.option(fc.record({ x: tenths(800), y: tenths(600) }), { nil: undefined });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(size, pinned), { minLength: 1, maxLength: 14 }),
        fc.record({ columns: fc.integer({ min: 1, max: 6 }), align: fc.constantFrom('start', 'center', 'end'), gap: tenths(30), padding: tenths(40) }),
        fc.record({ x: tenths(50), y: tenths(50) }),
        (items, raw, origin) => {
          const nodes = items.map(([s, at], i) => node(`n${i}`, s, i, at));
          const input = { frame: { ...origin, w: 1920, h: 1080 }, nodes };
          const first = gridLayout.run(input, options(raw));
          expect(gridLayout.run(input, options(raw))).toEqual(first);
          expectNoOverlap(nodes, first.boxes);
        },
      ),
      { numRuns: 300, seed: 20261015 },
    );
  });

  it('FR-LAY-002: zero-size boxes inside a huge pin, and a pin covering most of the screen, still finish and clear the pin', () => {
    const wall = node('wall', [1920, 1080], 0, { x: 0, y: 0 });
    const zero = [node('z1', [0, 0], 1), node('z2', [0, 0], 2)];
    const out = gridLayout.run({ frame, nodes: [wall, ...zero] }, options({ gap: 0, padding: 80 }));
    for (const id of ['z1', 'z2']) expect(out.boxes[id]?.y).toBeGreaterThanOrEqual(1080);
    const many = Array.from({ length: 30 }, (_, i) => node(`m${i}`, [10, 10], i + 1));
    const wide = node('wide', [100_000, 100_000], 0, { x: 0, y: 0 });
    const far = gridLayout.run({ frame, nodes: [wide, ...many] }, options({ gap: 0, padding: 0 }));
    expect(Object.values(far.boxes).filter((b) => overlaps(b, wide.box))).toEqual([wide.box]);
  });

  it('FR-LAY-001: the grid options are checked with a message naming the bad one, and the schema agrees', () => {
    expect(gridLayout.parseOptions(undefined)).toEqual({ ok: true, value: { columns: 3, gap: 24, align: 'start', padding: 80 } });
    for (const [raw, message] of [
      [{ columns: 0 }, 'columns must be a whole number from 1 to 64'],
      [{ columns: 2.5 }, 'columns must be a whole number from 1 to 64'],
      [{ columns: 65 }, 'columns must be a whole number from 1 to 64'],
      [{ gap: -1 }, 'gap must be a number of px, 0 or more'],
      [{ align: 'middle' }, 'align must be "start", "center" or "end"'],
      [{ rows: 2 }, 'unknown grid option "rows" (columns, gap, align, padding)'],
      [[], 'grid options must be an object'],
    ] as const) {
      expect(gridLayout.parseOptions(raw)).toEqual({ ok: false, message });
      expect(gridLayout.schema.safeParse(raw).success).toBe(false);
    }
    expect(gridLayout.parseOptions({ columns: undefined, gap: 5 })).toEqual({ ok: true, value: { columns: 3, gap: 5, align: 'start', padding: 80 } });
    expect(gridLayout.schema.parse({ columns: 4 })).toEqual({ columns: 4, gap: 24, align: 'start', padding: 80 });
  });

  it('FR-LAY-001: the built-in layouts register under their names', () => {
    const layouts = createRegistry<string, unknown>('layouts');
    expect(registerBuiltInLayouts(layouts).ok).toBe(true);
    expect(layouts.list().map(([id]) => id)).toEqual(['grid', 'layered', 'orgchart', 'stack', 'tree']);
    // a foreign layout already holds a name: that refusal comes back, and the other built-in is still registered
    const taken = createRegistry<string, unknown>('layouts');
    taken.register('stack', {}, 'someone');
    expect(registerBuiltInLayouts(taken).ok).toBe(false);
    expect(taken.list().map(([id]) => id)).toEqual(['grid', 'layered', 'orgchart', 'stack', 'tree']);
  });
});
