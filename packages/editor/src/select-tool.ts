// The select tool (FR-EDT-003, FR-EDT-004, FR-EDT-005): a click picks the topmost element (shift
// toggles it, and a click inside a multi-selection narrows it); a drag from empty canvas is a marquee;
// a drag from an element moves the selection, alt-drag moves copies of it; arrow keys nudge it 1 px,
// or 10 px with shift; ctrl/cmd + A selects all. A drag is one gesture, so one undo step.
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { duplicates, moved, type Start, starts } from './move.js';
import { beginGesture, type Gesture, type PointerInfo } from './pointer.js';
import { clickSelection, DRAG_PX, marquee, union } from './selection.js';
import { type KeyInfo, SELECT_TOOL, type StateNode, type Tool, type ToolCtx } from './tools.js';

/** The nudge of each arrow key, page units (shift: ten times as far). */
const ARROWS: { readonly [key: string]: Vec2 } = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Nudge the selection by an arrow key (one undo step each); false for any other key or nothing selected. */
function nudge(ctx: ToolCtx, e: KeyInfo): boolean {
  const step = ARROWS[e.key];
  const selected = ctx.session.selection.get();
  if (step === undefined || e.mod || e.alt || selected.length === 0) return false;
  const k = e.shift ? 10 : 1;
  // nothing of its own to move (a bound connector): the command refuses an empty list
  ctx.execute('element.updateMany', { updates: moved(starts(ctx.view, selected), { x: step.x * k, y: step.y * k }) });
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
      return { page, from: starts(ctx.view, copies.ids), gesture, copies: { ids: copies.records.map((r) => r.id), before } };
    }
  }
  return { page, from: starts(ctx.view, before), gesture };
}

/** Move the dragged records to follow the pointer at `page`: one command, once per frame. */
function follow(drag: Drag, page: Vec2): void {
  // nothing of its own to move: the command refuses the empty list, and nothing changes
  drag.gesture.update('element.updateMany', { updates: moved(drag.from, { x: page.x - drag.page.x, y: page.y - drag.page.y }) });
  drag.gesture.commit();
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

function idle(p: Press): StateNode {
  return {
    id: 'idle',
    onPointerMove: (ctx, e) => {
      ctx.session.hover.set(ctx.hitTest(e.page));
      return undefined;
    },
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return undefined;
      pressed(ctx, e, p);
      return { to: 'pointing' };
    },
    onKeyDown: (ctx, e) => {
      if (nudge(ctx, e)) return { to: 'idle' };
      if (!(e.mod && e.key.toLowerCase() === 'a')) return undefined;
      ctx.session.selection.set(ctx.allElements());
      return { to: 'idle' };
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
      follow(p.drag, (info as { page: Vec2 }).page);
    },
    onPointerMove: (_ctx, e) => {
      follow(p.drag as Drag, e.page);
      return undefined;
    },
    onPointerUp: () => ({ to: 'idle' }),
    // Esc undoes the drag in the same gesture: things go back where they started, copies away (the
    // history then drops the step, which changed nothing)
    onCancel: (ctx) => {
      const drag = p.drag as Drag;
      if (drag.copies === undefined) follow(drag, drag.page);
      else {
        // committed as the gesture ends, on leaving this state
        drag.gesture.update('element.delete', { ids: drag.copies.ids });
        ctx.session.selection.set(drag.copies.before);
      }
      return { to: 'idle' };
    },
    // tzap disable next-line BlockStatement: each frame commits at once, and the next gesture's own merge key starts a new undo step anyway
    onExit: () => {
      p.drag?.gesture.end();
      p.drag = undefined;
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
    states: { idle: idle(p), pointing: pointing(p), translating: translating(p), brushing: brushing(p) },
  };
}
