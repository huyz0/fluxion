// NFR-PERF-005 calibration workload (ADR-0170): a FROZEN piece of work the nightly perf job runs beside each layout bench, in the same Vitest
// process, so a reading can be judged as a multiple of how fast that runner machine is that night. It imports nothing from the project, so no
// change to Fluxion moves it. Never edit it: a change re-scales every calibrated baseline, so it needs an ADR and a re-record of
// perf-baseline.calibrated.json in the same commit.
//
// The work is shaped like a layout's: a seeded 4000-node layered graph, objects and maps allocated each round, barycentre sweeps with sorts.
import { describe, expect, test } from 'vitest';

/** A seeded linear congruential generator (Numerical Recipes constants), so every run does the same work. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Node = { id: string; layer: number; order: number; weight: number };
type Graph = { readonly nodes: Node[]; readonly byLayer: Node[][]; readonly up: Map<string, Node[]>; readonly down: Map<string, Node[]> };

const LAYERS = 20;

/** The seeded graph: 4000 nodes over 20 layers, each linked to two nodes of the layer above. */
function graph(): Graph {
  const random = lcg(20261023);
  const nodes: Node[] = Array.from({ length: 4000 }, (_, i) => ({ id: `n${i}`, layer: i % LAYERS, order: 0, weight: 0 }));
  const byLayer: Node[][] = Array.from({ length: LAYERS }, () => []);
  for (const n of nodes) {
    const layer = byLayer[n.layer] as Node[];
    n.order = layer.length;
    layer.push(n);
  }
  const up = new Map<string, Node[]>();
  for (const n of nodes.filter((m) => m.layer > 0)) {
    const above = byLayer[n.layer - 1] as Node[];
    up.set(
      n.id,
      Array.from({ length: 2 }, () => above[Math.floor(random() * above.length)] as Node),
    );
  }
  const down = new Map<string, Node[]>();
  for (const [id, links] of up) for (const l of links) down.set(l.id, [...(down.get(l.id) ?? []), nodes[Number(id.slice(1))] as Node]);
  return { nodes, byLayer, up, down };
}

/** One barycentre pass over `layer`: weigh each node by its neighbours' order, sort, renumber. */
function sweepLayer(layer: Node[], near: Map<string, Node[]>): void {
  for (const n of layer) {
    const links = near.get(n.id) ?? [];
    n.weight = links.length === 0 ? n.order : links.reduce((sum, m) => sum + m.order, 0) / links.length;
  }
  layer.sort((a, b) => a.weight - b.weight || a.id.localeCompare(b.id));
  layer.forEach((n, i) => {
    n.order = i;
  });
}

/** One round: build the graph, sweep barycentres down and up 24 times, then place the nodes; returns a checksum so nothing is optimised away. */
function work(): number {
  const g = graph();
  for (let sweep = 0; sweep < 24; sweep += 1) {
    const downwards = sweep % 2 === 0;
    const order = downwards ? g.byLayer.slice(1) : g.byLayer.slice(0, -1).reverse();
    for (const layer of order) sweepLayer(layer, downwards ? g.up : g.down);
  }
  const placed = new Map(g.nodes.map((n) => [n.id, { x: n.order * 120, y: n.layer * 80 }]));
  let sum = 0;
  for (const { x, y } of placed.values()) sum += x + y;
  return sum;
}

describe('calibration workload (NFR-PERF-005, ADR-0170)', () => {
  test('NFR-PERF-005: calibration', async ({ bench }) => {
    const sum = work();
    expect(work()).toBe(sum);
    await bench('calibration', () => {
      work();
    }).run({ time: 2_000, warmupTime: 0, warmupIterations: 2, iterations: 20 });
  });
});
