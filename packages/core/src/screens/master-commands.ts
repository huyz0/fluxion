// Master editing commands (FR-SCR-005, ADR-0054): make a screen a master or an ordinary screen again, assign a master to a
// screen or take it away, name an element of a master a placeholder, and fill a placeholder on a screen. Each is one
// transaction. The commands never create a state the master rules refuse: a master names no master, an infinite screen is
// neither a master nor given one, and assigning a master gives the screen the master's size. Taking a master or a placeholder
// away clears the `fills` that named its placeholders, so no element is left filling nothing.
import { type AnyRecord, keyBetween, type RecordId, type ScreenRecord, screenKind, screenSize } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';
import { appliedMaster, isMasterScreen, placeholdersOf } from '../masters.js';
import type { ReadView } from '../store.js';
import type { Tx } from '../transaction.js';

type Rec = { readonly [field: string]: unknown };

const rec = (view: ReadView, x: string) => view.get(x as RecordId) as unknown as Rec | undefined;

/** The elements, on any screen, whose `fills` names one of `placeholders`. */
function fillersOf(view: ReadView, placeholders: ReadonlySet<string>): RecordId[] {
  return view.members('byType', 'element').filter((x) => placeholders.has(String(rec(view, x)?.['fills'])));
}

/** In `tx`: every element filling one of `placeholders` fills nothing any more. */
function clearFills(tx: Tx, view: ReadView, placeholders: ReadonlySet<string>): void {
  for (const x of fillersOf(view, placeholders)) tx.patch(x, { fills: undefined });
}

/** The screens naming `master` as their master. */
const namingMaster = (view: ReadView, master: string) => view.members('byType', 'screen').filter((s) => rec(view, s)?.['masterId'] === master);

/** Why the screen `screen` cannot become a master, if it cannot. */
function masterRefusal(screen: ScreenRecord): string | undefined {
  if (screen.masterId !== undefined) return 'a screen with a master cannot be a master: masters apply one level only';
  return screenKind(screen) === 'infinite' ? 'an infinite screen has no frame to draw behind other screens' : undefined;
}

/** Why `master` cannot be the master of `screen`, if it cannot. */
function assignRefusal(screen: ScreenRecord, master: ScreenRecord | undefined): string | undefined {
  if (master === undefined || !isMasterScreen(master)) return 'the master is not a master screen';
  if (isMasterScreen(screen)) return 'a master cannot have a master: masters apply one level only';
  return screenKind(screen) === 'infinite' ? 'an infinite screen has no frame to draw a master behind' : undefined;
}

/** The index that puts a new element on top of the root of `screen`. */
function topIndex(view: ReadView, screen: string): string {
  const last = view
    .members('byScreen', screen as RecordId)
    .map((x) => rec(view, x))
    .filter((r) => r?.['parentId'] === undefined)
    .map((r) => String(r?.['index'] ?? ''))
    .sort()
    .at(-1);
  const key = keyBetween(last ?? null, null);
  return key.ok ? key.value : 'a0';
}

/** The fields of a placeholder that its filler does not copy: it is the screen's own element, not the master's. */
const NOT_COPIED = new Set(['id', 'screenId', 'parentId', 'index', 'placeholder', 'semantic', 'locks']);

/**
 * The master commands (FR-SCR-005).
 *
 * @public
 */
