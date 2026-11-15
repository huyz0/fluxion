// Editing masters from the canvas (FR-SCR-005, ADR-0054): name the selected element of a master a placeholder (or an ordinary
// element again), fill a placeholder hint on a screen by double-clicking it, and open the shown screen's master to edit it and
// go back. Each write is one master command, so one undo step; opening and closing a master only switches the shown screen.
import { appliedMaster, dependentsOf, isMasterScreen, masterLayers } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import { presentationOrder, screensInOrder } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { switchScreen } from './screen-switch.js';
import type { Session } from './session.js';
import type { ToolCtx } from './tools.js';

type Placed = { readonly name?: unknown; readonly placeholder?: unknown; readonly transform?: { x: number; y: number; w: number; h: number } };

const placed = (ctx: ToolCtx, id: RecordId) => ctx.view.get(id) as Placed | undefined;

/** The one selected element, when the shown screen is a master. */
function selectedOnMaster(ctx: ToolCtx): RecordId | undefined {
  const selection = ctx.session.selection.get();
  const screen = ctx.screen === undefined ? undefined : ctx.view.get(ctx.screen);
  return selection.length === 1 && isMasterScreen(screen as never) ? selection[0] : undefined;
}

/** Name the one selected element of a master a placeholder, by its name (else "Placeholder"); false when there is none to name. */
export function makePlaceholder(ctx: ToolCtx): boolean {
  const id = selectedOnMaster(ctx);
  if (id === undefined || typeof placed(ctx, id)?.placeholder === 'string') return false;
  const name = placed(ctx, id)?.name;
  return ctx.execute('element.setPlaceholder', { id, name: typeof name === 'string' && name.trim() !== '' ? name : 'Placeholder' }).ok;
}

/** Make the one selected placeholder of a master an ordinary element again (its fillers fill nothing); false when it is none. */
export function clearPlaceholder(ctx: ToolCtx): boolean {
  const id = selectedOnMaster(ctx);
  if (id === undefined || typeof placed(ctx, id)?.placeholder !== 'string') return false;
  return ctx.execute('element.setPlaceholder', { id }).ok;
}

/** The unfilled placeholder hint of the shown screen's master under page point `at`, topmost first. */
function hintAt(ctx: ToolCtx, at: Vec2): RecordId | undefined {
  const layers = ctx.screen === undefined ? undefined : masterLayers(ctx.view, ctx.screen);
  const inside = (id: RecordId) => {
    const b = placed(ctx, id)?.transform;
    return b !== undefined && at.x >= b.x && at.y >= b.y && at.x <= b.x + b.w && at.y <= b.y + b.h;
  };
  return [...(layers?.unfilled ?? [])].reverse().find(inside);
}

/** Fill the placeholder hint under `at` on the shown screen and select the new element; false when no hint is there. */
export function fillAt(ctx: ToolCtx, at: Vec2): boolean {
  const placeholderId = hintAt(ctx, at);
  if (placeholderId === undefined || ctx.screen === undefined) return false;
  const newId = ctx.newId();
  if (!ctx.execute('element.fillPlaceholder', { screenId: ctx.screen, placeholderId, newId }).ok) return false;
  ctx.session.selection.set([newId]);
  return true;
}

/** The screen each session's open master was opened from (Edit master), to go back to on Close master. */
const openedFrom = new WeakMap<Session, { readonly master: RecordId; readonly from: RecordId }>();

/** Show the master of the shown screen, to edit it; false when its master does not apply. */
export function openMaster(ctx: ToolCtx): boolean {
  const master = ctx.screen === undefined ? undefined : appliedMaster(ctx.view, ctx.screen).master;
  if (master === undefined || ctx.screen === undefined) return false;
  openedFrom.set(ctx.session, { master, from: ctx.screen });
  switchScreen(ctx.session, master);
  return true;
}

/**
 * Leave the shown master: show the screen Edit master was run from while it still uses the master, else the first screen in
 * navigator order using it, else the first screen; false when the shown screen is no master.
 */
export function closeMaster(ctx: ToolCtx): boolean {
  const screen = ctx.screen;
  if (screen === undefined || !isMasterScreen(ctx.view.get(screen) as never)) return false;
  const opened = openedFrom.get(ctx.session);
  const uses = (id: RecordId) => appliedMaster(ctx.view, id).master === screen;
  const from = opened?.master === screen && uses(opened.from) ? opened.from : undefined;
  const dependents = new Set(dependentsOf(ctx.view, screen));
  const back = from ?? presentationOrder(ctx.view, true).find((id) => dependents.has(id)) ?? screensInOrder(ctx.view, true)[0];
  if (back === undefined) return false;
  openedFrom.delete(ctx.session);
  switchScreen(ctx.session, back);
  return true;
}

/**
 * Whether a menu offers the line `command` here: a master line only where it acts (the placeholder lines on one selected element of a
 * shown master, Edit master on a screen whose master applies, Close master on a master); any other line always.
 *
 * @public
 */
export function offersMasterLine(ctx: ToolCtx, command: string): boolean {
  const screen = ctx.screen === undefined ? undefined : ctx.view.get(ctx.screen);
  const id = selectedOnMaster(ctx);
  const named = id !== undefined && typeof placed(ctx, id)?.placeholder === 'string';
  const offers: { readonly [command: string]: () => boolean } = {
    'master.makePlaceholder': () => id !== undefined && !named,
    'master.clearPlaceholder': () => named,
    'master.edit': () => ctx.screen !== undefined && appliedMaster(ctx.view, ctx.screen).master !== undefined,
    'master.close': () => isMasterScreen(screen as never),
  };
  return offers[command]?.() ?? true;
}

/**
 * The master commands of the canvas: id, title, and what each does to the tool context (run between gestures of the select tool).
 *
 * @public
 */
export const MASTER_ACTIONS: readonly (readonly [id: string, title: string, act: (ctx: ToolCtx) => boolean])[] = [
  ['master.makePlaceholder', 'Make placeholder', makePlaceholder],
  ['master.clearPlaceholder', 'Make ordinary element', clearPlaceholder],
  ['master.edit', 'Edit master', openMaster],
  ['master.close', 'Close master', closeMaster],
];
