// Hit-testing (FR-EDT-004, 04 §3.1): what is under a page point, by geometry rather than the DOM, so
// rotated shapes, hollow shapes and thin strokes hit where they are drawn (research 01 §2.3). A spatial
// index of every element's drawn bounds is kept from store diffs (and rebuilt when shape definitions
// or routers change); candidates near the point are tested exactly (a shape's outline through core's
// hitTestShape with its stroke, miter spikes included, and its label; a connector's route; any other
// element's box), with a pick margin of PICK_PX canvas px, and the topmost in paint order wins.
import { effect, evaluateOutline, hitTestShape, type ShapeDef, type Store, textRegion } from '@fluxion/core';
import {
  apply,
  type Box,
  boxUnion,
  createDynamicIndex,
  type DynamicSpatialIndex,
  elementMatrix,
  invert,
  type Mat2d,
  pathBounds,
  transformBox,
  type Vec2,
} from '@fluxion/geometry';
import { type AnyRecord, type ElementRecord, type RecordId, type RichTextDoc, transformRotation } from '@fluxion/schema';
import { resolveStyle, toCssVars } from '@fluxion/theme';
import { boxTouches, rectOutline } from './box-touch.js';
import { connectorHittable } from './connector-hit.js';
import { type HitContext, type Hittable, inBox, type Resolving } from './hittable.js';
import { affected, paintOrder } from './paint-order.js';
import { grow, onStroked, reachOf, stroked, strokedBounds } from './stroke-band.js';

/**
 * The pick margin around what is drawn, in canvas px (page units: PICK_PX / zoom).
 *
 * @public
 */
export const PICK_PX = 4;

type Transform = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly flipX?: boolean; readonly flipY?: boolean };

/** Whether a label has any text to draw. */
const labelled = (doc: RichTextDoc | undefined): boolean =>
  // tzap disable next-line ArrayDeclaration: a string in place of the missing paragraphs has no content either
  (doc?.content ?? []).some((paragraph) => ((paragraph as { content?: readonly unknown[] }).content ?? []).length > 0);

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
  const outline = rectOutline(t.w, t.h);
  return {
    screenId,
    bounds: transformBox(m, { x: 0, y: 0, w: t.w, h: t.h }),
    hits: (p, tol) => inBox(apply(inv, p), { x: 0, y: 0, w: t.w, h: t.h }, tol),
    // (a box whose size is no number has no outline; the schema refuses one)
    touches: (box) => outline !== undefined && boxTouches(outline, true, box, inv),
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
  // the label's region as an outline of its own, from its corner
  const labelOutline = label === undefined ? undefined : rectOutline(label.w, label.h);
  const labelFrame: Mat2d = label === undefined ? inv : [inv[0], inv[1], inv[2], inv[3], inv[4] - label.x, inv[5] - label.y];
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
    // the stroke is drawn out to its reach from the outline: a box that near touches it
    touches: (box) =>
      boxTouches(path, filled, grow(box, reachOf(outline.stroke)), inv) || (labelOutline !== undefined && boxTouches(labelOutline, true, box, labelFrame)),
  };
}

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
  /**
   * The selectable elements of `screenId` (a group stands for its members) that the page box `box`
   * contains, drawn bounds and all members (`contain`), or touches where anything is drawn
   * (`intersect`), back to front; an element inside another one picked is left out.
   */
  within(screenId: RecordId, box: Box, mode: 'contain' | 'intersect'): RecordId[];
  /** Every selectable element of `screenId` inside no other one, back to front (select all). */
  all(screenId: RecordId): RecordId[];
  /**
   * What a click on `id` selects: the outermost group it sits in, or itself. A group has no drawing
   * of its own, so its members stand for it; a frame's or component's children are selected alone.
   */
  selectableOf(id: RecordId): RecordId;
  /** Stop following the store. */
  dispose(): void;
};

/** Whether `r` is a group: drawn by its members alone, which a click on any of them selects. */
const isGroup = (r: AnyRecord | undefined): boolean => (r as { kind?: unknown } | undefined)?.kind === 'group';

/** A hit index: elements' hittables in an rbush index, kept from store diffs and registry changes. */
class Index implements HitIndex {
  readonly #store: Store;
  readonly #ctx: Resolving;
  readonly #index: DynamicSpatialIndex = createDynamicIndex();
  readonly #hittables = new Map<RecordId, Hittable>();
  #order: Map<RecordId, number> | undefined;
  // tzap disable next-line BooleanLiteral: a rebuild too many is only slower
  #stale = false;
  readonly #stop: readonly (() => void)[];

  constructor(store: Store, context: HitContext) {
    this.#store = store;
    this.#ctx = { ...context, vars: toCssVars(context.theme) as Resolving['vars'] };
    this.#build();
    const unsubscribe = store.subscribe((diff) => {
      for (const id of affected(store, [...diff.puts.keys(), ...diff.deletes.keys()])) this.#refresh(id);
      this.#order = undefined;
    });
    // a shape definition or router registered, replaced or disposed changes how elements are drawn:
    // the next query rebuilds (outside the effect, which then follows only the registries)
    // tzap disable next-line BooleanLiteral: a rebuild too many is only slower
    let first = true;
    const stopRegistries = effect(() => {
      context.registries.shapeDefs.changes$();
      context.registries.routers.changes$();
      context.registries.markers?.changes$();
      this.#stale = !first;
      first = false;
    });
    this.#stop = [unsubscribe, stopRegistries];
  }

