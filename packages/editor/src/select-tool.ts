// The select tool (FR-EDT-003, FR-EDT-004, FR-EDT-005): a click picks the topmost element (shift
// toggles it, and a click inside a multi-selection narrows it); a drag from empty canvas is a marquee;
// a drag from an element moves the selection, alt-drag moves copies of it. The keys (arrows nudge,
// ctrl/cmd + A selects all, Delete deletes) are keymap bindings whose commands call the functions
// here while the tool is idle (M7.4). A drag is one gesture, so one undo step.

import { dropReparents, hasLock } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { adjusting, bending, type ConnectorGrab, connectorHandleUnder, ending, type ParamGrab, paramHandleUnder } from './handle-states.js';
import { duplicates, moved, reframed, resizeStarts, restored, type Start, starts } from './move.js';
import { frameBox, HANDLE_PX, type HandleId, handleAt, type Placed, selectionFrame } from './overlay-geometry.js';
import { isPathEditing, leavePathEdit, type PathGrab, pathPressUnder, reshaping } from './path-edit-states.js';
import { beginGesture, type Gesture, type PointerInfo } from './pointer.js';
import { pickable } from './select-actions.js';
import { clickSelection, DRAG_PX, marquee, union } from './selection.js';
import { GRID_CELL, snapAngle, snapBox, snapResize } from './snap/snap.js';
import { boundsOf, snapScreen, snapTargets } from './snap/targets.js';
import { pickCell } from './table-edit.js';
import { type BorderGrab, borderUnder, tableResizing } from './table-resize.js';
import { SELECT_TOOL, type StateNode, type Tool, type ToolCtx } from './tools.js';
import { TOUCH } from './touch.js';
import { type Box2, EDGES, handlePoint, resize, rotation } from './transform.js';

/**
 * A drag of the selection under way: where it started, what moves, the gesture writing it, and for an
 * alt-drag the copies it made and the selection before them.
 */
type Drag = {
  readonly page: Vec2;
  readonly from: readonly Start[];
  readonly gesture: Gesture;
  /** The selection's drawn bounds as the drag started, and what it may snap to (absent: the drag does not snap). */
  readonly snap?: { readonly box: Box; readonly others: readonly Box[]; readonly screen: { readonly w: number; readonly h: number } | undefined };
  readonly copies?: { readonly ids: readonly RecordId[]; readonly before: readonly RecordId[] };
};

/**
 * Start dragging the selection from page point `page`; with alt, drag copies of it (made in the same
 * gesture, so undo takes them away with the move).
 */
function startDrag(ctx: ToolCtx, page: Vec2, alt: boolean): Drag {
  const gesture = beginGesture(ctx.execute, ctx.seal);
  const before = ctx.session.selection.get();
  const copies = alt ? duplicates(ctx.view, before, ctx.newId) : undefined;
  if (copies !== undefined) {
    gesture.update('element.createMany', { elements: copies.records });
    // copies the document refuses (or none: createMany wants one at least) leave the originals to drag
    if (gesture.commit()?.ok === true) {
      ctx.session.selection.set(copies.ids);
      const ids = copies.ids;
      return { page, from: starts(ctx.view, ids), gesture, ...snapping(ctx, ids), copies: { ids: copies.records.map((r) => r.id), before } };
    }
  }
  // a position-locked element stays, so neither its box nor its members snap with the drag (FR-SHP-008)
  const movable = before.filter((id) => !hasLock(ctx.view, id, 'position'));
  return { page, from: starts(ctx.view, movable), gesture, ...snapping(ctx, movable) };
}

/** What a drag of `ids` snaps to, or nothing when snapping is off or they have no box. */
function snapping(ctx: ToolCtx, ids: readonly RecordId[]): Pick<Drag, 'snap'> {
  const box = ctx.session.snap.get() ? boundsOf(ctx.view, ids) : undefined;
  if (box === undefined || ctx.screen === undefined) return {};
  const moving = new Set(starts(ctx.view, ids).map((s) => s.id));
  return { snap: { box, others: snapTargets(ctx.view, ctx.screen, moving), screen: snapScreen(ctx.view, ctx.screen) } };
}

