// Basic element/asset record writes (FR-EXT-001, NFR-MNT-006).
// Internal composition family; registration order is owned by builtin-commands.
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, fields, id, recordOf, repeated, title, write } from './command-helpers.js';
import { type AnyCommand, defineCommand } from './commands.js';

export const CREATE_ELEMENT: AnyCommand = defineCommand({
  id: 'element.create',
  title: title('element.create', 'Add element'),
  args: z.object({ element: recordOf('element') }),
  run: (ctx, args) =>
    checkIds(ctx, 'element.create', 'new', [[['element', 'id'], args.element.id]]) ?? write(ctx, 'element.create', (tx) => tx.put(args.element as AnyRecord)),
});

export const UPDATE_ELEMENT: AnyCommand = defineCommand({
  id: 'element.update',
  title: title('element.update', 'Change element'),
  args: z.object({ id, fields }),
  run: (ctx, args) =>
    checkIds(ctx, 'element.update', 'element', [[['id'], args.id]]) ?? write(ctx, 'element.update', (tx) => tx.patch(args.id as RecordId, args.fields)),
});

// an asset's record (its bytes are the host's): what a paste of an image makes beside the image element (M7.23)

export const CREATE_ASSET: AnyCommand = defineCommand({
  id: 'asset.create',
  title: title('asset.create', 'Add asset'),
  args: z.object({ asset: recordOf('asset') }),
  run: (ctx, args) =>
    checkIds(ctx, 'asset.create', 'new', [[['asset', 'id'], args.asset.id]]) ?? write(ctx, 'asset.create', (tx) => tx.put(args.asset as AnyRecord)),
});

// the asset manager (FR-AST-005, M10.16): a replaced file changes the record's hash, type and size, the element keeps pointing at the record

export const UPDATE_ASSET: AnyCommand = defineCommand({
  id: 'asset.update',
  title: title('asset.update', 'Change asset'),
  args: z.object({ id, fields }),
  run: (ctx, args) =>
    checkIds(ctx, 'asset.update', 'asset', [[['id'], args.id]]) ?? write(ctx, 'asset.update', (tx) => tx.patch(args.id as RecordId, args.fields)),
});

// an asset still named by an element or screen cannot go: the document would hold a reference to nothing (the transaction refuses it)

export const DELETE_ASSET: AnyCommand = defineCommand({
  id: 'asset.delete',
  title: title('asset.delete', 'Remove assets'),
  args: z.object({ ids: z.array(id).min(1) }),
  run: (ctx, args) =>
    repeated('asset.delete', args.ids, 'ids') ??
    checkIds(
      ctx,
      'asset.delete',
      'asset',
      args.ids.map((x, i) => [['ids', i], x] as const),
    ) ??
    write(ctx, 'asset.delete', (tx) => {
      for (const x of args.ids) tx.delete(x as RecordId);
    }),
});

export const DELETE_ELEMENTS: AnyCommand = defineCommand({
  id: 'element.delete',
  title: title('element.delete', 'Delete elements'),
  args: z.object({ ids: z.array(id).min(1) }),
  run: (ctx, args) =>
    checkIds(
      ctx,
      'element.delete',
      'element',
      args.ids.map((x, i) => [['ids', i], x] as const),
    ) ??
    write(ctx, 'element.delete', (tx) => {
      for (const x of args.ids) tx.delete(x as RecordId);
    }),
});

// several elements in one transaction: what the editor's gestures and tools change at once (a move of
// a selection, a duplicate), one undo step and one diff (ADR-0028 amendment, M6.14)

export const CREATE_ELEMENTS: AnyCommand = defineCommand({
  id: 'element.createMany',
  title: title('element.createMany', 'Add elements'),
  args: z.object({ elements: z.array(recordOf('element')).min(1) }),
  run: (ctx, args) =>
    repeated(
      'element.createMany',
      args.elements.map((e) => e.id),
      'elements',
    ) ??
    checkIds(
      ctx,
      'element.createMany',
      'new',
      args.elements.map((e, i) => [['elements', i, 'id'], e.id] as const),
    ) ??
    write(ctx, 'element.createMany', (tx) => {
      for (const e of args.elements) tx.put(e as AnyRecord);
    }),
});

export const UPDATE_ELEMENTS: AnyCommand = defineCommand({
  id: 'element.updateMany',
  title: title('element.updateMany', 'Change elements'),
  args: z.object({ updates: z.array(z.object({ id, fields })).min(1) }),
  run: (ctx, args) =>
    checkIds(
      ctx,
      'element.updateMany',
      'element',
      args.updates.map((u, i) => [['updates', i, 'id'], u.id] as const),
    ) ??
    write(ctx, 'element.updateMany', (tx) => {
      for (const u of args.updates) tx.patch(u.id as RecordId, u.fields);
    }),
});
