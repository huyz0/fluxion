// Screen commands beyond create, delete and reorder (FR-SCR-002, M8.11): rename, hide, and duplicate. A duplicate is
// one transaction: a new screen just after the original with a copy of every element and binding on it, under ids the
// caller supplies (core draws no randomness), the bindings pointing at the copies. Timelines, steps and interactions
// are the animation milestone's to copy; they name their targets inside open payloads.
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';
import { screenIndexAfter } from './screen-order.js';

type Rec = { readonly [field: string]: unknown };

/** `r` without the semantic slug that names one element only (a copy is unnamed until renamed). */
function withoutSlug(r: Rec): Rec {
  const semantic = r['semantic'] as { readonly slug?: unknown } | undefined;
  if (semantic?.slug === undefined) return r;
  const { slug: _, ...rest } = semantic;
  const { semantic: __, ...copy } = r;
  return Object.keys(rest).length === 0 ? copy : { ...copy, semantic: rest };
}

/** The screen commands (FR-SCR-002). */
export const SCREEN_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'screen.rename',
    title: title('screen.rename', 'Rename screen'),
    args: z.object({ id, name: z.string() }),
    run: (ctx, args) =>
      checkIds(ctx, 'screen.rename', 'screen', [[['id'], args.id]]) ?? write(ctx, 'screen.rename', (tx) => tx.patch(args.id as RecordId, { name: args.name })),
  }),
  defineCommand({
    id: 'screen.setHidden',
    title: title('screen.setHidden', 'Hide or show screen'),
    // a hidden screen is skipped in presentation; showing it removes the mark rather than writing false
    args: z.object({ id, hidden: z.boolean() }),
    run: (ctx, args) =>
      checkIds(ctx, 'screen.setHidden', 'screen', [[['id'], args.id]]) ??
      write(ctx, 'screen.setHidden', (tx) => tx.patch(args.id as RecordId, { hidden: args.hidden ? true : undefined })),
  }),
  defineCommand({
    id: 'screen.duplicate',
    title: title('screen.duplicate', 'Duplicate screen'),
    // `ids`: a new id for every element and binding of the screen, by old id
    args: z.object({ id, newId: id, ids: z.record(z.string(), id) }),
    run: (ctx, args) => {
      const bad = checkIds(ctx, 'screen.duplicate', 'screen', [[['id'], args.id]]) ?? checkIds(ctx, 'screen.duplicate', 'new', [[['newId'], args.newId]]);
      if (bad) return bad;
      const elements = ctx.store.members('byScreen', args.id);
      const onScreen = new Set<string>(elements);
      const bindings = [...new Set(elements.flatMap((e) => ctx.store.members('bindingsByElement', e)))].filter((b) => {
        const r = ctx.store.get(b) as Rec | undefined;
        return onScreen.has(String(r?.['connectorId'])) && onScreen.has(String(r?.['elementId']));
      });
      const copied = [...elements, ...bindings];
      const missing = copied.find((x) => args.ids[x] === undefined);
      if (missing !== undefined) return refuse('screen.duplicate', ['ids'], `no new id for "${missing}"`);
      const fresh = [args.newId, ...copied.map((x) => args.ids[x] as string)];
      if (new Set(fresh).size !== fresh.length) return refuse('screen.duplicate', ['ids'], 'a new id is used twice');
      const taken = checkIds(
        ctx,
        'screen.duplicate',
        'new',
        copied.map((x) => [['ids', x], args.ids[x] as string] as const),
      );
      if (taken) return taken;
      const index = screenIndexAfter(ctx, 'screen.duplicate', args.newId, args.id);
      if (!index.ok) return index;
      const original = ctx.store.get(args.id as RecordId) as unknown as Rec;
      const name = typeof original['name'] === 'string' ? { name: `${original['name']} copy` } : {};
      const to = (x: unknown): string => args.ids[String(x)] ?? String(x);
      return write(ctx, 'screen.duplicate', (tx) => {
        tx.put({ ...original, ...name, id: args.newId, index: index.value } as unknown as AnyRecord);
        for (const e of elements) {
          const r = ctx.store.get(e) as unknown as Rec;
          const parent = r['parentId'] === undefined ? {} : { parentId: to(r['parentId']) };
          tx.put({ ...withoutSlug(r), id: to(e), screenId: args.newId, ...parent } as unknown as AnyRecord);
        }
        for (const b of bindings) {
          const r = ctx.store.get(b) as unknown as Rec;
          tx.put({ ...r, id: to(b), connectorId: to(r['connectorId']), elementId: to(r['elementId']) } as unknown as AnyRecord);
        }
      });
    },
  }),
];