/**
 * Move the dragged records to follow the pointer at `page`: one command, once per frame. The selection's bounds
 * snap to the other elements and the screen unless `bypass` (Alt held after the press, or Ctrl/Cmd), and the guides
 * of what it lines up with are shown.
 */
function follow(ctx: ToolCtx, drag: Drag, page: Vec2, bypass = false): void {
  let d = { x: page.x - drag.page.x, y: page.y - drag.page.y };
  if (drag.snap !== undefined) {
    const { box, others, screen } = drag.snap;
    const hit = snapBox({ ...box, x: box.x + d.x, y: box.y + d.y }, others, {
      zoom: ctx.session.camera.get().z,
      bypass,
      ...(screen === undefined ? {} : { screen }),
      ...(ctx.session.grid.get() ? { grid: GRID_CELL } : {}),
    });
    d = { x: d.x + hit.dx, y: d.y + hit.dy };
    ctx.session.guides.set(hit.guides);
  }
  // nothing of its own to move: the command refuses the empty list, and nothing changes
  drag.gesture.update('element.updateMany', { updates: moved(drag.from, d) });
  drag.gesture.commit();
  // the frame a drop here would put an element into is outlined (ADR-0052)
  const into = dropReparents(ctx.view, ctx.session.selection.get()).map((u) => u.fields['parentId'] as RecordId | undefined);
  ctx.session.dropTarget.set(into.find((id) => (ctx.view.get(id as RecordId) as { kind?: unknown } | undefined)?.kind === 'frame'));
}

/** Whether the pointer `e` skips snapping: Alt after the press (one that made copies is a duplicate, not a bypass) or Ctrl/Cmd. */
const skipsSnap = (e: PointerInfo, drag: Drag): boolean => e.mod || (e.alt && drag.copies === undefined);

/**
 * A resized frame with the edges its handle moves brought to the other elements, the screen and the grid, and the guides
 * shown. Only an unturned frame snaps (a turned one has no edge on an axis); Alt (which resizes from the centre), Ctrl/Cmd
 * and shift (which keeps the aspect) leave the size as dragged.
 */
function snapped(ctx: ToolCtx, h: Handle, sized: Box2, e: PointerInfo): Box2 {
  ctx.session.guides.set([]);
  if (h.snap === undefined || h.box.rot !== 0 || e.alt || e.mod || e.shift) return sized;
  const edges = EDGES[h.id as HandleId];
  const hit = snapResize(sized, edges, h.snap.others, {
    zoom: ctx.session.camera.get().z,
    ...(h.snap.screen === undefined ? {} : { screen: h.snap.screen }),
    ...(ctx.session.grid.get() ? { grid: GRID_CELL } : {}),
  });
  ctx.session.guides.set(hit.guides);
  return { ...hit.box, rot: sized.rot };
}

/** A press on a handle of the selection frame: which, the frame and what is in it as they started. */
type Handle = {
  readonly id: HandleId | 'rotate';
  readonly box: Box2;
  readonly page: Vec2;
  readonly from: readonly Start[];
  /** Whether a selected element holds an aspect lock: the resize keeps the frame's ratio. */
  readonly aspect: boolean;
  /** What a resize snaps to, as for a drag (absent: snapping is off). */
  readonly snap?: Drag['snap'];
};