export const MASTER_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'screen.setRole',
    title: title('screen.setRole', 'Make master or ordinary screen'),
    // `master` false: an ordinary screen again; the screens that used it lose it, and their fills of its placeholders
    args: z.object({ id, master: z.boolean() }),
    run: (ctx, args) => {
      const bad = checkIds(ctx, 'screen.setRole', 'screen', [[['id'], args.id]]);
      if (bad) return bad;
      const screen = ctx.store.get(args.id as RecordId) as ScreenRecord;
      const why = args.master ? masterRefusal(screen) : undefined;
      if (why !== undefined) return refuse('screen.setRole', ['id'], why);
      const placeholders = new Set<string>(placeholdersOf(ctx.store, args.id as RecordId));
      return write(ctx, 'screen.setRole', (tx) => {
        tx.patch(args.id as RecordId, { role: args.master ? 'master' : undefined });
        if (args.master) return;
        for (const s of namingMaster(ctx.store, args.id)) tx.patch(s, { masterId: undefined });
        clearFills(tx, ctx.store, placeholders);
      });
    },
  }),
  defineCommand({
    id: 'screen.setMaster',
    title: title('screen.setMaster', 'Set screen master'),
    // `masterId` absent: no master; the screen's fills of the old master's placeholders are cleared. A master given takes its size.
    args: z.object({ id, masterId: id.optional() }),
    run: (ctx, args) => {
      const bad = checkIds(ctx, 'screen.setMaster', 'screen', [[['id'], args.id]]);
      if (bad) return bad;
      const screen = ctx.store.get(args.id as RecordId) as ScreenRecord;
      const master = args.masterId === undefined ? undefined : (ctx.store.get(args.masterId as RecordId) as ScreenRecord | undefined);
      const why = args.masterId === undefined ? undefined : assignRefusal(screen, master?.type === 'screen' ? master : undefined);
      if (why !== undefined) return refuse('screen.setMaster', ['masterId'], why);
      const old = appliedMaster(ctx.store, args.id as RecordId).master ?? screen.masterId;
      const stale = new Set<string>(old === undefined || old === args.masterId ? [] : placeholdersOf(ctx.store, old));
      const onScreen = new Set<string>(ctx.store.members('byScreen', args.id as RecordId));
      return write(ctx, 'screen.setMaster', (tx) => {
        tx.patch(args.id as RecordId, {
          masterId: args.masterId,
          ...(master === undefined ? {} : { kind: undefined, viewport: undefined, size: screenSize(master) }),
        });
        for (const x of fillersOf(ctx.store, stale)) if (onScreen.has(x)) tx.patch(x, { fills: undefined });
      });
    },
  }),
  defineCommand({
    id: 'element.setPlaceholder',
    title: title('element.setPlaceholder', 'Make placeholder'),
    // an element of a master named as a placeholder; `name` absent: an ordinary element again, its fillers cleared
    args: z.object({ id, name: z.string().min(1).optional() }),
    run: (ctx, args) => {
      const bad = checkIds(ctx, 'element.setPlaceholder', 'element', [[['id'], args.id]]);
      if (bad) return bad;
      const screen = rec(ctx.store, String(rec(ctx.store, args.id)?.['screenId']));
      if (!isMasterScreen(screen as never)) return refuse('element.setPlaceholder', ['id'], 'only an element of a master screen is a placeholder');
      return write(ctx, 'element.setPlaceholder', (tx) => {
        tx.patch(args.id as RecordId, { placeholder: args.name });
        if (args.name === undefined) clearFills(tx, ctx.store, new Set([args.id]));
      });
    },
  }),
  defineCommand({
    id: 'element.fillPlaceholder',
    title: title('element.fillPlaceholder', 'Fill placeholder'),
    // a new element `newId` on `screenId` in the placeholder's place: its kind, box, style and text, filling it
    args: z.object({ screenId: id, placeholderId: id, newId: id }),
    run: (ctx, args) => {
      const bad =
        checkIds(ctx, 'element.fillPlaceholder', 'screen', [[['screenId'], args.screenId]]) ??
        checkIds(ctx, 'element.fillPlaceholder', 'element', [[['placeholderId'], args.placeholderId]]) ??
        checkIds(ctx, 'element.fillPlaceholder', 'new', [[['newId'], args.newId]]);
      if (bad) return bad;
      const { master } = appliedMaster(ctx.store, args.screenId as RecordId);
      if (master === undefined || !placeholdersOf(ctx.store, master).includes(args.placeholderId as RecordId))
        return refuse('element.fillPlaceholder', ['placeholderId'], 'not a placeholder of the screen’s master');
      if (fillersOf(ctx.store, new Set([args.placeholderId])).some((x) => rec(ctx.store, x)?.['screenId'] === args.screenId))
        return refuse('element.fillPlaceholder', ['placeholderId'], 'the placeholder is filled on this screen already');
      const placeholder = rec(ctx.store, args.placeholderId) as Rec;
      const copy = Object.fromEntries(Object.entries(placeholder).filter(([k]) => !NOT_COPIED.has(k)));
      const index = topIndex(ctx.store, args.screenId);
      return write(ctx, 'element.fillPlaceholder', (tx) => {
        tx.put({ ...copy, id: args.newId, screenId: args.screenId, index, fills: args.placeholderId } as unknown as AnyRecord);
      });
    },
  }),
];
