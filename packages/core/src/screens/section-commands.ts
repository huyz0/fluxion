// Section commands (FR-SCR-004, M8.15, ADR-0021): sections are records ordered by `index`; screens name one with
// `sectionId`. Deleting a section lets its screens go in the same transaction (a screen naming nothing is valid, a
// screen naming a missing section is not).
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';
import { indexAfter } from './screen-order.js';

/** The section commands (FR-SCR-004). */
export const SECTION_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'section.create',
    title: title('section.create', 'Add section'),
    // `after`: the section it follows; absent -> first
    args: z.object({ id, name: z.string(), after: id.optional() }),
    run: (ctx, args) => {
      const bad =
        checkIds(ctx, 'section.create', 'new', [[['id'], args.id]]) ??
        (args.after === undefined ? null : checkIds(ctx, 'section.create', 'section', [[['after'], args.after]]));
      if (bad) return bad;
      const index = indexAfter(ctx, 'section.create', { type: 'section', id: args.id, after: args.after });
      if (!index.ok) return index;
      return write(ctx, 'section.create', (tx) => tx.put({ id: args.id, type: 'section', name: args.name, index: index.value } as unknown as AnyRecord));
    },
  }),
  defineCommand({
    id: 'section.rename',
    title: title('section.rename', 'Rename section'),
    args: z.object({ id, name: z.string() }),
    run: (ctx, args) =>
      checkIds(ctx, 'section.rename', 'section', [[['id'], args.id]]) ??
      write(ctx, 'section.rename', (tx) => tx.patch(args.id as RecordId, { name: args.name })),
  }),
  defineCommand({
    id: 'section.setCollapsed',
    title: title('section.setCollapsed', 'Fold or unfold section'),
    // unfolded removes the mark rather than writing false
    args: z.object({ id, collapsed: z.boolean() }),
    run: (ctx, args) =>
      checkIds(ctx, 'section.setCollapsed', 'section', [[['id'], args.id]]) ??
      write(ctx, 'section.setCollapsed', (tx) => tx.patch(args.id as RecordId, { collapsed: args.collapsed ? true : undefined })),
  }),
  defineCommand({
    id: 'section.reorder',
    title: title('section.reorder', 'Move section'),
    // only the moved section changes (FR-DOC-010)
    args: z.object({ id, after: id.optional() }),
    run: (ctx, args) => {
      const refs: Array<readonly [ReadonlyArray<string>, string]> = [[['id'], args.id]];
      if (args.after !== undefined) refs.push([['after'], args.after]);
      const bad = checkIds(ctx, 'section.reorder', 'section', refs);
      if (bad) return bad;
      const index = indexAfter(ctx, 'section.reorder', { type: 'section', id: args.id, after: args.after });
      if (!index.ok) return index;
      return write(ctx, 'section.reorder', (tx) => tx.patch(args.id as RecordId, { index: index.value }));
    },
  }),
  defineCommand({
    id: 'section.delete',
    title: title('section.delete', 'Delete section'),
    args: z.object({ id }),
    run: (ctx, args) => {
      const bad = checkIds(ctx, 'section.delete', 'section', [[['id'], args.id]]);
      if (bad) return bad;
      const screens = ctx.store.members('byType', 'screen').filter((s) => (ctx.store.get(s) as { sectionId?: unknown } | undefined)?.sectionId === args.id);
      return write(ctx, 'section.delete', (tx) => {
        for (const s of screens) tx.patch(s, { sectionId: undefined });
        tx.delete(args.id as RecordId);
      });
    },
  }),
  defineCommand({
    id: 'screen.setSection',
    title: title('screen.setSection', 'Move screen to section'),
    // `sectionId` absent: the screen belongs to no section
    args: z.object({ id, sectionId: id.optional() }),
    run: (ctx, args) => {
      const bad =
        checkIds(ctx, 'screen.setSection', 'screen', [[['id'], args.id]]) ??
        (args.sectionId === undefined ? null : checkIds(ctx, 'screen.setSection', 'section', [[['sectionId'], args.sectionId]]));
      if (bad) return bad;
      return write(ctx, 'screen.setSection', (tx) => tx.patch(args.id as RecordId, { sectionId: args.sectionId }));
    },
  }),
];
