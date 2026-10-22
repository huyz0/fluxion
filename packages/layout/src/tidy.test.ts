// FR-LAY-011: `tidy`, the minimal-movement cleanup (ADR-0045): the messy fixture comes out aligned, on the grid, without overlap, and no node
// moves beyond its bound.
import type { Box } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { overlapCount } from './overlap.js';
import { layoutSync } from './pipeline.js';
import { type TidyOptions, tidyLayout } from './tidy.js';
import type { LayoutInput, LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, order: number, [x, y, w = 120, h = 60]: readonly number[], pinned = false): LayoutNode => ({
  id,
  order,
  box: { x: x ?? 0, y: y ?? 0, w, h },
  ...(pinned ? { pinned: true } : {}),
});
const options = (raw?: unknown): TidyOptions => {
  const r = tidyLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

/**
 * Twelve 120x60 cards meant as three rows of four (columns 160 px apart, rows 100 px apart) placed by hand: each off by up to 5 px, one dragged
 * 50 px into its right neighbour, one dropped 50 px onto the card below it.
 */
function messyFixture(): LayoutInput {
  const jitter = [
    [3, -2],
    [-4, 5],
    [1, 1],
    [5, -3],
    [-2, 4],
    [50, 2],
    [-5, -1],
    [2, 50],
    [4, -4],
    [-1, 2],
    [-3, -5],
    [0, -2],
  ] as const;
  const nodes = jitter.map(([dx, dy], i) => node(`c${i}`, i, [100 + (i % 4) * 160 + dx, 100 + Math.floor(i / 4) * 100 + dy]));
  return { frame, nodes };
}

const GOLDEN_TIDY_MESSY = [
  'c0 104,96',
  'c1 256,96',
  'c2 416,96',
  'c3 584,96',
  'c4 104,200',
  'c5 295,200',
  'c6 416,200',
  'c7 584,235',
  'c8 104,296',
  'c9 256,296',
  'c10 416,296',
  'c11 584,296',
];

const moveOf = (from: Box, to: Box): number => Math.hypot(to.x - from.x, to.y - from.y);

describe('tidy (FR-LAY-011, ADR-0045)', () => {
  it('FR-LAY-011: WHEN the messy fixture is tidied THE SYSTEM SHALL leave no overlap and move no node beyond its bound (golden)', () => {
    const input = messyFixture();
    const r = layoutSync({ input, algorithm: tidyLayout as never });
    if (!r.ok) throw new Error(r.error.message);
    const out = r.value.boxes;
    expect(input.nodes.map((n) => `${n.id} ${(out[n.id] as Box).x},${(out[n.id] as Box).y}`)).toEqual(GOLDEN_TIDY_MESSY);
    expect(r.value.metrics.overlaps).toBe(0);
    // the rows and columns are on the grid, the dragged and the dropped card pulled back only off the line they are on
    expect(new Set(['c0', 'c4', 'c8'].map((id) => (out[id] as Box).x))).toEqual(new Set([104]));
    expect(new Set(['c0', 'c1', 'c2', 'c3'].map((id) => (out[id] as Box).y))).toEqual(new Set([96]));
    for (const n of input.nodes) expect(moveOf(n.box, out[n.id] as Box)).toBeLessThanOrEqual(Math.max(n.box.w, n.box.h) / 2 + 10 + 8);
  });

  it('FR-LAY-011: a pinned box stays, and near-aligned boxes align on it', () => {
    const input: LayoutInput = { frame, nodes: [node('a', 0, [103, 97], true), node('b', 1, [300, 101]), node('c', 2, [500, 95])] };
    const out = tidyLayout.run(input, options()).boxes;
    expect(out['a']).toEqual(input.nodes[0]?.box);
    expect([out['b']?.y, out['c']?.y]).toEqual([97, 97]);
  });

  it('FR-LAY-011: through the pipeline, sizes never change, no overlap is left, even from piles', () => {
    // clusters of up to five boxes a few px apart (piles and near-alignments) scattered over the frame
    const cluster = fc.tuple(
      fc.integer({ min: 0, max: 900 }),
      fc.integer({ min: 0, max: 600 }),
      fc.array(fc.tuple(fc.integer({ min: -12, max: 12 }), fc.integer({ min: -12, max: 12 }), fc.integer({ min: 10, max: 200 })), {
        minLength: 1,
        maxLength: 5,
      }),
    );
    fc.assert(
      fc.property(fc.array(cluster, { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 40 }), (clusters, maxMove) => {
        const placed = clusters.flatMap(([x, y, members]) => members.map(([dx, dy, w]) => [x + dx, y + dy, w, 40]));
        const input: LayoutInput = { frame, nodes: placed.map((box, i) => node(`n${i}`, i, box)) };
        const r = layoutSync({ input, algorithm: tidyLayout as never, options: { maxMove } });
        if (!r.ok) throw new Error(r.error.message);
        expect(r.value.metrics.overlaps).toBe(0);
        for (const n of input.nodes) expect([r.value.boxes[n.id]?.w, r.value.boxes[n.id]?.h]).toEqual([n.box.w, n.box.h]);
      }),
    );
  });

  it('FR-LAY-011: when no two boxes start on or against each other, no node moves beyond maxMove', () => {
    // cards hand-placed on a 160 x 100 grid, each up to 12 px off, never touching: what a messy but unpiled diagram looks like
    const card = fc.tuple(
      fc.integer({ min: 0, max: 9 }),
      fc.integer({ min: 0, max: 7 }),
      fc.integer({ min: -12, max: 12 }),
      fc.integer({ min: -12, max: 12 }),
      fc.integer({ min: 10, max: 120 }),
    );
    fc.assert(
      fc.property(
        fc.uniqueArray(card, { minLength: 1, maxLength: 30, selector: ([col, row]) => `${col},${row}` }),
        fc.integer({ min: 0, max: 40 }),
        (cards, maxMove) => {
          const input: LayoutInput = {
            frame,
            nodes: cards.map(([col, row, dx, dy, w], i) => node(`n${i}`, i, [20 + col * 160 + dx, 20 + row * 100 + dy, w, 40])),
          };
          const r = layoutSync({ input, algorithm: tidyLayout as never, options: { maxMove } });
          if (!r.ok) throw new Error(r.error.message);
          expect(r.value.metrics.overlaps).toBe(0);
          for (const n of input.nodes) expect(moveOf(n.box, r.value.boxes[n.id] as Box)).toBeLessThanOrEqual(maxMove + 1e-9);
        },
      ),
    );
  });

  it('FR-LAY-011: a pile of near-aligned boxes is spread out in one column, not left overlapping', () => {
    const input: LayoutInput = { frame, nodes: Array.from({ length: 9 }, (_, i) => node(`p${i}`, i, [500 + i, 300 + i])) };
    const r = layoutSync({ input, algorithm: tidyLayout as never });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.metrics.overlaps).toBe(0);
    expect(new Set(input.nodes.map((n) => (r.value.boxes[n.id] as Box).x)).size).toBe(1);
  });

  it('FR-LAY-011: boxes already tidy do not move', () => {
    const input: LayoutInput = { frame, nodes: [node('a', 0, [96, 96]), node('b', 1, [256, 96]), node('c', 2, [96, 200])] };
    const out = tidyLayout.run(input, options()).boxes;
    for (const n of input.nodes) expect(out[n.id]).toEqual(n.box);
    expect(overlapCount(out)).toBe(0);
  });

  it('FR-LAY-011: options are checked', () => {
    expect(options()).toEqual({ grid: 8, tolerance: 10 });
    for (const bad of [{ grid: -1 }, { tolerance: 'x' }, { other: 1 }]) expect(tidyLayout.parseOptions(bad).ok).toBe(false);
  });
});
