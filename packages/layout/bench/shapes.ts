// The inputs of the M17 layout benches (NFR-PERF-001): built from `graph` (bench/graph.ts), no randomness. A tree for the tree family, a graph
// with lanes and dates for timeline and swimlane.
import type { LayoutEdge, LayoutInput } from '../src/index.js';
import { graph } from './graph.js';

/** `n` nodes as a tree: node i hangs under node (i - 1) / 3, so each parent has three children. */
export function tree(n: number): LayoutInput {
  const { nodes, frame } = graph(n);
  const edges: LayoutEdge[] = nodes.slice(1).map((node, i) => ({ id: `t${i + 1}`, source: `n${Math.floor(i / 3)}`, target: node.id, order: i }));
  return { nodes, edges, frame };
}

/** The layered graph of `n` nodes in four lanes, each node dated by its index. */
export function laned(n: number): LayoutInput {
  const base = graph(n);
  return { ...base, nodes: base.nodes.map((node, i) => ({ ...node, hints: { lane: `L${i % 4}`, date: i } })) };
}
