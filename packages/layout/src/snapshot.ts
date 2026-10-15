// The snapshot builder (05-layout-and-routing.md §1, ADR-0033, FR-LAY-005): document records in, a `LayoutInput` out. The records are read
// structurally (this package depends on core and geometry, not on the schema), so the builder runs on a store's records, a parsed file
// or a test fixture alike. It is pure: the same records and request give the same input.
import type { Box } from '@fluxion/geometry';
import type { LayoutEdge, LayoutInput, LayoutNode, LayoutScope } from './types.js';

/**
 * A document record as the builder reads it: an object with an id and a type; every other field is checked before it is used.
 *
 * @public
 */
export type SnapshotRecord = {
  /** The record id. */
  readonly id: string;
  /** The record type (`element`, `binding`, ...). */
  readonly type: string;
  /** The screen an element is on. */
  readonly screenId?: unknown;
  /** The element kind (`shape`, `text`, `frame`, `group`, `connector`, ...). */
  readonly kind?: unknown;
  /** The fractional index among siblings. */
  readonly index?: unknown;
  /** The container holding an element. */
  readonly parentId?: unknown;
  /** The element's position and size. */
  readonly transform?: unknown;
  /** `pinned` keeps the stored position. */
  readonly placement?: unknown;
  /** Editing locks (`position`). */
  readonly locks?: unknown;
  /** True for a hidden element. */
  readonly hidden?: unknown;
  /** Meaning for AI and layouts. */
  readonly semantic?: unknown;
  /** For a binding: the connector it belongs to. */
  readonly connectorId?: unknown;
  /** For a binding: the element it is attached to. */
  readonly elementId?: unknown;
  /** For a binding: `source` or `target`. */
  readonly end?: unknown;
};

/**
 * What to lay out.
 *
 * @public
 */
export type SnapshotRequest = {
  /** The screen whose elements are read. */
  readonly screenId: string;
  /** All of the screen, the selected elements, or the children of one container (default `screen`). */
  readonly scope?: LayoutScope;
  /** The selected element ids, read when `scope` is `selection`. */
  readonly selection?: readonly string[];
  /** The area to lay out in; for a container scope the container's own box when omitted. */
  readonly frame?: Box;
};

/**
 * A layout input with its edges and scope always set.
 *
 * @public
 */
export type SnapshotInput = LayoutInput & {
  /** The connections between the nodes of the snapshot. */
  readonly edges: readonly LayoutEdge[];
  /** What the snapshot covers. */
  readonly scope: LayoutScope;
};

/** The frame a screen scope uses when the caller gives none: the default screen size. */
const DEFAULT_FRAME: Box = { x: 0, y: 0, w: 1920, h: 1080 };
/** Semantic fields that name the element rather than steer a layout; the rest of `semantic` is read as hints. */
const NAMING = new Set(['slug', 'label']);

type Boxed = {
  readonly id: string;
  readonly kind: string;
  readonly index: string;
  readonly parentId: string | undefined;
  readonly box: Box;
  readonly pinned: boolean;
  readonly hidden: boolean;
  readonly hints: { readonly [key: string]: unknown } | undefined;
};