  #refresh(id: RecordId): void {
    this.#index.remove(id);
    // tzap disable next-line CallExpression: only ids the index returns are looked up; this frees a deleted element
    this.#hittables.delete(id);
    const h = hittableOf(this.#store, this.#ctx, id);
    if (h === undefined) return;
    this.#hittables.set(id, h);
    this.#index.insert({ id, box: h.bounds });
  }

  #build(): void {
    for (const id of this.#store.members('byType', 'element') as RecordId[]) this.#refresh(id);
  }

  /** The paint order, with the index current (rebuilt when the registries changed). */
  #ready(): Map<RecordId, number> {
    if (this.#stale) {
      // tzap disable next-line BooleanLiteral: a rebuild too many is only slower
      this.#stale = false;
      this.#build();
    }
    this.#order ??= paintOrder(this.#store);
    return this.#order;
  }

  /** `ids` of `screenId` only, back to front by `rank`. */
  #backToFront(ids: readonly RecordId[], screenId: RecordId, rank: Map<RecordId, number>): RecordId[] {
    const on = (id: RecordId) => (this.#store.get(id) as { screenId?: RecordId } | undefined)?.screenId === screenId;
    return ids.filter(on).sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number));
  }

  selectableOf(id: RecordId): RecordId {
    let top = id;
    for (let parent = this.#groupAbove(top); parent !== undefined; parent = this.#groupAbove(top)) top = parent;
    return top;
  }

  /** The group `id` sits in directly, if it sits in one. */
  #groupAbove(id: RecordId): RecordId | undefined {
    const parent = (this.#store.get(id) as { parentId?: RecordId } | undefined)?.parentId;
    return parent !== undefined && isGroup(this.#store.get(parent)) ? parent : undefined;
  }

  /** The drawn elements a selectable element stands for: itself when drawn, and a group's drawn members, all the way down. */
  #drawnIn(id: RecordId): RecordId[] {
    const members = isGroup(this.#store.get(id)) ? this.#store.members('byParent', id).flatMap((m) => this.#drawnIn(m)) : [];
    return this.#hittables.has(id) ? [id, ...members] : members;
  }

  /** `ids` without those inside another one of them (a frame and its child: the frame). */
  #outermost(ids: ReadonlySet<RecordId>): RecordId[] {
    const inAnother = (id: RecordId) => {
      for (
        let p = (this.#store.get(id) as { parentId?: RecordId }).parentId;
        p !== undefined;
        p = (this.#store.get(p) as { parentId?: RecordId } | undefined)?.parentId
      )
        if (ids.has(p)) return true;
      return false;
    };
    return [...ids].filter((id) => !inAnother(id));
  }

  within(screenId: RecordId, box: Box, mode: 'contain' | 'intersect'): RecordId[] {
    const rank = this.#ready();
    // tzap disable next-line EqualityOperator: bounds exactly on the box's edge
    const inside = (b: Box) => b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
    const hittable = (id: RecordId) => this.#hittables.get(id) as Hittable;
    const candidates = new Set((this.#index.search(box) as RecordId[]).map((id) => this.selectableOf(id)));
    const picked = [...candidates].filter((id) =>
      mode === 'intersect' ? this.#drawnIn(id).some((d) => hittable(d).touches(box)) : this.#drawnIn(id).every((d) => inside(hittable(d).bounds)),
    );
    return this.#backToFront(this.#outermost(new Set(picked)), screenId, rank);
  }

  all(screenId: RecordId): RecordId[] {
    const rank = this.#ready();
    return this.#backToFront(this.#outermost(new Set([...this.#hittables.keys()].map((id) => this.selectableOf(id)))), screenId, rank);
  }

  hitTest(screenId: RecordId, p: Vec2, zoom: number): RecordId | undefined {
    const rank = this.#ready();
    const tol = PICK_PX / zoom;
    let best: RecordId | undefined;
    for (const id of this.#index.search({ x: p.x - tol, y: p.y - tol, w: 2 * tol, h: 2 * tol }) as RecordId[]) {
      const h = this.#hittables.get(id) as Hittable;
      if (h.screenId !== screenId || !h.hits(p, tol)) continue;
      // every indexed element is drawn, so it has a rank
      // tzap disable next-line EqualityOperator: ranks are distinct, so > and >= pick alike
      if (best === undefined || (rank.get(id) as number) > (rank.get(best) as number)) best = id;
    }
    return best;
  }

  dispose(): void {
    for (const stop of this.#stop) stop();
  }
}

/**
 * A hit index over `store`, built now and kept from its diffs until disposed.
 *
 * @public
 */
export function createHitIndex(store: Store, context: HitContext): HitIndex {
  return new Index(store, context);
}
