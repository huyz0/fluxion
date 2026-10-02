// Grouping in the editor (FR-ARR-001, M8.5): the selection grouped and ungrouped as one undo step each, a group
// entered to edit its members and left again. Pure over the tool context; the keymap, the palette and the menus
// call these.
import type { ReadView } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import type { ToolCtx } from './tools.js';

type Rec = { readonly kind?: unknown; readonly parentId?: RecordId };

const record = (view: ReadView, id: RecordId) => view.get(id) as Rec | undefined;
const isGroup = (view: ReadView, id: RecordId) => record(view, id)?.kind === 'group';

/**
 * Group the selection (siblings of one screen and parent): the new group is selected. False when nothing is
 * selected or the document refuses (not siblings, nothing with a box).
 *
 * @public
 */
export function groupSelection(ctx: ToolCtx): boolean {
  const ids = ctx.session.selection.get();
  if (ids.length === 0) return false;
  const groupId = ctx.newId();
  if (!ctx.execute('element.group', { ids, groupId }).ok) return false;
  ctx.session.selection.set([groupId]);
  return true;
}

/**
 * Ungroup the selected groups, one level: their members are selected. False when the selection holds no group
 * or the document refuses (a group together with one inside it).
 *
 * @public
 */
export function ungroupSelection(ctx: ToolCtx): boolean {
  const groups = ctx.session.selection.get().filter((id) => isGroup(ctx.view, id));
  if (groups.length === 0) return false;
  const members = groups.flatMap((g) => ctx.view.members('byParent', g));
  if (!ctx.execute('element.ungroup', { ids: groups }).ok) return false;
  ctx.session.selection.set(members);
  return true;
}

/**
 * Enter the group `group` to edit its members: a click now picks within it, and the member under page point `at`
 * (if any) is selected. False when `group` is no group.
 *
 * @public
 */
export function enterGroup(ctx: ToolCtx, group: RecordId, at: Vec2): boolean {
  if (!isGroup(ctx.view, group)) return false;
  ctx.session.entered.set(group);
  const member = ctx.hitTest(at);
  ctx.session.selection.set([member !== undefined && member !== group ? member : group]);
  return true;
}

/**
 * Leave the entered group, one level: it is selected, and the group it sits in (if it sits in one) stays entered.
 * False when none is entered.
 *
 * @public
 */
export function exitGroup(ctx: ToolCtx): boolean {
  const entered = ctx.session.entered.get();
  if (entered === undefined) return false;
  const parent = record(ctx.view, entered)?.parentId;
  ctx.session.entered.set(parent !== undefined && isGroup(ctx.view, parent) ? parent : undefined);
  ctx.session.selection.set(ctx.view.get(entered) === undefined ? [] : [entered]);
  return true;
}

/**
 * Whether `entered` is still a group the selection is in: the group exists and every selected element sits inside
 * it (at any depth). With nothing selected the entry lapses with the selection; a click elsewhere leaves it.
 *
 * @public
 */
export function enteredHolds(view: ReadView, entered: RecordId, selection: readonly RecordId[]): boolean {
  if (!isGroup(view, entered) || selection.length === 0) return false;
  const inside = (id: RecordId) => {
    for (let p = record(view, id)?.parentId; p !== undefined; p = record(view, p)?.parentId) if (p === entered) return true;
    return false;
  };
  return selection.every(inside);
}
