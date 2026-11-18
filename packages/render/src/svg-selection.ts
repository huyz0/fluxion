// The selection scope of an SVG export (ADR-0056 item 6, FR-EXP-004): the selected elements and their members, a connector only
// when both its ends are drawn, no master; and a viewBox of their world bounds widened by their stroke and effect outsets, rounded
// out to whole px, with what connectors draw. Pure: read from the store's view.
import type { ReadView } from '@fluxion/core';
import { type Box, elementBounds } from '@fluxion/geometry';
import type { ElementRecord, RecordId, Style, Transform } from '@fluxion/schema';
import { resolveStyle, type Theme } from '@fluxion/theme';
import { concreteLength } from './css-values.js';
import { styleReach } from './effects.js';
import { elementsInOrder } from './screen-order.js';
import { strokeReach } from './shape-view.js';

/**
 * What a selection export draws: `drawn`, every element shown, and `hidden`, the screen's other elements.
 *
 * @public
 */
export type SelectionScope = {
  /** The selected elements (connectors only with both ends drawn) and their members. */
  readonly drawn: ReadonlySet<RecordId>;
  /** The screen's elements left out. */
  readonly hidden: ReadonlySet<RecordId>;
};

const elementOf = (view: ReadView, id: RecordId): ElementRecord | undefined => {
  const r = view.get(id) as ElementRecord | undefined;
  return r?.type === 'element' ? r : undefined;
};

/** Whether `el` is a connector: the one kind drawn by its bound ends rather than its box. */
const isConnector = (el: ElementRecord): boolean => el.kind === 'connector';

/** `id` and its members, at any depth, but for connectors: a member connector is drawn by its ends, as any other. */
function withMembers(view: ReadView, id: RecordId, out: Set<RecordId>): void {
  out.add(id);
  for (const member of view.members('byParent', id)) {
    const el = elementOf(view, member);
    if (el !== undefined && !isConnector(el)) withMembers(view, member, out);
  }
}

/** The elements a connector's ends attach to (one per bound end). */
function endsOf(view: ReadView, connector: RecordId): RecordId[] {
  return view
    .members('bindingsByElement', connector)
    .map((b) => view.get(b) as { readonly type?: string; readonly connectorId?: RecordId; readonly elementId?: RecordId } | undefined)
    .filter((b) => b?.type === 'binding' && b.connectorId === connector && b.elementId !== undefined)
    .map((b) => b?.elementId as RecordId);
}

/**
 * The scope of an export of `selected` on `screenId`: the selected boxed elements and their boxed members, then every connector of the
 * screen whose two ends are both among them (selected or not); a selected connector with a free or an unselected end is left out.
 *
 * @public
 */
export function selectionScope(view: ReadView, screenId: RecordId, selected: Iterable<RecordId>): SelectionScope {
  const drawn = new Set<RecordId>();
  for (const id of selected) {
    const el = elementOf(view, id);
    // a connector is drawn by its ends, not by being selected
    if (el !== undefined && el.screenId === screenId && !isConnector(el)) withMembers(view, id, drawn);
  }
  const all = view.members('byScreen', screenId);
  for (const id of all) {
    const el = elementOf(view, id);
    if (el === undefined || !isConnector(el)) continue;
    const ends = endsOf(view, id);
    if (ends.length === 2 && ends.every((e) => drawn.has(e))) drawn.add(id);
  }
  return { drawn, hidden: new Set(all.filter((id) => !drawn.has(id))) };
}

/**
 * How far `element`'s drawing reaches past its box, px: its stroke's reach (as the shape views take it: outside strokes whole, mitre
 * and square corners), and with any shadow or effect, its filter region's margin, which adds the shadows' offsets, blurs and spreads
 * and the effects' radii to it.
 */
function outset(element: ElementRecord, theme: Theme): number {
  const { style } = resolveStyle((element as { readonly style?: Style }).style, element.kind, theme, ['records', element.id, 'style']);
  const margin = strokeReach(concreteLength(style.stroke.width, theme), style.stroke.align, style.stroke.join);
  return styleReach(style.shadows, style.effects, margin);
}

/**
 * The viewBox of a selection export: the union of the drawn boxed elements' world bounds, each widened by its outset, and of what
 * `extent` gives for the drawn elements without a box (a connector's route, markers and labels), rounded out to whole px; undefined
 * when nothing drawn has an extent.
 *
 * @public
 */
export function selectionViewBox(
  view: ReadView,
  drawn: Iterable<RecordId>,
  theme: Theme,
  extent: (id: RecordId) => Box | undefined = () => undefined,
): Box | undefined {
  const boxes: Box[] = [];
  for (const id of drawn) {
    const el = elementOf(view, id);
    if (el === undefined) continue;
    const t = (el as { readonly transform?: Transform }).transform;
    if (t === undefined) {
      const own = extent(id);
      if (own !== undefined) boxes.push(own);
      continue;
    }
    const b = elementBounds({ ...t, rot: t.rot ?? 0 });
    const o = outset(el, theme);
    boxes.push({ x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: b.h + 2 * o });
  }
  if (boxes.length === 0) return undefined;
  const x = Math.floor(Math.min(...boxes.map((b) => b.x)));
  const y = Math.floor(Math.min(...boxes.map((b) => b.y)));
  const right = Math.ceil(Math.max(...boxes.map((b) => b.x + b.w)));
  const bottom = Math.ceil(Math.max(...boxes.map((b) => b.y + b.h)));
  return { x, y, w: right - x, h: bottom - y };
}

/** The drawn elements of the screen in paint order whose parent is not drawn: where a selection's lists start. */
export function selectionRoots(view: ReadView, screenId: RecordId, drawn: ReadonlySet<RecordId>): RecordId[] {
  const out: RecordId[] = [];
  const walk = (parentId?: RecordId) => {
    for (const id of elementsInOrder(view, screenId, parentId)) {
      if (drawn.has(id)) out.push(id);
      else walk(id);
    }
  };
  walk();
  return out;
}
