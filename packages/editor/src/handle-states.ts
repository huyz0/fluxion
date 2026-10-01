// The select tool's handle states (FR-SHP-003, FR-CON-007, M7.17-18): a press on a parametric handle of the selected shape
// or on an end or middle handle of the selected connector, and the states that drag them. Each drag is one gesture, so
// one undo step; Esc puts it back. Split from select-tool.ts, whose states they join.
import type { Vec2 } from '@fluxion/geometry';
import type { ConnectorElement, RecordId } from '@fluxion/schema';
import { type ConnectorHandle, connectorHandleAt, connectorHandlesOf, endDrop, handleEdit } from './connector-handles.js';
import { bindable } from './connector-tool.js';
import { HANDLE_PX } from './overlay-geometry.js';
import { paramEdit, paramHandleAt, paramHandlesOf } from './param-handles.js';
import { beginGesture, type Gesture, type PointerInfo } from './pointer.js';
import { DRAG_PX } from './selection.js';
import type { StateNode, ToolCtx } from './tools.js';
import { TOUCH } from './touch.js';

/** What the handle states keep between a press and the drag it starts. */
export type HandlePress = {
  /** A press on a parametric handle of the selected shape. */
  param?: ParamGrab | undefined;
  /** A press on a handle of the selected connector. */
  connector?: ConnectorGrab | undefined;
};

/** A press on a parametric handle of the selected shape: which, and the params it had. */
export type ParamGrab = { readonly id: RecordId; readonly index: number; readonly original: unknown };

/** The parametric handle of the one selected shape under `e`, if any (a finger reaches further). */
export function paramHandleUnder(ctx: ToolCtx, e: PointerInfo): ParamGrab | undefined {
  const [only, ...rest] = ctx.session.selection.get();
  if (only === undefined || rest.length > 0 || ctx.shapeDefs === undefined) return undefined;
  const reach = (e.pointerType === 'touch' ? TOUCH.handlePx : HANDLE_PX) / ctx.session.camera.get().z;
  const hit = paramHandleAt(paramHandlesOf(ctx.view, ctx.shapeDefs, only), e.page, reach);
  return hit === undefined ? undefined : { id: only, index: hit.index, original: (ctx.view.get(only) as { params?: unknown }).params };
}

/** The state that drags a parametric handle: each move sets the param that puts it nearest the pointer, one undo step; Esc puts the params back. */
export function adjusting(p: HandlePress): StateNode {
  let gesture: Gesture | undefined;
  return {
    id: 'adjusting',
    onEnter: (ctx) => {
      gesture = beginGesture(ctx.execute, ctx.seal);
    },
    onPointerMove: (ctx, e) => {
      const grab = p.param as ParamGrab;
      const edit = ctx.shapeDefs === undefined ? undefined : paramEdit(ctx.view, ctx.shapeDefs, grab, e.page);
      if (edit !== undefined) {
        gesture?.update(edit.id, edit.args);
        gesture?.commit();
      }
      return undefined;
    },
    onPointerUp: () => ({ to: 'idle' }),
    onCancel: () => {
      const grab = p.param as ParamGrab;
      gesture?.update('element.update', { id: grab.id, fields: { params: grab.original } });
      gesture?.commit();
      return { to: 'idle' };
    },
    onExit: () => {
      gesture?.end();
      gesture = undefined;
    },
  };
}

/** A press on a handle of the selected connector: which, the route as it was, and the other end. */
export type ConnectorGrab = {
  readonly id: RecordId;
  readonly handle: ConnectorHandle;
  readonly route: ConnectorElement['route'];
  readonly fixed: Vec2 | undefined;
  /** Where the press was, canvas px. */
  readonly down: Vec2;
};

/** The handle of the one selected connector under `e`, if any. */
export function connectorHandleUnder(ctx: ToolCtx, e: PointerInfo): ConnectorGrab | undefined {
  const [only, ...rest] = ctx.session.selection.get();
  if (only === undefined || rest.length > 0 || ctx.route === undefined) return undefined;
  const handles = connectorHandlesOf(ctx.view, ctx.route, only);
  const reach = (e.pointerType === 'touch' ? TOUCH.handlePx : HANDLE_PX) / ctx.session.camera.get().z;
  const hit = connectorHandleAt(handles, e.page, reach);
  if (hit === undefined) return undefined;
  const other = handles.find((h) => h.role === 'end' && h.at !== hit.at);
  return { id: only, handle: hit, route: (ctx.view.get(only) as ConnectorElement).route, fixed: other?.page, down: e.screen };
}

/** The state that drags an end of the selected connector: a line shows where it would land, and the element under it; letting go binds there, one undo step. */
export function ending(p: HandlePress): StateNode {
  const clear = (ctx: ToolCtx) => {
    ctx.session.sketch.set(undefined);
    ctx.session.hover.set(undefined);
  };
  return {
    id: 'ending',
    onPointerMove: (ctx, e) => {
      const grab = p.connector as ConnectorGrab;
      ctx.session.sketch.set(grab.fixed === undefined ? undefined : [grab.fixed, e.page]);
      ctx.session.hover.set(bindable(ctx, ctx.hitTest(e.page)));
      return undefined;
    },
    onPointerUp: (ctx, e) => {
      const grab = p.connector as ConnectorGrab;
      clear(ctx);
      const end = grab.handle.at as 'source' | 'target';
      // a press that did not move is a click on the handle, not a drop: the end keeps its anchor
      const moved = Math.hypot(e.screen.x - grab.down.x, e.screen.y - grab.down.y) >= DRAG_PX;
      const commands =
        ctx.shapeDefs === undefined || !moved
          ? []
          : endDrop(ctx.view, ctx.shapeDefs, { connector: grab.id, end, onto: bindable(ctx, ctx.hitTest(e.page)), at: e.page, newId: ctx.newId });
      const gesture = beginGesture(ctx.execute, ctx.seal);
      for (const c of commands) {
        gesture.update(c.id, c.args);
        gesture.commit();
      }
      gesture.end();
      return { to: 'idle' };
    },
    onCancel: (ctx) => {
      clear(ctx);
      return { to: 'idle' };
    },
  };
}

/** The state that drags the middle of a stretch of the selected connector out into a waypoint: one gesture, Esc puts the route back. */
export function bending(p: HandlePress): StateNode {
  let gesture: Gesture | undefined;
  return {
    id: 'bending',
    onEnter: (ctx) => {
      gesture = beginGesture(ctx.execute, ctx.seal);
    },
    onPointerMove: (_ctx, e) => {
      const grab = p.connector as ConnectorGrab;
      const c = handleEdit(grab.id, grab.route, grab.handle, e.page);
      if (c !== undefined) {
        gesture?.update(c.id, c.args);
        gesture?.commit();
      }
      return undefined;
    },
    onPointerUp: () => ({ to: 'idle' }),
    onCancel: () => {
      const grab = p.connector as ConnectorGrab;
      gesture?.update('element.update', { id: grab.id, fields: { route: grab.route } });
      gesture?.commit();
      return { to: 'idle' };
    },
    onExit: () => {
      gesture?.end();
      gesture = undefined;
    },
  };
}
