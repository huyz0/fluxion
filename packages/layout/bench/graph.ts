// The graph both layered benches lay out (NFR-PERF-005): `n` nodes of mixed sizes on a 1920 x 1080 frame, in ranks of about sqrt(n) / 2 nodes
// (a flow chart is wide, not a chain), each node connected to two nodes of the next rank, so edges cross. Generated from the index, no randomness.
import type { LayoutEdge, LayoutInput, LayoutNode } from '../src/index.js';

/** A layered-friendly input of `n` nodes. */
export function graph(n: number): LayoutInput {
  const width = Math.max(2, Math.round(Math.sqrt(n) / 2) * 2);
  const nodes: LayoutNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    order: i,
    box: { x: (i * 37) % 1800, y: (i * 53) % 1000, w: 80 + (i % 5) * 20, h: 40 + (i % 3) * 20 },
  }));
  const edges: LayoutEdge[] = [];
  for (let i = 0; i + width < n; i++) {
    edges.push({ id: `a${i}`, source: `n${i}`, target: `n${i + width}`, order: edges.length });
    if (i % 2 === 0 && i + width + 1 < n) edges.push({ id: `b${i}`, source: `n${i}`, target: `n${i + width + 1}`, order: edges.length });
  }
  return { nodes, edges, frame: { x: 0, y: 0, w: 1920, h: 1080 } };
}