/** The handle of the selection's frame under canvas point `e.screen`, if any. */
function handleUnder(ctx: ToolCtx, e: PointerInfo): Handle | undefined {
  const selected = ctx.session.selection.get();
  const placed = selected.map((id) => (ctx.view.get(id) as { transform?: Placed } | undefined)?.transform).filter((t): t is Placed => t !== undefined);
  // a finger reaches a handle further than a mouse (FR-EDT-019)
  const id = handleAt(selectionFrame(placed, ctx.session.camera.get()), e.screen, e.pointerType === 'touch' ? TOUCH.handlePx : HANDLE_PX);
  const box = frameBox(placed);
  if (id === undefined || box === undefined) return undefined;
  // a turn carries every member (a frame's too); a resize changes a frame's box alone (ADR-0052)
  // a rotation lock keeps an element's turn, a size lock its size; an aspect lock keeps the ratio as shift does; in a frame of several
  // a position-locked element is not carried with the others (FR-SHP-008, M19.15 r2 F1)
  const carried = selected.length > 1 ? selected.filter((x) => !hasLock(ctx.view, x, 'position')) : selected;
  const from = id === 'rotate' ? starts(ctx.view, carried, 'rotation') : resizeStarts(ctx.view, carried);
  const aspect = selected.some((x) => hasLock(ctx.view, x, 'aspect'));
  return { id, box, page: e.page, from, aspect, ...snapping(ctx, selected) };
}

/**
 * The state that drags a handle: each move sets the frame `after(handle, e)` and carries what is in it
 * along, one command a frame; the whole drag is one undo step; Esc puts it all back.
 */
function transforming(p: Press, id: string, after: (h: Handle, e: PointerInfo, ctx: ToolCtx) => Box2): StateNode {
  let gesture: Gesture | undefined;
  const set = (h: Handle, box: Box2) => {
    gesture?.update('element.updateMany', { updates: reframed(h.from, h.box, box) });
    gesture?.commit();
  };
  return {
    id,
    onEnter: (ctx) => {
      gesture = beginGesture(ctx.execute, ctx.seal);
    },
    onPointerMove: (ctx, e) => {
      const h = p.handle as Handle;
      set(h, after(h, e, ctx));
      return undefined;
    },
    onPointerUp: () => ({ to: 'idle' }),
    onCancel: () => {
      const h = p.handle as Handle;
      gesture?.update('element.updateMany', { updates: restored(h.from) });
      gesture?.commit();
      return { to: 'idle' };
    },
    // tzap disable next-line BlockStatement: each frame commits at once, and the next gesture's own merge key starts a new undo step anyway
    onExit: (ctx) => {
      gesture?.end();
      gesture = undefined;
      ctx.session.guides.set([]);
    },
  };
}

/** What a press left for the states after it. */
type Press = {
  /** A press on empty canvas: where, with shift or not, and what was selected before. */
  marquee?: { readonly screen: Vec2; readonly page: Vec2; readonly shift: boolean; readonly before: readonly RecordId[] } | undefined;
  /** A plain press on an element already selected: a click (no drag) selects it alone. */
  narrow?: RecordId | undefined;
  /** A shift-press on an element already selected: a click (no drag) takes it out of the selection. */
  toggle?: RecordId | undefined;
  /** A press on an element: where, and with alt or not (a drag from it moves the selection). */
  grab?: { readonly screen: Vec2; readonly page: Vec2; readonly alt: boolean } | undefined;
  /** The drag under way. */
  drag?: Drag | undefined;
  /** A press on a handle of the selection frame. */
  handle?: Handle | undefined;
  /** A press on a parametric handle of the selected shape. */
  param?: ParamGrab | undefined;
  /** A press on a handle of the selected connector. */
  connector?: ConnectorGrab | undefined;
  /** A press on a vertex, bezier handle or segment of the path being edited. */
  path?: PathGrab | undefined;
  /** A press on a border between two rows or columns of the selected table. */
  border?: BorderGrab | undefined;
};

/**
 * A primary press at `e`: select what it hits (a press on a selected element keeps the selection,
 * for a drag; released without one, it narrows the selection, or with shift takes the element out),
 * and note what a drag from here would do.
 */
