// FR-LAY-006: incremental mode (ADR-0046). Adding one node to the incremental fixture (a 40-node tree, a 30-node force graph, a 20-node
// packing) moves at most LAYOUT_INCREMENTAL_MOVED_PCT % of the nodes that were there before.
import type { Box } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { forceLayout } from './force.js';
import { movedPercent, reconcile } from './incremental.js';
import { packingLayout } from './packing.js';
import { layoutSync } from './pipeline.js';
import { treeLayout } from './tree.js';
import type { LayoutAlgorithm, LayoutEdge, LayoutInput, LayoutNode } from './types.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const thresholds = Object.values(import.meta.glob('../../../scripts/gates/thresholds.mjs', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const LIMIT = Number(/LAYOUT_INCREMENTAL_MOVED_PCT: \{ value: ([0-9_]+)/.exec(thresholds)?.[1]);

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, order: number, [w, h]: readonly [number, number] = [120, 50]): LayoutNode => ({ id, box: { x: 0, y: 0, w, h }, order });
const edge = (source: string, target: string, order: number): LayoutEdge => ({ id: `${source}-${target}`, source, target, order });

type Fixture = {
  readonly name: string;
  readonly algorithm: LayoutAlgorithm<never>;
  readonly before: LayoutInput;
  readonly added: LayoutNode;
  readonly links: readonly LayoutEdge[];
};

/** A 40-node tree: each node i > 0 hangs under (i - 1) / 3, so three children a node; the new node is a fourth child of t5, which widens its subtree. */
function treeFixture(): Fixture {
  const nodes = Array.from({ length: 40 }, (_, i) => node(`t${i}`, i));
  const edges = nodes.slice(1).map((n, i) => edge(`t${Math.floor(i / 3)}`, n.id, i));
  return { name: 'tree-40', algorithm: treeLayout as never, before: { frame, nodes, edges }, added: node('t40', 40), links: [edge('t5', 't40', 40)] };
}

/** A 30-node force graph: a ring with a chord every fifth node. */
function forceFixture(): Fixture {
  const nodes = Array.from({ length: 30 }, (_, i) => node(`f${i}`, i, [80, 40]));
  const ring = nodes.map((n, i) => edge(n.id, `f${(i + 1) % 30}`, i));
  const chords = nodes.filter((_, i) => i % 5 === 0).map((n, i) => edge(n.id, `f${(Number(n.id.slice(1)) + 12) % 30}`, 30 + i));
  return {
    name: 'force-30',
    algorithm: forceLayout as never,
    before: { frame, nodes, edges: [...ring, ...chords] },
    added: node('f30', 30, [80, 40]),
    links: [edge('f7', 'f30', 40)],
  };
}

/** A 20-node packing of mixed sizes; the new box is the smallest, so it goes last. */
function packingFixture(): Fixture {
  const nodes = Array.from({ length: 20 }, (_, i) => node(`p${i}`, i, [100 + (i % 4) * 40, 60 + (i % 3) * 30]));
  return { name: 'packing-20', algorithm: packingLayout as never, before: { frame, nodes }, added: node('p20', 20, [60, 40]), links: [] };
}

/** The ids of the boxes that are not inside the frame. */
const outside = (boxes: Readonly<Record<string, Box>>): string[] =>
  Object.keys(boxes).filter((id) => {
    const b = boxes[id] as Box;
    return b.x < frame.x || b.y < frame.y || b.x + b.w > frame.x + frame.w || b.y + b.h > frame.y + frame.h;
  });

/** The fixture laid out, then laid out again with one node added and `previous` set: the second run's `moved` metric. */
function movedAfterAdding(f: Fixture): number {
  const first = layoutSync({ input: f.before, algorithm: f.algorithm });
  if (!first.ok) throw new Error(first.error.message);
  const after: LayoutInput = {
    ...f.before,
    nodes: [...f.before.nodes, f.added],
    edges: [...(f.before.edges ?? []), ...f.links],
    previous: first.value.boxes,
    changed: [f.added.id],
  };
  const second = layoutSync({ input: after, algorithm: f.algorithm });
  if (!second.ok) throw new Error(second.error.message);
  expect(second.value.metrics.moved).toBe(movedPercent(first.value.boxes, second.value.boxes));
  expect(second.value.metrics.overlaps).toBe(0);
  // The tree and force fixtures overflow the frame even in a full run; when a full run fits, the incremental one must fit too.
  const full = layoutSync({ input: { frame, nodes: after.nodes, edges: after.edges ?? [] }, algorithm: f.algorithm });
  if (full.ok && outside(full.value.boxes).length === 0) expect(outside(second.value.boxes)).toEqual([]);
  return second.value.metrics.moved as number;
}

