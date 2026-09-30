// Hit-testing (FR-EDT-004, 04 §3.1): what is under a page point, by geometry rather than the DOM, so
// rotated shapes, hollow shapes and thin strokes hit where they are drawn (research 01 §2.3). A spatial
// index of every element's drawn bounds is kept from store diffs (and rebuilt when shape definitions
// or routers change); candidates near the point are tested exactly (a shape's outline through core's
// hitTestShape with its stroke, miter spikes included, and its label; a connector's route; any other
// element's box), with a pick margin of PICK_PX canvas px, and the topmost in paint order wins.
import { effect, evaluateOutline, hitTestShape, outlineDistance, type ShapeDef, type Store, textRegion } from '@fluxion/core';
import {
  apply,
  type Box,
  boxFromPoints,
  boxUnion,
  createDynamicIndex,
  type DynamicSpatialIndex,
  elementMatrix,
  invert,
  type Mat2d,
  type Path,
  pathBounds,
  pathFromCommands,
  pointInPath,
  transformBox,
  type Vec2,
} from '@fluxion/geometry';
import { type RouteContext, routeConnector } from '@fluxion/routing';
import { type AnyRecord, compareKeys, type ElementRecord, type RecordId, type RichTextDoc, transformRotation } from '@fluxion/schema';
import { type ResolvedStroke, resolveStyle, type Theme, toCssVars } from '@fluxion/theme';
import { miterWedges, nearWedge, type Wedge } from './stroke-join.js';

/**
 * The pick margin around what is drawn, in canvas px (page units: PICK_PX / zoom).
 *
 * @public
 */
export const PICK_PX = 4;

/**
 * What hit-testing reads besides the store: shape definitions and routers (render's registries
 * have both), and the theme styles resolve against.
 *
 * @public
 */
export type HitContext = {
  /** Shape definitions and connector routers. */
  readonly registries: RouteContext;
  /** The theme element styles resolve against (a new theme needs a new index). */
  readonly theme: Theme;
};

/** An element as hit-testing sees it: its drawn bounds and an exact test in page coordinates. */
type Hittable = {
  readonly screenId: RecordId;
  /** Drawn bounds, stroke included. */
  readonly bounds: Box;
  /** Whether `p` hits it, with `tolerance` page units of margin. */
  hits(p: Vec2, tolerance: number): boolean;
};

type Transform = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly flipX?: boolean; readonly flipY?: boolean };

/** What hit-testing resolves styles with: the context, and the theme's CSS variables. */
type Resolving = HitContext & { readonly vars: { readonly [name: string]: string | undefined } };