function pressed(ctx: ToolCtx, e: PointerInfo, p: Press): void {
  const under = ctx.hitTest(e.page);
  // a press on a selection-locked element is a press on empty canvas
  const hit = under !== undefined && pickable(ctx, under) ? under : undefined;
  const before = ctx.session.selection.get();
  // a press off the path being edited stops editing it
  if (hit !== ctx.session.pathEdit.get()?.id) leavePathEdit(ctx);
  const kept = hit !== undefined && before.includes(hit);
  if (!kept) ctx.session.selection.set(clickSelection(before, hit, e.shift));
  // a press on a selected table picks a cell (shift extends the range) rather than narrowing or toggling the selection
  // (only when the table is the whole selection: in a larger one, the press narrows or toggles as on any element)
  const cell = kept && hit !== undefined && before.length === 1 && pickCell(ctx, hit, e.page, e.shift);
  p.narrow = kept && !e.shift && !cell ? hit : undefined;
  p.toggle = kept && e.shift && !cell ? hit : undefined;
  p.marquee = hit === undefined ? { screen: e.screen, page: e.page, shift: e.shift, before } : undefined;
  // read only when the press was on an element (the marquee is decided first)
  p.grab = { screen: e.screen, page: e.page, alt: e.alt };
}

/** A press on a handle of the selection: the state it starts, and what the states after it need, in `p`. */
function handlePress(ctx: ToolCtx, e: PointerInfo, p: Press): string | undefined {
  p.path = pathPressUnder(ctx, e);
  if (p.path !== undefined) return 'reshaping';
  // a path being edited shows no frame handles (overlay.tsx), so none takes the press
  if (isPathEditing(ctx)) return undefined;
  p.param = paramHandleUnder(ctx, e);
  if (p.param !== undefined) return 'adjusting';
  p.connector = connectorHandleUnder(ctx, e);
  if (p.connector !== undefined) return p.connector.handle.role === 'end' ? 'ending' : 'bending';
  p.handle = handleUnder(ctx, e);
  if (p.handle !== undefined) return p.handle.id === 'rotate' ? 'rotating' : 'resizing';
  // a table's inner borders after the frame handles, so a border meeting the edge at a handle leaves it the handle's
  p.border = borderUnder(ctx, e);
  return p.border === undefined ? undefined : 'tableResizing';
}

function idle(p: Press): StateNode {
  return {
    id: 'idle',
    onPointerMove: (ctx, e) => {
      ctx.session.hover.set(ctx.hitTest(e.page));
      return undefined;
    },
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return undefined;
      // a handle of the selected shape or connector first, then one of the selection's frame: all lie over what they frame
      const handled = handlePress(ctx, e, p);
      if (handled !== undefined) return { to: handled };
      pressed(ctx, e, p);
      return { to: 'pointing' };
    },
  };
}

function pointing(p: Press): StateNode {
  return {
    id: 'pointing',
    onPointerMove: (_ctx, e) => {
      const from = p.marquee?.screen ?? p.grab?.screen;
      // tzap disable next-line EqualityOperator: a move of exactly DRAG_PX
      if (from === undefined || Math.hypot(e.screen.x - from.x, e.screen.y - from.y) < DRAG_PX) return undefined;
      return { to: p.marquee === undefined ? 'translating' : 'brushing', info: e };
    },
    onPointerUp: (ctx) => {
      if (p.narrow !== undefined) ctx.session.selection.set([p.narrow]);
      // a shift-click on nothing selected-and-held leaves the selection as it is
      ctx.session.selection.set(clickSelection(ctx.session.selection.get(), p.toggle, true));
      return { to: 'idle' };
    },
    onCancel: () => ({ to: 'idle' }),
  };
}

