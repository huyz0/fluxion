import { identity, multiply } from '@fluxion/geometry';
import { SVG_POLICY_LIMITS, type SvgArtworkNode } from '@fluxion/schema';
import type { ArtworkReference } from './artwork-attributes.js';
import type { SvgGeometry } from './svg-geometry.js';

export type ArtworkEntry = {
  readonly node: SvgArtworkNode;
  readonly geometry: SvgGeometry;
  readonly references: readonly ArtworkReference[];
  readonly children: number[];
};

/** Add reference edges after the full local ID inventory is known. */
export function artworkEdges(entries: readonly ArtworkEntry[], ids: ReadonlyMap<string, number>): number[][] | undefined {
  const edges = entries.map((entry) => [...entry.children]);
  for (const [index, entry] of entries.entries())
    for (const reference of entry.references) {
      const target = ids.get(reference.id);
      if (target === undefined || !reference.targets.includes(entries[target]?.node.name ?? '')) return undefined;
      edges[index]?.push(target);
    }
  return edges;
}

type GraphWalk = { readonly colors: Uint8Array; readonly costs: number[]; readonly pending: { index: number; next: number }[] };
function expandedCost(entry: ArtworkEntry, children: readonly number[], costs: readonly number[]): number | undefined {
  let cost = 1 + entry.node.children.filter((child) => typeof child === 'string').length;
  for (const child of children) {
    cost += costs[child] ?? 0;
    if (cost > SVG_POLICY_LIMITS.maxNodes) return undefined;
  }
  return cost;
}
function visitFrame(entries: readonly ArtworkEntry[], edges: readonly (readonly number[])[], walk: GraphWalk): boolean {
  const frame = walk.pending.at(-1);
  if (!frame) return false;
  walk.colors[frame.index] = 1;
  const next = edges[frame.index]?.[frame.next++];
  if (next !== undefined) {
    if (walk.colors[next] === 1) return false;
    if (walk.colors[next] === 0) walk.pending.push({ index: next, next: 0 });
  } else {
    const entry = entries[frame.index];
    if (!entry) return false;
    const cost = expandedCost(entry, edges[frame.index] ?? [], walk.costs);
    if (cost === undefined) return false;
    walk.costs[frame.index] = cost;
    walk.colors[frame.index] = 2;
    walk.pending.pop();
  }
  return true;
}
/** Detect cycles before expansion; count every repeated reference, not just unique nodes. */
export function artworkGraphBounded(entries: readonly ArtworkEntry[], edges: readonly (readonly number[])[]): boolean {
  const walk: GraphWalk = { colors: new Uint8Array(entries.length), costs: new Array<number>(entries.length).fill(0), pending: [{ index: 0, next: 0 }] };
  while (walk.pending.length) if (!visitFrame(entries, edges, walk)) return false;
  return expandedGeometry(entries, edges);
}

function expandedGeometry(entries: readonly ArtworkEntry[], edges: readonly (readonly number[])[]): boolean {
  const pending = [{ index: 0, matrix: identity(), depth: 1 }];
  while (pending.length) {
    const item = pending.pop();
    if (!item || item.depth > SVG_POLICY_LIMITS.maxDepth) return false;
    const geometry = entries[item.index]?.geometry;
    if (!geometry) return false;
    const matrix = multiply(item.matrix, geometry.matrix);
    const [a, b, c, d, e, f] = matrix;
    if (
      !matrix.every(Number.isFinite) ||
      !Number.isFinite((Math.abs(a) + Math.abs(c)) * geometry.extent + Math.abs(e)) ||
      !Number.isFinite((Math.abs(b) + Math.abs(d)) * geometry.extent + Math.abs(f))
    )
      return false;
    for (const index of edges[item.index] ?? []) pending.push({ index, matrix, depth: item.depth + 1 });
  }
  return true;
}