/** A resolved length (`2`, `4px`, `var(--fx-…)`) as px with the theme's values; 0 when it is none. */
function lengthOf(css: string, vars: Resolving['vars']): number {
  // tzap disable next-line StringLiteral: an unknown variable parses to NaN, then 0, whatever replaces it
  const n = Number.parseFloat(css.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars[name] ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Where a stroke is drawn (ADR-0019): its width, and whether it is centred on the outline, inside it
 * or outside it (an open outline's stroke is always centred). A transparent stroke draws nothing.
 */
type Stroke = { readonly width: number; readonly align: 'center' | 'inside' | 'outside' };

function strokeOf(stroke: ResolvedStroke, closed: boolean, vars: Resolving['vars']): Stroke {
  const width = stroke.color === 'transparent' ? 0 : lengthOf(stroke.width, vars);
  const align = closed && (stroke.align === 'inside' || stroke.align === 'outside') ? stroke.align : 'center';
  return { width, align };
}

/** The band a stroke covers, as signed distances from its outline (negative inside). */
function band(s: Stroke): readonly [number, number] {
  if (s.align === 'inside') return [-s.width, 0];
  return s.align === 'outside' ? [0, s.width] : [-s.width / 2, s.width / 2];
}

/** How far a stroke is drawn beyond its outline. */
// tzap disable next-line ArithmeticOperator, ConditionalExpression: a larger bound only adds candidates, which the exact test then drops
const outward = (s: Stroke): number => Math.max(0, band(s)[1]);

/**
 * Whether a point at `d` from the outline, `inside` it or not, is on the stroke `s` or within
 * `tolerance` of it.
 */
function onStroke(s: Stroke, d: number, inside: boolean, tolerance: number): boolean {
  const signed = inside ? -d : d;
  const [from, to] = band(s);
  return signed >= from - tolerance && signed <= to + tolerance;
}

/** A stroked outline: the band along it and the miter spikes at its joints, in its own coordinates. */
type Stroked = { readonly path: Path; readonly stroke: Stroke; readonly wedges: readonly Wedge[] };

/**
 * `path` stroked with `resolved`. An inside or outside stroke is drawn twice as wide and clipped to
 * one side of the outline (ADR-0019), so only its spikes on that side are drawn.
 */
function stroked(path: Path, resolved: ResolvedStroke, vars: Resolving['vars']): Stroked {
  const stroke = strokeOf(resolved, path.closed, vars);
  const half = stroke.align === 'center' ? stroke.width / 2 : stroke.width;
  // tzap disable next-line EqualityOperator, ConditionalExpression: a stroke of width 0 has spikes of size 0, within the band's margin
  const all = stroke.width > 0 && resolved.join === 'miter' ? miterWedges(path, half) : [];
  const wedges = stroke.align === 'center' ? all : all.filter((w) => pointInPath(path, w[0], 'nonzero') === (stroke.align === 'inside'));
  return { path, stroke, wedges };
}

/** Whether `l`, `inside` the outline or not, is on the stroke or within `tolerance` of it. */
const onStroked = (s: Stroked, l: Vec2, inside: boolean, tolerance: number): boolean =>
  onStroke(s.stroke, outlineDistance(s.path, l), inside, tolerance) || s.wedges.some((w) => nearWedge(l, w, tolerance));

/** The box of a stroked outline: its outline's, grown by the stroke, and its spikes'. */
function strokedBounds(s: Stroked, outline: Box): Box {
  const grown = grow(outline, outward(s.stroke));
  const tips = boxFromPoints(s.wedges.map((w) => w[0]));
  return tips === null ? grown : boxUnion(grown, tips);
}

/** Whether a label has any text to draw. */
const labelled = (doc: RichTextDoc | undefined): boolean =>
  // tzap disable next-line ArrayDeclaration: a string in place of the missing paragraphs has no content either
  (doc?.content ?? []).some((paragraph) => ((paragraph as { content?: readonly unknown[] }).content ?? []).length > 0);

/** Whether `l` is within `box`, or `tolerance` of it. */
const inBox = (l: Vec2, box: Box, tolerance: number): boolean =>
  // tzap disable next-line EqualityOperator: a point exactly at the margin's edge
  l.x >= box.x - tolerance && l.y >= box.y - tolerance && l.x <= box.x + box.w + tolerance && l.y <= box.y + box.h + tolerance;

/** The element's placement matrix, and its inverse (page to local). */
function placement(t: Transform): { readonly m: Mat2d; readonly inv: Mat2d } {
  const m = elementMatrix({ x: t.x, y: t.y, w: t.w, h: t.h, rot: transformRotation(t as never), flipX: t.flipX === true, flipY: t.flipY === true });
  // a placement only rotates, flips and moves, so it always inverts
  const inv = invert(m);
  return { m, inv: inv.ok ? inv.value : m };
}

/** An element hit as its box (text, image, frame, component and any kind without its own test). */
function boxHittable(screenId: RecordId, t: Transform): Hittable {
  const { m, inv } = placement(t);
  return {
    screenId,
    bounds: transformBox(m, { x: 0, y: 0, w: t.w, h: t.h }),
    hits: (p, tol) => inBox(apply(inv, p), { x: 0, y: 0, w: t.w, h: t.h }, tol),
  };
}

/** A shape hit on its outline: inside it when filled and closed, on its stroke, and on its label's region when it has text. */
function shapeHittable(element: ElementRecord & { readonly transform: Transform }, def: ShapeDef, ctx: Resolving): Hittable {
  const t = element.transform;
  const outlined = evaluateOutline(def, { w: t.w, h: t.h }, (element as { params?: Record<string, unknown> }).params);
  if (!outlined.ok) return boxHittable(element.screenId, t);
  const of =
    // tzap disable next-line ConditionalExpression, ObjectLiteral, ArrayDeclaration, StringLiteral: without defaults either form resolves alike; defaultsAt only locates diagnostics
    def.defaultStyle === undefined ? 'shape' : { kind: 'shape' as const, defaults: def.defaultStyle, defaultsAt: ['shapeDefs', def.id, 'defaultStyle'] };
  // tzap disable next-line StringLiteral, ArrayDeclaration: the path only locates diagnostics, which hit-testing drops
  const { style } = resolveStyle((element as { style?: unknown }).style as never, of as never, ctx.theme, ['records', element.id, 'style']);
  const path = outlined.value.path;
  // a hollow shape (no fill: `none` and `transparent` resolve to none) is hit on its stroke only
  const filled = style.fill.type !== 'none';
  const outline = stroked(path, style.stroke, ctx.vars);
  // a label is drawn in the definition's text region, over a hollow inside too
  const region = labelled((element as { text?: RichTextDoc }).text)
    ? textRegion(def, { w: t.w, h: t.h }, (element as { params?: Record<string, unknown> }).params)
    : undefined;
  const label = region?.ok === true ? region.value : undefined;
  const { m, inv } = placement(t);
  const drawn = strokedBounds(outline, pathBounds(path) ?? { x: 0, y: 0, w: t.w, h: t.h });
  return {
    screenId: element.screenId,
    bounds: transformBox(m, label === undefined ? drawn : boxUnion(drawn, label)),
    hits: (p, tol) => {
      const l = apply(inv, p);
      // an open outline has no inside
      const inside = path.closed && hitTestShape(path, l, 0);
      return (filled && inside) || onStroked(outline, l, inside, tol) || (label !== undefined && inBox(l, label, tol));
    },
  };
}

/** A connector hit along its route, within its stroke's reach. */
function connectorHittable(store: Store, ctx: Resolving, element: ElementRecord): Hittable | undefined {
  const routed = routeConnector(store, ctx.registries, element.id);
  if (routed === undefined) return undefined;
  const built = pathFromCommands(routed.commands);
  if (!built.ok) return undefined;
  const path: Path = built.value;
  const bounds = pathBounds(path);
  if (bounds === null) return undefined;
  // tzap disable next-line StringLiteral, ArrayDeclaration: the path only locates diagnostics, which hit-testing drops
  const { style } = resolveStyle((element as { style?: unknown }).style as never, 'connector', ctx.theme, ['records', element.id, 'style']);
  // a route is open: its stroke is centred, whatever the style's alignment
  const line = stroked(path, style.stroke, ctx.vars);
  const hits = (p: Vec2, tol: number) =>
    // tzap disable next-line BooleanLiteral: a centred stroke's band is the same on both sides
    onStroked(line, p, false, tol);
  return { screenId: element.screenId, bounds: strokedBounds(line, bounds), hits };
}

const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/** Whether element `r` is drawn: neither it nor any parent it sits in is hidden; a missing parent draws nothing. */
function drawn(store: Store, r: ElementRecord): boolean {
  let at: AnyRecord | undefined = r;
  while (at !== undefined) {
    if ((at as { hidden?: unknown }).hidden === true) return false;
    const parent = (at as { parentId?: RecordId }).parentId;
    if (parent === undefined) return true;
    at = store.get(parent);
  }
  // tzap disable next-line BooleanLiteral: a parent missing from the store is refused by its references check
  return false;
}

/**
 * The built-in kinds hit by something other than their box: a connector along its route, a group
 * not at all (it has no drawing of its own; its members are hit). Any other kind, a plugin's
 * included, is hit as its box, or its outline when it has a shape definition.
 */
const OWN_GEOMETRY: ReadonlyMap<string, (store: Store, ctx: Resolving, r: ElementRecord) => Hittable | undefined> = new Map([
  ['connector', connectorHittable],
  ['group', () => undefined],
]);

/** The hittable of element `id`, or undefined when it is not drawn or has nothing to hit (a group). */
function hittableOf(store: Store, ctx: Resolving, id: RecordId): Hittable | undefined {
  const got = store.get(id);
  // a diff also names screens and bindings: only elements are hit
  // tzap disable next-line ConditionalExpression: screens and bindings have no transform, and fall out below too
  if (got?.type !== 'element') return undefined;
  const r = got as ElementRecord;
  if (!drawn(store, r)) return undefined;
  const own = OWN_GEOMETRY.get(r.kind);
  if (own !== undefined) return own(store, ctx, r);
  const t = (r as { transform?: Transform }).transform;
  if (t === undefined) return undefined;
  // only shapes carry a defId
  // tzap disable next-line StringLiteral: no definition is registered under an empty id or any other
  const def = ctx.registries.shapeDefs.get((r as { defId?: string }).defId ?? '');
  return def === undefined ? boxHittable(r.screenId, t) : shapeHittable(r as ElementRecord & { transform: Transform }, def, ctx);
}

/**
 * The elements of `store` hit-tested by geometry, kept current from its diffs.
 *
 * @public
 */
export type HitIndex = {
  /** The topmost element of `screenId` drawn at page point `p` at zoom `zoom`, if any. */
  hitTest(screenId: RecordId, p: Vec2, zoom: number): RecordId | undefined;
  /** Stop following the store. */
  dispose(): void;
};

/** The elements a change of the records `ids` may have moved: them, their members, and connectors bound to them. */
function affected(store: Store, ids: Iterable<RecordId>): Set<RecordId> {
  const out = new Set<RecordId>();
  const visit = (id: RecordId) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of store.members('byParent', id)) visit(child);
    for (const b of store.members('bindingsByElement', id)) {
      const binding = store.get(b) as { connectorId?: RecordId } | undefined;
      if (binding?.connectorId !== undefined) visit(binding.connectorId);
    }
  };
  for (const id of ids) {
    const r = store.get(id);
    // a changed binding moves its connector (deleting one re-places the connector in the same
    // transaction, core's integrity hooks, so the connector is in the diff itself)
    // tzap disable next-line ConditionalExpression, StringLiteral: core's hooks re-put a connector whose binding changes too; this does not rely on them
    visit(r?.type === 'binding' ? (r as { connectorId: RecordId }).connectorId : id);
  }
  return out;
}

/** Paint order of every drawn element: screen by screen, back to front, members above their parent. */
function paintOrder(store: Store): Map<RecordId, number> {
  const rank = new Map<RecordId, number>();
  // tzap disable next-line StringLiteral: an element always has an index
  const indexOf = (id: RecordId) => String((store.get(id) as { index?: unknown }).index ?? '');
  // as render orders them: by fractional index, the id breaking a tie (a duplicate index is only a warning)
  // tzap disable next-line EqualityOperator: two ids are never equal
  const byIndex = (a: RecordId, b: RecordId) => compareKeys(indexOf(a), indexOf(b)) || (a < b ? -1 : 1);
  const walk = (ids: readonly RecordId[]) => {
    for (const id of [...ids].sort(byIndex)) {
      rank.set(id, rank.size);
      walk(store.members('byParent', id));
    }
  };
  for (const screen of store.members('byType', 'screen') as RecordId[]) {
    walk(store.members('byScreen', screen).filter((id) => (store.get(id) as { parentId?: unknown }).parentId === undefined));
  }
  return rank;
}

/**
 * A hit index over `store`, built now and kept from its diffs until disposed.
 *
 * @public
 */
export function createHitIndex(store: Store, context: HitContext): HitIndex {
  const ctx: Resolving = { ...context, vars: toCssVars(context.theme) as Resolving['vars'] };
  const index: DynamicSpatialIndex = createDynamicIndex();
  const hittables = new Map<RecordId, Hittable>();
  let order: Map<RecordId, number> | undefined;
  // tzap disable next-line BooleanLiteral: a rebuild too many is only slower
  let stale = false;
  const refresh = (id: RecordId) => {
    index.remove(id);
    // tzap disable next-line CallExpression: only ids the index returns are looked up; this frees a deleted element
    hittables.delete(id);
    const h = hittableOf(store, ctx, id);
    if (h === undefined) return;
    hittables.set(id, h);
    index.insert({ id, box: h.bounds });
  };
  const build = () => {
    for (const id of store.members('byType', 'element') as RecordId[]) refresh(id);
  };
  build();
  const unsubscribe = store.subscribe((diff) => {
    for (const id of affected(store, [...diff.puts.keys(), ...diff.deletes.keys()])) refresh(id);
    order = undefined;
  });
  // a shape definition or router registered, replaced or disposed changes how elements are drawn: the
  // next hit-test rebuilds (outside the effect, which then follows only the registries)
  // tzap disable next-line BooleanLiteral: a rebuild too many is only slower
  let first = true;
  const stopRegistries = effect(() => {
    context.registries.shapeDefs.changes$();
    context.registries.routers.changes$();
    stale = !first;
    first = false;
  });
  return {
    hitTest: (screenId, p, zoom) => {
      if (stale) {
        // tzap disable next-line BooleanLiteral: a rebuild too many is only slower
        stale = false;
        build();
      }
      const tol = PICK_PX / zoom;
      order ??= paintOrder(store);
      const rank = order;
      let best: RecordId | undefined;
      for (const id of index.search({ x: p.x - tol, y: p.y - tol, w: 2 * tol, h: 2 * tol }) as RecordId[]) {
        const h = hittables.get(id) as Hittable;
        if (h.screenId !== screenId || !h.hits(p, tol)) continue;
        // tzap disable next-line EqualityOperator: ranks are distinct, so > and >= pick alike
        // every indexed element is drawn, so it has a rank
        if (best === undefined || (rank.get(id) as number) > (rank.get(best) as number)) best = id;
      }
      return best;
    },
    dispose: () => {
      unsubscribe();
      stopRegistries();
    },
  };
}
