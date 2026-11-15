// The select tool's path editing (FR-SHP-011, ADR-0053): while a `core:path` shape is being edited (double-click it, or the
// "Edit path" command), a press on one of its vertices or bezier handles drags it and a press on its outline adds a vertex there
// and drags that; Delete removes the selected vertex and Esc leaves. Each drag, an added vertex with it, is one gesture, so one
// undo step; Esc during a drag puts the path back. Split from select-tool.ts, whose states these join.
import { lockedWithin } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { exitGroup } from './group-edit.js';
import { HANDLE_PX } from './overlay-geometry.js';
import { type PathTarget, pathEdit, pathHandleAt, pathSegmentAt, pathTarget, placedPathHandles, toPathBox } from './path-edit.js';
import { insertPoint, moveHandle, type PathHandle, removePoint } from './path-edit-model.js';
import { beginGesture, type Gesture, type PointerInfo } from './pointer.js';
import { deleteSelection } from './select-actions.js';
import type { StateNode, ToolCtx } from './tools.js';
import { TOUCH } from './touch.js';

/** A press on the edited path: the path as it was, and the handle the drag moves (a vertex just added on a segment, too). */
export type PathGrab = { readonly target: PathTarget; readonly handle: PathHandle; readonly added: boolean };

/** Locks that forbid reshaping: the path is content, and a reshape moves and resizes the box (M19.15). */
const RESHAPE_LOCKS = ['edit', 'size', 'position'] as const;

/** Whether the shape `id`, or a group holding it, is locked against reshaping. */
const reshapeLocked = (ctx: ToolCtx, id: RecordId) => RESHAPE_LOCKS.some((lock) => lockedWithin(ctx.view, id, lock));

/** The path shape being edited, when it is the whole selection and nothing locks it against reshaping. */
export function editedPath(ctx: ToolCtx): PathTarget | undefined {
  const editing = ctx.session.pathEdit.get();
  const [only, ...rest] = ctx.session.selection.get();
  if (editing === undefined || only !== editing.id || rest.length > 0 || reshapeLocked(ctx, only)) return undefined;
  return pathTarget(ctx.view, only);
}

/** Whether a path is being edited and is the whole selection, locked or not (the overlay then hides the frame's handles). */
export function isPathEditing(ctx: ToolCtx): boolean {
  const selection = ctx.session.selection.get();
  return selection.length === 1 && selection[0] === ctx.session.pathEdit.get()?.id;
}

/** Start editing the path shape `id` (selecting it): false when it is no path shape, or locked against reshaping. */
export function enterPathEdit(ctx: ToolCtx, id: RecordId): boolean {
  if (pathTarget(ctx.view, id) === undefined || reshapeLocked(ctx, id)) return false;
  ctx.session.selection.set([id]);
  ctx.session.pathEdit.set({ id });
  return true;
}

/** Start editing the one selected shape's path: false unless exactly one path shape is selected. */
export function editSelectedPath(ctx: ToolCtx): boolean {
  const [only, ...rest] = ctx.session.selection.get();
  return only !== undefined && rest.length === 0 && enterPathEdit(ctx, only);
}

/** Stop editing a path: false when none was being edited (a stale one, its shape no longer selected, is dropped all the same). */
export function leavePathEdit(ctx: ToolCtx): boolean {
  const was = editedPath(ctx) !== undefined;
  ctx.session.pathEdit.set(undefined);
  return was;
}

/** The press `e` on the edited path: a handle under it, else a new vertex on the segment under it; undefined off the path. */
export function pathPressUnder(ctx: ToolCtx, e: PointerInfo): PathGrab | undefined {
  const target = editedPath(ctx);
  if (target === undefined) return undefined;
  const reach = (e.pointerType === 'touch' ? TOUCH.handlePx : HANDLE_PX) / ctx.session.camera.get().z;
  const hit = pathHandleAt(placedPathHandles(target), e.page, reach);
  if (hit !== undefined) return { target, handle: hit.handle, added: false };
  const on = pathSegmentAt(target, e.page, reach);
  if (on === undefined || on.t <= 0 || on.t >= 1) return undefined;
  const model = insertPoint(target.model, on.sub, on.index, on.t);
  return { target: { ...target, model }, handle: { kind: 'vertex', sub: on.sub, index: on.index + 1 }, added: true };
}

/** The state that drags a handle of the edited path: each move refits the path from how it was, one undo step; Esc puts it back. */
export function reshaping(press: { path?: PathGrab | undefined }): StateNode {
  let gesture: Gesture | undefined;
  const run = (c: { readonly id: string; readonly args: unknown } | undefined) => {
    if (c === undefined) return;
    gesture?.update(c.id, c.args);
    gesture?.commit();
  };
  return {
    id: 'reshaping',
    onEnter: (ctx) => {
      gesture = beginGesture(ctx.execute, ctx.seal);
      const grab = press.path as PathGrab;
      const { id } = grab.target.element;
      ctx.session.pathEdit.set({
        id,
        point: grab.handle.kind === 'vertex' ? { sub: grab.handle.sub, index: grab.handle.index } : ctx.session.pathEdit.get()?.point,
      });
      // a vertex added on a segment is there before the pointer moves
      if (grab.added) run(pathEdit(grab.target, grab.target.model));
    },
    onPointerMove: (_ctx, e) => {
      const grab = press.path as PathGrab;
      const to = toPathBox(grab.target, e.page);
      if (to !== undefined) run(pathEdit(grab.target, moveHandle(grab.target.model, grab.handle, to)));
      return undefined;
    },
    onPointerUp: () => ({ to: 'idle' }),
    onCancel: () => {
      const { element } = (press.path as PathGrab).target;
      run({ id: 'element.update', args: { id: element.id, fields: { path: element.path, transform: element.transform } } });
      return { to: 'idle' };
    },
    onExit: () => {
      gesture?.end();
      gesture = undefined;
    },
  };
}

/** Delete while a path is edited: remove its selected vertex, one undo step; false when no path is being edited. */
export function removeSelectedPoint(ctx: ToolCtx): boolean {
  const target = editedPath(ctx);
  if (target === undefined) return false;
  // a Delete while editing a path never deletes the shape
  const point = ctx.session.pathEdit.get()?.point;
  if (point === undefined) return true;
  const model = removePoint(target.model, point.sub, point.index);
  const edit = model === undefined ? undefined : pathEdit(target, model);
  if (edit !== undefined) ctx.execute(edit.id, edit.args);
  ctx.session.pathEdit.set({ id: target.element.id });
  return true;
}

/** Esc between gestures: leave the path being edited, else the group entered; false when neither. */
export function leaveEditing(ctx: ToolCtx): boolean {
  return leavePathEdit(ctx) || exitGroup(ctx);
}

/** Delete: the selected vertex of the path being edited, else the selection. */
export function deleteSelected(ctx: ToolCtx): boolean {
  return removeSelectedPoint(ctx) || deleteSelection(ctx);
}
