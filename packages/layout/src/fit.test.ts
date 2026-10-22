// FR-LAY-012: `fit` and "Fit to screen": the content ends inside the screen's safe area, scaled down together and never up.
import type { Box } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitLayout } from './fit.js';
import { fitBoxes, safeAreaOf } from './passes.js';
import { layoutSync } from './pipeline.js';
import type { LayoutInput, LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, order: number, [x = 0, y = 0, w = 100, h = 50]: readonly number[], pinned = false): LayoutNode => ({
  id,
  order,
  box: { x, y, w, h },
  ...(pinned ? { pinned: true } : {}),
});
const inside = (b: Box, area: Box): boolean => b.x >= area.x && b.y >= area.y && b.x + b.w <= area.x + area.w && b.y + b.h <= area.y + area.h;

describe('fit (FR-LAY-012)', () => {
  it("FR-LAY-012: WHEN content is fitted THE SYSTEM SHALL put every box inside the screen's safe area (property)", () => {
    const box = fc.tuple(
      fc.integer({ min: -3000, max: 4000 }),
      fc.integer({ min: -2000, max: 3000 }),
      fc.integer({ min: 1, max: 900 }),
      fc.integer({ min: 1, max: 600 }),
    );
    const size = fc.tuple(fc.integer({ min: 200, max: 2400 }), fc.integer({ min: 200, max: 1600 }));
    fc.assert(
      fc.property(
        fc.array(box, { minLength: 1, maxLength: 25 }),
        size,
        fc.option(fc.double({ min: 0, max: 0.25, noNaN: true }), { nil: undefined }),
        (boxes, [w, h], share) => {
          // a margin of at most a quarter of the smaller side: a safe area of at least half the screen
          const margin = share === undefined ? undefined : Math.round(share * Math.min(w, h));
          const input: LayoutInput = { frame: { x: 0, y: 0, w, h }, nodes: boxes.map((b, i) => node(`n${i}`, i, b)) };
          const r = layoutSync({ input, algorithm: fitLayout as never, options: margin === undefined ? {} : { margin } });
          if (!r.ok) throw new Error(r.error.message);
          const safe = safeAreaOf(input.frame, { margin });
          for (const n of input.nodes)
            expect(inside(r.value.boxes[n.id] as Box, safe), `${n.id} ${JSON.stringify(r.value.boxes[n.id])} in ${JSON.stringify(safe)}`).toBe(true);
          expect(r.value.metrics.overlaps).toBe(0);
        },
      ),
    );
  });

  it('FR-LAY-012: a dense row needing a strong scale stays inside: the overlap pass after the fit finds no gap under 1 px to widen', () => {
    for (const gap of [0, 1, -20]) {
      const input: LayoutInput = { frame, nodes: Array.from({ length: 40 }, (_, i) => node(`n${i}`, i, [i * (100 + gap), 500, 100, 50])) };
      const r = layoutSync({ input, algorithm: fitLayout as never });
      if (!r.ok) throw new Error(r.error.message);
      for (const n of input.nodes)
        expect(inside(r.value.boxes[n.id] as Box, safeAreaOf(frame)), `${gap}: ${n.id} ${JSON.stringify(r.value.boxes[n.id])}`).toBe(true);
      expect(r.value.metrics.overlaps).toBe(0);
    }
  });

  it('FR-LAY-012: a safe area with no room leaves the content as it is rather than scaling it to nothing', () => {
    const input: LayoutInput = { frame: { x: 0, y: 0, w: 4, h: 4 }, nodes: [node('a', 0, [10, 10])] };
    expect(fitBoxes(input, { a: input.nodes[0]?.box as Box }, { margin: 2 })).toEqual({ a: input.nodes[0]?.box });
  });

  it('FR-LAY-012: content already inside the safe area does not move, and content is never scaled up', () => {
    const input: LayoutInput = { frame, nodes: [node('a', 0, [200, 200]), node('b', 1, [400, 300])] };
    const r = layoutSync({ input, algorithm: fitLayout as never });
    if (!r.ok) throw new Error(r.error.message);
    for (const n of input.nodes) expect(r.value.boxes[n.id]).toEqual(n.box);
  });

  it('FR-LAY-012: content too wide is scaled down together, keeping its proportions and order, and centred where it cannot move', () => {
    const input: LayoutInput = { frame, nodes: [node('a', 0, [0, 500, 1000, 100]), node('b', 1, [1200, 500, 1000, 100])] };
    const out = fitBoxes(input, Object.fromEntries(input.nodes.map((n) => [n.id, n.box])));
    const [a, b] = [out['a'] as Box, out['b'] as Box];
    const scale = a.w / 1000;
    expect(scale).toBeLessThan(1);
    expect(b.w).toBeCloseTo(a.w);
    expect(a.h).toBeCloseTo(100 * scale);
    expect(b.x - a.x).toBeCloseTo(1200 * scale);
    // the margin is 5% of the frame's smaller side: 54 px of 1080
    expect(safeAreaOf(frame)).toEqual({ x: 54, y: 54, w: 1812, h: 972 });
    expect(a.x).toBeCloseTo(56);
  });

  it('FR-LAY-012: a pinned box stays where it is and is not counted in the content fitted', () => {
    const input: LayoutInput = { frame, nodes: [node('p', 0, [-500, -500], true), node('a', 1, [1900, 100])] };
    const r = layoutSync({ input, algorithm: fitLayout as never });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.boxes['p']).toEqual(input.nodes[0]?.box);
    expect(r.value.boxes['a']).toMatchObject({ x: 1764, y: 100, w: 100, h: 50 });
  });

  it('FR-LAY-012: the fit post-pass runs only when asked for', () => {
    const input: LayoutInput = { frame, nodes: [node('a', 0, [1900, 100])] };
    const identity = { ...fitLayout, id: 'identity', run: (i: LayoutInput) => ({ boxes: Object.fromEntries(i.nodes.map((n) => [n.id, n.box])) }) };
    const plain = layoutSync({ input, algorithm: identity as never });
    const fitted = layoutSync({ input, algorithm: identity as never, post: ['pins', 'fit', 'snap'], fit: { margin: 0 } });
    if (!plain.ok || !fitted.ok) throw new Error('layout failed');
    expect(plain.value.boxes['a']?.x).toBe(1900);
    expect(fitted.value.boxes['a']?.x).toBe(1818);
  });

  it('FR-LAY-012: options are checked', () => {
    expect(fitLayout.parseOptions(undefined)).toEqual({ ok: true, value: {} });
    for (const bad of [{ margin: -1 }, { margin: 'x' }, { other: 1 }]) expect(fitLayout.parseOptions(bad).ok).toBe(false);
  });
});