describe('incremental mode (FR-LAY-006, ADR-0046)', () => {
  it('FR-LAY-006: the limit is read from the thresholds', () => {
    expect(LIMIT).toBeGreaterThan(0);
  });

  for (const make of [treeFixture, forceFixture, packingFixture]) {
    const f = make();
    it(`FR-LAY-006: adding one node to ${f.name} moves at most LAYOUT_INCREMENTAL_MOVED_PCT % of the others`, () => {
      expect(movedAfterAdding(f)).toBeLessThanOrEqual(LIMIT);
    });
  }

  it('FR-LAY-006: a full run without previous has no moved metric', () => {
    const r = layoutSync({ input: treeFixture().before, algorithm: treeLayout as never });
    expect(r.ok && r.value.metrics.moved).toBe(undefined);
  });

  it('FR-LAY-006: reconcile moves each component back by the median offset of its unchanged nodes', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id, i) => node(id, i, [10, 10]));
    const previous: Record<string, Box> = { a: { x: 100, y: 100, w: 10, h: 10 }, b: { x: 130, y: 100, w: 10, h: 10 }, c: { x: 500, y: 0, w: 10, h: 10 } };
    const boxes = { a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 30, y: 0, w: 10, h: 10 }, c: { x: 0, y: 300, w: 10, h: 10 }, d: { x: 50, y: 0, w: 10, h: 10 } };
    const input: LayoutInput = { frame, nodes, edges: [edge('a', 'b', 0), edge('b', 'd', 1)], previous, changed: ['d'] };
    expect(reconcile(input, boxes)).toEqual({
      a: { x: 100, y: 100, w: 10, h: 10 },
      b: { x: 130, y: 100, w: 10, h: 10 },
      c: { x: 500, y: 0, w: 10, h: 10 },
      d: { x: 150, y: 100, w: 10, h: 10 },
    });
  });

  it('FR-LAY-006: an edgeless layout is reconciled as one block, keeping the arrangement of a full run', () => {
    const f = packingFixture();
    const nodes = [...f.before.nodes, node('p20', 20, [300, 200])];
    const first = layoutSync({ input: f.before, algorithm: packingLayout as never });
    const full = layoutSync({ input: { frame, nodes }, algorithm: packingLayout as never });
    const inc = layoutSync({ input: { frame, nodes, previous: first.ok ? first.value.boxes : {}, changed: ['p20'] }, algorithm: packingLayout as never });
    if (!(full.ok && inc.ok)) throw new Error('layout failed');
    const shift = (id: string): readonly [number, number] => {
      const [a, b] = [full.value.boxes[id] as Box, inc.value.boxes[id] as Box];
      return [b.x - a.x, b.y - a.y];
    };
    for (const n of nodes) expect(shift(n.id)).toEqual(shift('p0'));
    expect(outside(full.value.boxes)).toEqual([]);
    expect(outside(inc.value.boxes)).toEqual([]);
  });

  it('FR-LAY-006: the pipeline refuses a previous box that is not finite and a changed list that is not ids', () => {
    const nodes = [node('a', 0)];
    for (const bad of [{ previous: { a: { x: Number.NaN, y: 0, w: 1, h: 1 } } }, { changed: [1] }]) {
      const r = layoutSync({ input: { frame, nodes, ...bad } as LayoutInput, algorithm: treeLayout as never });
      expect(r.ok ? undefined : r.error.code).toBe('LAYOUT_INPUT_INVALID');
    }
  });

  it('FR-LAY-008: an incremental force run is deterministic', () => {
    const f = forceFixture();
    expect(movedAfterAdding(f)).toBe(movedAfterAdding(f));
  });
});
