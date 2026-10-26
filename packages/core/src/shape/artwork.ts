import { type Diagnostic, err, isSvgArtworkData, ok, type Result, SVG_POLICY_LIMITS, type SvgArtwork, type SvgArtworkNode } from '@fluxion/schema';
import { artworkAttributes, artworkReferences } from './artwork-attributes.js';
import { type ArtworkEntry, artworkEdges, artworkGraphBounded } from './artwork-graph.js';
import { svgGeometry } from './svg-geometry.js';

type Item = { readonly node: SvgArtworkNode; readonly depth: number; readonly parent?: number };
type Inventory = { readonly entries: ArtworkEntry[]; readonly ids: Map<string, number>; nodes: number };

function inspectNode(node: SvgArtworkNode): { entry: ArtworkEntry; id: string | undefined } | undefined {
  const attributes = artworkAttributes(node);
  if (!attributes) return undefined;
  const geometries = attributes.map((set) => svgGeometry(node, set));
  const referenceSets = attributes.map((set) => artworkReferences(node.name, set));
  if (geometries.some((g) => !g) || referenceSets.some((refs) => !refs)) return undefined;
  const main = geometries[0];
  if (!main) return undefined;
  const geometry = { matrix: main.matrix, extent: Math.max(...geometries.map((g) => g?.extent ?? 0)) };
  const { id } = attributes[0] ?? {};
  return { entry: { node, geometry, references: referenceSets.flatMap((refs) => refs ?? []), children: [] }, id };
}

function addNode(item: Item, inventory: Inventory): number | string {
  const { node, depth, parent } = item;
  inventory.nodes += 1 + node.children.filter((child) => typeof child === 'string').length;
  if (depth > SVG_POLICY_LIMITS.maxDepth || inventory.nodes > SVG_POLICY_LIMITS.maxNodes) return 'artwork exceeds its node/depth bound';
  const inspected = inspectNode(node);
  if (!inspected) return 'artwork has disallowed data, invalid geometry or reference syntax';
  const { entry, id } = inspected;
  if (id !== undefined && inventory.ids.has(id)) return 'artwork IDs must be unique';
  const index = inventory.entries.length;
  inventory.entries.push(entry);
  if (parent !== undefined) inventory.entries[parent]?.children.push(index);
  if (id !== undefined) inventory.ids.set(id, index);
  return index;
}

function pushChildren(pending: Item[], item: Item, parent: number): void {
  for (let i = item.node.children.length - 1; i >= 0; i--) {
    const child = item.node.children[i];
    if (child && typeof child !== 'string') pending.push({ node: child, depth: item.depth + 1, parent });
  }
}

function artworkProblem(artwork: SvgArtwork): string | undefined {
  const { x, y, width, height } = artwork.viewBox;
  if (![x + width, y + height, 1 / width, 1 / height, x / width, y / height].every(Number.isFinite)) return 'artwork viewport arithmetic is nonfinite';
  const inventory: Inventory = { entries: [], ids: new Map(), nodes: 0 };
  const pending: Item[] = [{ node: artwork.root, depth: 1 }];
  while (pending.length) {
    const item = pending.pop();
    if (!item) break;
    const index = addNode(item, inventory);
    if (typeof index === 'string') return index;
    pushChildren(pending, item, index);
  }
  const edges = artworkEdges(inventory.entries, inventory.ids);
  return edges && artworkGraphBounded(inventory.entries, edges)
    ? undefined
    : 'artwork has dangling/cyclic references, excessive expansion or nonfinite transforms';
}

/** Validate imported paint, including direct caller objects, before rendering or registration. @public */
export function parseSvgArtwork(input: unknown): Result<SvgArtwork, readonly Diagnostic[]> {
  if (!isSvgArtworkData(input))
    return err([{ code: 'FLX_SHAPE_DEF_INVALID', severity: 'error', path: '', message: 'artwork must be bounded plain JSON with valid structure' }]);
  const problem = artworkProblem(input);
  if (problem) return err([{ code: 'FLX_SHAPE_DEF_INVALID', severity: 'error', path: '', message: problem }]);
  // Descriptor preflight excludes accessors, cycles and aliases; clone to isolate caller mutation.
  return ok(JSON.parse(JSON.stringify(input)) as SvgArtwork);
}
