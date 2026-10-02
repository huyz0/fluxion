import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SNAP_PX, snapAngle, snapBox, snapThreshold } from './snap.js';

const box = (x: number, y: number, w = 100, h = 50) => ({ x, y, w, h });

describe('snapping (FR-ARR-005)', () => {
  it('FR-ARR-005: a snapped delta never exceeds the threshold of 8 px over the zoom', () => {
    const arbBox = fc.record({
      x: fc.integer({ min: -500, max: 1500 }),
      y: fc.integer({ min: -500, max: 1500 }),
      w: fc.integer({ min: 1, max: 400 }),
      h: fc.integer({ min: 1, max: 400 }),
    });
    fc.assert(
      fc.property(
        arbBox,
        fc.array(arbBox, { maxLength: 12 }),
        fc.constantFrom(0.1, 0.25, 0.5, 1, 2, 4, 8),
        fc.option(fc.constantFrom(8, 10, 24), { nil: undefined }),
        (moving, others, zoom, grid) => {
          const r = snapBox(moving, others, { zoom, ...(grid === undefined ? {} : { grid }), screen: { w: 1920, h: 1080 } });
          const limit = SNAP_PX / zoom + 1e-9;
          expect(Math.abs(r.dx)).toBeLessThanOrEqual(limit);
          expect(Math.abs(r.dy)).toBeLessThanOrEqual(limit);
          // guides lie on the snapped box, never on a guess
          for (const g of r.guides) expect(Number.isFinite(g.at)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
    expect(snapThreshold(2)).toBe(4);
    expect(snapThreshold(0.5)).toBe(16);
  });

  it('FR-ARR-005: the lowest-distance candidate wins on each axis', () => {
    // left edges at 100 and 106, the moving box's left edge at 103: the one 3 away wins over the one 3 away? make 106 nearer
    const others = [box(100, 400), box(108, 800)];
    const near = snapBox(box(105, 0), others, { zoom: 1 });
    // 105 is 5 from 100 and 3 from 108: the nearer, 108
    expect(near.dx).toBe(3);
    const nearer = snapBox(box(101, 0), others, { zoom: 1 });
    expect(nearer.dx).toBe(-1);
    // each axis on its own: x snaps to one box, y to another
    const apart = [box(500, 1000), box(2000, 303, 40, 50)];
    const both = snapBox(box(497, 300), apart, { zoom: 1 });
    expect(both.dx).toBe(3);
    expect(both.dy).toBe(3);
    // nothing within the threshold: no shift and no guide
    const far = snapBox(box(300, 300), [box(500, 500)], { zoom: 1 });
    expect([far.dx, far.dy, far.guides.length]).toEqual([0, 0, 0]);
  });

  it('FR-ARR-005: edges, centres and the screen`s centre and edges are targets; a centre can meet an edge', () => {
    // the moving box's centre (x 150) near another box's left edge (x 148)
    expect(snapBox(box(100, 0, 100), [box(148, 400, 20)], { zoom: 1 }).dx).toBe(-2);
    // its right edge (103) near the other's centre (100)
    expect(snapBox(box(3, 0, 100), [box(40, 400, 120)], { zoom: 1 }).dx).toBe(-3);
    // the screen: its left edge, then its centre
    expect(snapBox(box(5, 500), [], { zoom: 1, screen: { w: 1000, h: 600 } }).dx).toBe(-5);
    expect(snapBox(box(448, 275, 100, 50), [], { zoom: 1, screen: { w: 1000, h: 600 } })).toMatchObject({ dx: 2, dy: 0 });
  });

  it('FR-ARR-005: a grid snaps the box`s edges to multiples of the cell, after the smart targets', () => {
    expect(snapBox(box(23, 41, 90, 40), [], { zoom: 1, grid: 24 })).toMatchObject({ dx: 1, dy: 7 });
    // the nearer wins, a box edge 1 away against a grid line 2 away; on a tie the box's edge does (smart guides before the grid)
    expect(snapBox(box(26, 100), [box(27, 500)], { zoom: 1, grid: 24 }).dx).toBe(1);
    expect(snapBox(box(26, 100), [], { zoom: 1, grid: 24 }).dx).toBe(-2);
    expect(snapBox(box(26, 100), [box(28, 500)], { zoom: 1, grid: 24 }).dx).toBe(2);
  });

  it('FR-ARR-005: a box placed between two others snaps to the middle, and to the gap they already keep', () => {
    // A at x 0..100 and B at x 400..500: the moving box (100 wide) with equal gaps of 100 has its left edge at 200
    const mid = snapBox(box(196, 0, 100), [box(0, 0), box(400, 0)], { zoom: 1 });
    expect(mid.dx).toBe(4);
    expect(mid.guides.some((g) => g.kind === 'gap')).toBe(true);
    // C at 0..50 and D at 80..130 keep a gap of 30: a box placed right of D snaps to 160 (a 30 gap)
    // (neighbours count only where the boxes share a row: at another height they are not beside it)
    expect(snapBox(box(246, 0, 100), [box(0, 300), box(400, 300)], { zoom: 1 }).guides.some((g) => g.kind === 'gap')).toBe(false);
    const same = snapBox(box(165, 0, 50), [box(0, 0, 50), box(80, 0, 50)], { zoom: 1 });
    expect(same.dx).toBe(-5);
    expect(same.guides.some((g) => g.kind === 'gap')).toBe(true);
  });

  it('FR-ARR-005: Alt bypasses every target, and the zoom scales the reach', () => {
    expect(snapBox(box(101, 0), [box(100, 400)], { zoom: 1, bypass: true })).toEqual({ dx: 0, dy: 0, guides: [] });
    // at 4x a target 3 px away on screen is 0.75 page px: snapped; at 0.25x the reach is 32 page px
    expect(snapBox(box(101, 0), [box(100, 400)], { zoom: 4 }).dx).toBe(-1);
    // (its left edge, 130, is 20 from the other's centre, 150: nearer than the 30 to its left edge)
    expect(snapBox(box(130, 0), [box(100, 400)], { zoom: 0.25 }).dx).toBe(20);
    expect(snapBox(box(130, 0), [box(100, 400)], { zoom: 1 }).dx).toBe(0);
  });

  it('FR-ARR-005: rotation snaps to the increment within a few degrees, and not beyond', () => {
    expect(snapAngle(88)).toBe(90);
    expect(snapAngle(92.9)).toBe(90);
    expect(snapAngle(97)).toBe(97);
    expect(snapAngle(359)).toBe(0);
    expect(snapAngle(-2)).toBe(0);
    expect(snapAngle(44, { step: 45 })).toBe(45);
    expect(snapAngle(88, { bypass: true })).toBe(88);
  });
});