function translating(p: Press): StateNode {
  return {
    id: 'translating',
    onEnter: (ctx, info) => {
      const grab = p.grab as NonNullable<Press['grab']>;
      p.drag = startDrag(ctx, grab.page, grab.alt);
      const first = info as PointerInfo;
      follow(ctx, p.drag, first.page, skipsSnap(first, p.drag));
    },
    onPointerMove: (ctx, e) => {
      const drag = p.drag as Drag;
      follow(ctx, drag, e.page, skipsSnap(e, drag));
      return undefined;
    },
    // the drop: what the drag brought into a frame joins it, what it took out of one leaves it, in the drag's undo step (ADR-0052)
    onPointerUp: (ctx) => {
      const drag = p.drag as Drag;
      const reparents = dropReparents(ctx.view, ctx.session.selection.get());
      if (reparents.length > 0) {
        drag.gesture.update('element.updateMany', { updates: reparents });
        drag.gesture.commit();
      }
      return { to: 'idle' };
    },
    // Esc undoes the drag in the same gesture: things go back where they started, copies away (the
    // history then drops the step, which changed nothing)
    onCancel: (ctx) => {
      const drag = p.drag as Drag;
      if (drag.copies === undefined) {
        drag.gesture.update('element.updateMany', { updates: restored(drag.from) });
        drag.gesture.commit();
      } else {
        // committed as the gesture ends, on leaving this state
        drag.gesture.update('element.delete', { ids: drag.copies.ids });
        ctx.session.selection.set(drag.copies.before);
      }
      return { to: 'idle' };
    },
    // tzap disable next-line BlockStatement: each frame commits at once, and the next gesture's own merge key starts a new undo step anyway
    onExit: (ctx) => {
      p.drag?.gesture.end();
      p.drag = undefined;
      ctx.session.guides.set([]);
      ctx.session.dropTarget.set(undefined);
    },
  };
}

function brushing(p: Press): StateNode {
  /** The marquee from the press to `e`, and what it selects (added to the old selection with shift). */
  const brush = (ctx: ToolCtx, e: { readonly page: Vec2 }) => {
    const press = p.marquee as NonNullable<Press['marquee']>;
    const { box, mode } = marquee(press.page, e.page);
    ctx.session.marquee.set(box);
    const picked = ctx.elementsIn(box, mode).filter((id) => pickable(ctx, id));
    ctx.session.selection.set(press.shift ? union(press.before, picked) : picked);
  };
  return {
    id: 'brushing',
    onEnter: (ctx, info) => brush(ctx, info as { page: Vec2 }),
    onPointerMove: (ctx, e) => {
      brush(ctx, e);
      return undefined;
    },
    onPointerUp: () => ({ to: 'idle' }),
    onExit: (ctx) => ctx.session.marquee.set(undefined),
    // Esc puts the selection back as it was before the press
    onCancel: (ctx) => {
      ctx.session.selection.set((p.marquee as NonNullable<Press['marquee']>).before);
      return { to: 'idle' };
    },
  };
}

/**
 * The select tool.
 *
 * @public
 */
export function selectTool(): Tool {
  const p: Press = {};
  return {
    id: SELECT_TOOL,
    title: 'Select',
    shortcut: 'v',
    initial: 'idle',
    states: {
      idle: idle(p),
      pointing: pointing(p),
      translating: translating(p),
      brushing: brushing(p),
      // the handle follows the pointer from where it was pressed (a finger presses beside it)
      resizing: transforming(p, 'resizing', (h, e, ctx) => {
        const at = handlePoint(h.box, h.id as HandleId);
        const kept = h.aspect ? { ...e, shift: true } : e;
        const sized = resize(h.box, h.id as HandleId, { x: at.x + e.page.x - h.page.x, y: at.y + e.page.y - h.page.y }, kept);
        return snapped(ctx, h, sized, kept);
      }),
      adjusting: adjusting(p),
      reshaping: reshaping(p),
      tableResizing: tableResizing(p),
      ending: ending(p),
      bending: bending(p),
      // a free turn snaps to the 15 degree steps when near one (shift always does); Alt and Ctrl/Cmd skip it
      rotating: transforming(p, 'rotating', (h, e, ctx) => {
        const turned = rotation(h.box, h.page, e.page, e.shift);
        return { ...h.box, rot: ctx.session.snap.get() && !e.shift ? snapAngle(turned, { bypass: e.alt || e.mod }) : turned };
      }),
    },
  };
}
