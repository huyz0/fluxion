import { type Path, type PathCommand, pathFromCommands } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { MITER_LIMIT, miterWedges, nearWedge } from './stroke-join.js';

const path = (commands: readonly PathCommand[]): Path => {
  const built = pathFromCommands(commands);
  if (!built.ok) throw new Error('bad path');
  return built.value;
};
const M = (x: number, y: number): PathCommand => ({ kind: 'M', to: { x, y } });
const L = (x: number, y: number): PathCommand => ({ kind: 'L', to: { x, y } });
const Z: PathCommand = { kind: 'Z' };
const round = (w: readonly { x: number; y: number }[]) => w.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);

describe('miter joins (FR-EDT-004)', () => {
  it('FR-EDT-004: a closed outline has a miter spike at each corner, pointing out of the turn', () => {
    expect(MITER_LIMIT).toBe(4);
    // a right triangle, its right angle at the origin
    const wedges = miterWedges(path([M(0, 0), L(100, 0), L(0, 100), Z]), 10);
    expect(wedges.length).toBe(3);
    // at (100, 0) the outline turns 135°: the tip lies 10 / sin(22.5°) out along the bisector
    const sharp = wedges[0];
    const tip = sharp?.[0] ?? { x: 0, y: 0 };
    expect(Math.hypot(tip.x - 100, tip.y)).toBeCloseTo(10 / Math.sin(Math.PI / 8), 9);
    expect(round(sharp ?? [])).toEqual([
      [round([tip])[0]?.[0], round([tip])[0]?.[1]],
      [100, -10],
      [107.071, 7.071],
    ]);
    // the right angle closes the path: its tip at (-10, -10)
    expect(round(wedges[2] ?? [])).toEqual([
      [-10, -10],
      [-10, 0],
      [0, -10],
    ]);
  });

  it('FR-EDT-004: turning the other way puts the spike on the other side', () => {
    const [left] = miterWedges(path([M(0, 0), L(100, 0), L(100, 100)]), 10);
    const [right] = miterWedges(path([M(0, 0), L(100, 0), L(100, -100)]), 10);
    expect(round(left ?? [])).toEqual([
      [110, -10],
      [100, -10],
      [110, 0],
    ]);
    expect(round(right ?? [])).toEqual([
      [110, 10],
      [100, 10],
      [110, 0],
    ]);
  });

  it('FR-EDT-004: no spike where the path runs straight on, doubles back, ends or is too sharp for the miter limit', () => {
    expect(miterWedges(path([M(0, 0), L(50, 0), L(100, 0)]), 10)).toEqual([]);
    expect(miterWedges(path([M(0, 0), L(100, 0), L(0, 0)]), 10)).toEqual([]);
    // a turn of 160°: 1 / sin(10°) ≈ 5.8 widths, past the limit, so SVG bevels it
    const sharp = path([M(0, 0), L(100, 0), L(100 - 100 * Math.cos((20 * Math.PI) / 180), 100 * Math.sin((20 * Math.PI) / 180))]);
    expect(miterWedges(sharp, 10)).toEqual([]);
    // a turn of 150°: 1 / sin(15°) ≈ 3.9 widths, within it
    const within = path([M(0, 0), L(100, 0), L(100 - 100 * Math.cos((30 * Math.PI) / 180), 100 * Math.sin((30 * Math.PI) / 180))]);
    expect(miterWedges(within, 10).length).toBe(1);
    // a single segment has no joint; an empty path has none
    expect(miterWedges(path([M(0, 0), L(100, 0)]), 10)).toEqual([]);
    expect(miterWedges({ segments: [], closed: true }, 10)).toEqual([]);
    // a curve leaving with its control point on its start has no direction there: no joint
    const still: PathCommand = { kind: 'C', control1: { x: 100, y: 0 }, control2: { x: 100, y: 50 }, to: { x: 100, y: 100 } };
    expect(miterWedges(path([M(0, 0), L(100, 0), still]), 10)).toEqual([]);
    const moving: PathCommand = { kind: 'C', control1: { x: 100, y: 20 }, control2: { x: 100, y: 50 }, to: { x: 100, y: 100 } };
    expect(miterWedges(path([M(0, 0), L(100, 0), moving]), 10).length).toBe(1);
  });

  it('FR-EDT-004: a point is near a wedge inside it, or within the tolerance of its edges', () => {
    const w = [
      { x: 20, y: 0 },
      { x: 0, y: -10 },
      { x: 0, y: 10 },
    ] as const;
    expect(nearWedge({ x: 10, y: 0 }, w, 0)).toBe(true);
    expect(nearWedge({ x: 10, y: 4 }, w, 0)).toBe(true);
    expect(nearWedge({ x: 10, y: 6 }, w, 0)).toBe(false);
    expect(nearWedge({ x: 10, y: 6 }, w, 2)).toBe(true);
    expect(nearWedge({ x: 23, y: 0 }, w, 2)).toBe(false);
    expect(nearWedge({ x: 21.5, y: 0 }, w, 2)).toBe(true);
    expect(nearWedge({ x: -1.5, y: 0 }, w, 2)).toBe(true);
    // beyond one edge only (about 4.9 past the tip-to-a edge)
    expect(nearWedge({ x: 15, y: -8 }, w, 0)).toBe(false);
    expect(nearWedge({ x: 15, y: -8 }, w, 5)).toBe(true);
    // wound the other way round, the inside is the same
    expect(nearWedge({ x: 10, y: 0 }, [w[0], w[2], w[1]], 0)).toBe(true);
  });
});