const isObject = (v: unknown): v is { readonly [key: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The `transform` of a record as a box, or undefined when it has no usable one. */
function boxOf(transform: unknown): Box | undefined {
  if (!isObject(transform)) return undefined;
  const { x, y, w, h } = transform;
  return finite(x) && finite(y) && finite(w) && finite(h) ? { x, y, w, h } : undefined;
}

/**
 * The hints of an element: its `role` and `tags` and every other field of its `semantic` data that is a string, number or boolean
 * (rank, lane, partition, side, ...). `slug` and `label` name the element and are not hints. Undefined when there are none.
 */
function hintsOf(semantic: unknown): { readonly [key: string]: unknown } | undefined {
  if (!isObject(semantic)) return undefined;
  const hints: { [key: string]: unknown } = {};
  for (const key of Object.keys(semantic).sort()) {
    const value = semantic[key];
    if (NAMING.has(key)) continue;
    if (key === 'tags' && Array.isArray(value)) hints[key] = value.filter((t): t is string => typeof t === 'string');
    else if (['string', 'number', 'boolean'].includes(typeof value)) hints[key] = value;
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

/** A record as a laid-out candidate: an element that occupies a box and is not a connector (hidden ones included, see `visible`). */
function candidate(r: SnapshotRecord, screenId: string): Boxed | undefined {
  if (r.type !== 'element' || r.screenId !== screenId || r.kind === 'connector') return undefined;
  const box = boxOf(r.transform);
  if (!box || typeof r.index !== 'string') return undefined;
  const locked = isObject(r.locks) && r.locks['position'] === true;
  return {
    id: r.id,
    kind: String(r.kind),
    index: r.index,
    parentId: typeof r.parentId === 'string' ? r.parentId : undefined,
    box,
    pinned: r.placement === 'pinned' || locked,
    hidden: r.hidden === true,
    hints: hintsOf(r.semantic),
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The elements that are shown: not hidden themselves and not inside a hidden container (`hidden` hides the whole subtree). */
function visible(all: readonly Boxed[]): Boxed[] {
  const byId = new Map(all.map((e) => [e.id, e] as const));
  const shown = (e: Boxed): boolean => {
    const seen = new Set<string>();
    for (let at: Boxed | undefined = e; at !== undefined && !seen.has(at.id); at = at.parentId === undefined ? undefined : byId.get(at.parentId)) {
      if (at.hidden) return false;
      seen.add(at.id);
    }
    return true;
  };
  return all.filter(shown);
}

/** Ids of everything below `rootId` (children, their children, ...), in no particular order. */
function descendants(rootId: string, all: readonly Boxed[]): Set<string> {
  const found = new Set<string>();
  const queue = [rootId];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const e of all) {
      if (e.parentId === id && !found.has(e.id)) {
        found.add(e.id);
        queue.push(e.id);
      }
    }
  }
  return found;
}

/** The candidates the scope covers. */
function inScope(all: readonly Boxed[], scope: LayoutScope, selection: readonly string[]): readonly Boxed[] {
  if (scope === 'screen') return all;
  if (scope === 'selection') return all.filter((e) => selection.includes(e.id));
  const below = descendants(scope.containerId, all);
  return all.filter((e) => below.has(e.id));
}

/** The element each connector's source and target are bound to, by connector id. */
function boundEnds(records: readonly SnapshotRecord[]): Map<string, { source?: string; target?: string }> {
  const ends = new Map<string, { source?: string; target?: string }>();
  // a connector with two bindings for one end (a merged document) takes the one with the greater id, whatever the record order
  for (const r of [...records].sort((a, b) => compare(a.id, b.id))) {
    const isEnd = r.type === 'binding' && (r.end === 'source' || r.end === 'target');
    if (isEnd && typeof r.connectorId === 'string' && typeof r.elementId === 'string') {
      ends.set(r.connectorId, { ...ends.get(r.connectorId), [r.end as 'source' | 'target']: r.elementId });
    }
  }
  return ends;
}

/** Connectors with both ends bound to nodes of the set, as edges. */
function edgesOf(records: readonly SnapshotRecord[], ids: ReadonlySet<string>, screenId: string, ranks: ReadonlyMap<string, number>): LayoutEdge[] {
  const ends = boundEnds(records);
  const edges: LayoutEdge[] = [];
  for (const r of records) {
    const visible = r.type === 'element' && r.kind === 'connector' && r.screenId === screenId && r.hidden !== true;
    const e = visible ? ends.get(r.id) : undefined;
    if (e?.source !== undefined && e.target !== undefined && ids.has(e.source) && ids.has(e.target)) {
      edges.push({ id: r.id, source: e.source, target: e.target, order: ranks.get(r.id) ?? 0 });
    }
  }
  return edges.sort((a, b) => a.order - b.order || compare(a.id, b.id));
}

/** The frame of a request: the caller's, else the container's box, else the default screen size. */
function frameOf(request: SnapshotRequest, scope: LayoutScope, all: readonly Boxed[]): Box {
  if (request.frame) return request.frame;
  if (typeof scope === 'object') return all.find((e) => e.id === scope.containerId)?.box ?? DEFAULT_FRAME;
  return DEFAULT_FRAME;
}

/**
 * Build the layout input for one screen of `records`. Nodes are the visible, boxed elements of the scope (connectors are edges, not
 * nodes), numbered by their fractional index so the order is the canvas order. A node is `pinned` when its `placement` is `pinned` or
 * its position is locked; its `parentId` is kept when the parent is in the set too (nested containers, FR-LAY-005); its `hints` come
 * from its `semantic` data. Edges are the connectors with both ends bound to nodes of the set. `hidden` hides the element and everything
 * inside it. Limits, by decision for v1: a node's box is its stored `transform` (x, y, w, h): rotation, `locks.size` and a text element's
 * auto-size are not read, so a rotated or auto-sized element is laid out with its stored footprint.
 *
 * @public
 */
export function buildSnapshot(records: readonly SnapshotRecord[], request: SnapshotRequest): SnapshotInput {
  const scope = request.scope ?? 'screen';
  const elements = records.map((r) => candidate(r, request.screenId)).filter((e): e is Boxed => e !== undefined);
  const all = visible(elements);
  const ranks = new Map(
    [...records]
      .filter((r) => r.type === 'element' && r.screenId === request.screenId && typeof r.index === 'string')
      .sort((a, b) => compare(String(a.index), String(b.index)) || compare(a.id, b.id))
      .map((r, i) => [r.id, i] as const),
  );
  const chosen = inScope(all, scope, request.selection ?? []);
  const ids = new Set(chosen.map((e) => e.id));
  const nodes: LayoutNode[] = chosen
    .map((e) => ({
      id: e.id,
      box: e.box,
      order: ranks.get(e.id) ?? 0,
      ...(e.pinned ? { pinned: true } : {}),
      ...(e.parentId !== undefined && ids.has(e.parentId) ? { parentId: e.parentId } : {}),
      ...(e.hints ? { hints: e.hints } : {}),
    }))
    .sort((a, b) => a.order - b.order || compare(a.id, b.id));
  return { nodes, edges: edgesOf(records, ids, request.screenId, ranks), frame: frameOf(request, scope, elements), scope };
}
