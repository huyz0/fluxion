// The select tool (FR-EDT-003, FR-EDT-004, FR-EDT-005): a click picks the topmost element (shift
// toggles it, and a click inside a multi-selection narrows it); a drag from empty canvas is a marquee;
// a drag from an element moves the selection, alt-drag moves copies of it. The keys (arrows nudge,
// ctrl/cmd + A selects all, Delete deletes) are keymap bindings whose commands call the functions
// here while the tool is idle (M7.4). A drag is one gesture, so one undo step.
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { adjusting, bending, type ConnectorGrab, connectorHandleUnder, ending, type ParamGrab, paramHandleUnder } from './handle-states.js';
import { duplicates, moved, reframed, type Start, starts } from './move.js';
import { frameBox, HANDLE_PX, type HandleId, handleAt, type Placed, selectionFrame } from './overlay-geometry.js';
import { beginGesture, type Gesture, type PointerInfo } from './pointer.js';
import { clickSelection, DRAG_PX, marquee, union } from './selection.js';
import { snapBox } from './snap/snap.js';
import { boundsOf, snapScreen, snapTargets } from './snap/targets.js';
import { SELECT_TOOL, type StateNode, type Tool, type ToolCtx } from './tools.js';
import { TOUCH } from './touch.js';
import { type Box2, handlePoint, resize, rotation } from './transform.js';

/**
 * Nudge the selection by `d` page units, one undo step; false with nothing selected.
 *
 * @public
 */
export function nudgeSelection(ctx: ToolCtx, d: Vec2): boolean {
  const selected = ctx.session.selection.get();
  if (selected.length === 0) return false;
  // nothing of its own to move (a bound connector): the command refuses an empty list
  ctx.execute('element.updateMany', { updates: moved(starts(ctx.view, selected), d) });
  return true;
}

/**
 * Select every selectable element of the canvas's screen.
 *
 * @public
 */
export function selectAll(ctx: ToolCtx): void {
  ctx.session.selection.set(ctx.allElements());
}

/**
 * Delete the selection, one undo step, and select nothing; false with nothing selected.
 *
 * @public
 */
export function deleteSelection(ctx: ToolCtx): boolean {
  const ids = ctx.session.selection.get();
  if (ids.length === 0) return false;
  ctx.execute('element.delete', { ids });
  ctx.session.selection.set([]);
  return true;
}

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
  return { page, from: starts(ctx.view, before), gesture, ...snapping(ctx, before) };
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
    });
    d = { x: d.x + hit.dx, y: d.y + hit.dy };
    ctx.session.guides.set(hit.guides);
  }
  // nothing of its own to move: the command refuses the empty list, and nothing changes
  drag.gesture.update('element.updateMany', { updates: moved(drag.from, d) });
  drag.gesture.commit();
}

/** Whether the pointer `e` skips snapping: Alt after the press (one that made copies is a duplicate, not a bypass) or Ctrl/Cmd. */
const skipsSnap = (e: PointerInfo, drag: Drag): boolean => e.mod || (e.alt && drag.copies === undefined);

/** A press on a handle of the selection frame: which, the frame and what is in it as they started. */
type Handle = { readonly id: HandleId | 'rotate'; readonly box: Box2; readonly page: Vec2; readonly from: readonly Start[] };

/** The handle of the selection's frame under canvas point `e.screen`, if any. */
function handleUnder(ctx: ToolCtx, e: PointerInfo): Handle | undefined {
  const selected = ctx.session.selection.get();
  const placed = selected.map((id) => (ctx.view.get(id) as { transform?: Placed } | undefined)?.transform).filter((t): t is Placed => t !== undefined);
  // a finger reaches a handle further than a mouse (FR-EDT-019)
  const id = handleAt(selectionFrame(placed, ctx.session.camera.get()), e.screen, e.pointerType === 'touch' ? TOUCH.handlePx : HANDLE_PX);
  const box = frameBox(placed);
  return id === undefined || box === undefined ? undefined : { id, box, page: e.page, from: starts(ctx.view, selected) };
}

/**
 * The state that drags a handle: each move sets the frame `after(handle, e)` and carries what is in it
 * along, one command a frame; the whole drag is one undo step; Esc puts it all back.
 */
function transforming(p: Press, id: string, after: (h: Handle, e: PointerInfo) => Box2): StateNode {
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
    onPointerMove: (_ctx, e) => {
      const h = p.handle as Handle;
      set(h, after(h, e));
      return undefined;
    },
    onPointerUp: () => ({ to: 'idle' }),
    onCancel: () => {
      const h = p.handle as Handle;
      set(h, h.box);
      return { to: 'idle' };
    },
    // tzap disable next-line BlockStatement: each frame commits at once, and the next gesture's own merge key starts a new undo step anyway
    onExit: () => {
      gesture?.end();
      gesture = undefined;
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
};

/**
 * A primary press at `e`: select what it hits (a press on a selected element keeps the selection,
 * for a drag; released without one, it narrows the selection, or with shift takes the element out),
 * and note what a drag from here would do.
 */
function pressed(ctx: ToolCtx, e: PointerInfo, p: Press): void {
  const hit = ctx.hitTest(e.page);
  const before = ctx.session.selection.get();
  const kept = hit !== undefined && before.includes(hit);
  if (!kept) ctx.session.selection.set(clickSelection(before, hit, e.shift));
  p.narrow = kept && !e.shift ? hit : undefined;
  p.toggle = kept && e.shift ? hit : undefined;
  p.marquee = hit === undefined ? { screen: e.screen, page: e.page, shift: e.shift, before } : undefined;
  // read only when the press was on an element (the marquee is decided first)
  p.grab = { screen: e.screen, page: e.page, alt: e.alt };
}

/** A press on a handle of the selection: the state it starts, and what the states after it need, in `p`. */
function handlePress(ctx: ToolCtx, e: PointerInfo, p: Press): string | undefined {
  p.param = paramHandleUnder(ctx, e);
  if (p.param !== undefined) return 'adjusting';
  p.connector = connectorHandleUnder(ctx, e);
  if (p.connector !== undefined) return p.connector.handle.role === 'end' ? 'ending' : 'bending';
  p.handle = handleUnder(ctx, e);
  return p.handle === undefined ? undefined : p.handle.id === 'rotate' ? 'rotating' : 'resizing';
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
    onPointerUp: () => ({ to: 'idle' }),
    // Esc undoes the drag in the same gesture: things go back where they started, copies away (the
    // history then drops the step, which changed nothing)
    onCancel: (ctx) => {
      const drag = p.drag as Drag;
      if (drag.copies === undefined) follow(ctx, drag, drag.page, true);
      else {
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
    },
  };
}

function brushing(p: Press): StateNode {
  /** The marquee from the press to `e`, and what it selects (added to the old selection with shift). */
  const brush = (ctx: ToolCtx, e: { readonly page: Vec2 }) => {
    const press = p.marquee as NonNullable<Press['marquee']>;
    const { box, mode } = marquee(press.page, e.page);
    ctx.session.marquee.set(box);
    const picked = ctx.elementsIn(box, mode);
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
      resizing: transforming(p, 'resizing', (h, e) => {
        const at = handlePoint(h.box, h.id as HandleId);
        return resize(h.box, h.id as HandleId, { x: at.x + e.page.x - h.page.x, y: at.y + e.page.y - h.page.y }, e);
      }),
      adjusting: adjusting(p),
      ending: ending(p),
      bending: bending(p),
      rotating: transforming(p, 'rotating', (h, e) => ({ ...h.box, rot: rotation(h.box, h.page, e.page, e.shift) })),
    },
  };
}
