// The boolean operation command (FR-SHP-010, ADR-0053): the operands, siblings on one screen, become one `core:path` shape in a
// single transaction (one undo step). The caller computes the result path (geometry's `booleanPaths` over the operands' outlines,
// which only it can resolve: a command sees the store, not the shape definitions) and names the new record. The result takes the
// bottom-most operand's place in the sibling order, its container and style; each connector bound to an operand moves to the
// result when that anchor's place on screen still lies on the result's outline (at the same anchor when it reads to the same place
// in the result's box, else at a point anchor there, so the connector does not move), else at `auto`. A lock against deleting or
// editing any operand refuses the operation.
import { apply, type ElementTransform, elementMatrix, nearestPoint } from '@fluxion/geometry';
import { type AnchorRef, type AnyRecord, compareKeys, pathDataSchema, type RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { lockedWithin } from '../arrange/locks.js';
import { type El, element } from '../arrange/siblings.js';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';
import { CORE_PATH_ID, type OwnPath, ownPath } from './path-shape.js';
import { DEFAULT_ANCHOR_DEFS, fractionOf } from './replace.js';

const COMMAND = 'shape.boolean';
const SIDE_AT = {
  n: (t: number) => ({ x: t, y: 0 }),
  e: (t: number) => ({ x: 1, y: t }),
  s: (t: number) => ({ x: t, y: 1 }),
  w: (t: number) => ({ x: 0, y: t }),
} as const;

type Fraction = { readonly x: number; readonly y: number };

/** Where each anchor kind sits in a path shape's box as fractions; none for one with no place of its own. */
const PLACE: { readonly [K in AnchorRef['kind']]: (ref: Extract<AnchorRef, { kind: K }>) => Fraction | 'stays' | undefined } = {
  floating: () => 'stays',
  auto: () => 'stays',
  side: (ref) => SIDE_AT[ref.side](ref.t ?? 0.5),
  point: (ref) => ({ x: ref.x, y: ref.y }),
  named: (ref) => {
    const def = DEFAULT_ANCHOR_DEFS.find((a) => a.name === ref.name);
    return def === undefined ? undefined : fractionOf(def);
  },
};

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * The anchor a binding at `ref` on an operand placed at `from` keeps on the result `own` placed at `box`: auto when the anchor's
 * place on screen is off the result's outline, else the same anchor when it reads to that place in the result's box, else a point
 * anchor at that place.
 */
function keptAnchor(ref: AnchorRef, from: ElementTransform, own: OwnPath, box: Box): AnchorRef {
  const at = (PLACE[ref.kind] as (r: AnchorRef) => Fraction | 'stays' | undefined)(ref);
  if (at === 'stays') return ref;
  if (at === undefined) return { kind: 'auto' };
  const screen = apply(elementMatrix(from), { x: at.x * from.w, y: at.y * from.h });
  const p = { x: screen.x - box.x, y: screen.y - box.y };
  // within half a pixel, or 0.5 % of the result's size
  const tolerance = Math.max(0.5, 0.005 * Math.max(box.w, box.h));
  const near = own.paths.some((path) => (nearestPoint(path, p)?.distance ?? Number.POSITIVE_INFINITY) <= tolerance);
  if (!near) return { kind: 'auto' };
  const [dx, dy] = [at.x * box.w - p.x, at.y * box.h - p.y];
  if (dx * dx + dy * dy <= tolerance * tolerance) return ref;
  const unit = (v: number) => Math.min(1, Math.max(0, v));
  return { kind: 'point', x: unit(p.x / box.w), y: unit(p.y / box.h) };
}

type Binding = { readonly id: RecordId; readonly type?: unknown; readonly elementId?: unknown; readonly anchor: AnchorRef };

/** Fields of the bottom operand that belong to its definition or its content, not to the path shape made from it. */
const DROPPED = ['params', 'anchors', 'text', 'texts', 'icons', 'textFit', 'locks', 'name', 'path'] as const;

/** The boolean operation command. */
export const BOOLEAN_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: COMMAND,
    title: title(COMMAND, 'Combine shapes'),
    // op names the operation for the history; path and box are its result, in the operands' screen frame
    args: z.object({
      ids: z.array(id).min(2),
      resultId: id,
      op: z.enum(['union', 'subtract', 'intersect', 'exclude']),
      path: pathDataSchema,
      box: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
    }),
    run: (ctx, args) => {
      const bad =
        checkIds(
          ctx,
          COMMAND,
          'element',
          args.ids.map((x, i) => [['ids', i], x] as const),
        ) ?? checkIds(ctx, COMMAND, 'new', [[['resultId'], args.resultId]]);
      if (bad) return bad;
      if (new Set(args.ids).size !== args.ids.length) return refuse(COMMAND, ['ids'], 'a shape is listed twice');
      const operands = args.ids.map((x) => element(ctx, x));
      const first = operands[0] as El;
      const notShape = operands.findIndex((o) => o.kind !== 'shape');
      if (notShape >= 0) return refuse(COMMAND, ['ids', notShape], `"${args.ids[notShape]}" is not a shape`);
      if (operands.some((o) => o.screenId !== first.screenId || o.parentId !== first.parentId))
        return refuse(COMMAND, ['ids'], 'the shapes are not siblings (one screen, one parent)');
      const locked = operands.findIndex((o) => lockedWithin(ctx.store, o.id, 'delete') || lockedWithin(ctx.store, o.id, 'edit'));
      if (locked >= 0) return refuse(COMMAND, ['ids', locked], `"${args.ids[locked]}" is locked`);
      const own = ownPath(args.path, { w: args.box.w, h: args.box.h });
      if (own === undefined) return refuse(COMMAND, ['path'], 'the result path does not read');
      const bottom = [...operands].sort((a, b) => compareKeys(a.index, b.index))[0] as El;
      const base: Record<string, unknown> = { ...(ctx.store.get(bottom.id) as unknown as Record<string, unknown>) };
      for (const key of DROPPED) delete base[key];
      const result = { ...base, id: args.resultId, defId: CORE_PATH_ID, path: args.path, transform: { ...args.box, rot: 0 } };
      const moved = args.ids.flatMap((x) => {
        const t = (ctx.store.get(x as RecordId) as unknown as { transform: ElementTransform & { rot?: number } }).transform;
        const from: ElementTransform = { ...t, rot: t.rot ?? 0 };
        return ctx.store
          .members('bindingsByElement', x)
          .map((b) => ctx.store.get(b) as unknown as Binding)
          .filter((b) => b.type === 'binding' && b.elementId === x)
          .map((b) => ({ b, from }));
      });
      return write(ctx, COMMAND, (tx) => {
        tx.put(result as unknown as AnyRecord);
        for (const { b, from } of moved) tx.patch(b.id, { elementId: args.resultId, anchor: keptAnchor(b.anchor, from, own, args.box) });
        for (const o of operands) tx.delete(o.id);
      });
    },
  }),
];
