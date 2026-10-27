// Replace shape (FR-LIB-011): swap a shape's definition in one transaction, keeping its box, text,
// style tokens and connections. The caller resolves both definitions (a command sees only the store),
// so the old and new definitions' anchors come in the arguments. A binding to a named anchor keeps its
// name when the new definition has it, else moves to the new anchor nearest the old one's box
// position; side, point, auto and floating anchors are box fractions and stay as they are. The old
// definition's params and the instance's own anchors belong to the old outline and are dropped.
import { type AnchorDef, type AnchorRef, anchorDefSchema, qualifiedNameSchema, type RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';

/**
 * The anchors every shape has unless its instance or definition names its own: the side midpoints
 * `n`, `e`, `s`, `w` (pointing outward) and `center` (routing's `DEFAULT_ANCHORS`).
 *
 * @public
 */
export const DEFAULT_ANCHOR_DEFS: readonly AnchorDef[] = [
  { name: 'n', x: 0.5, y: 0, dir: { x: 0, y: -1 } },
  { name: 'e', x: 1, y: 0.5, dir: { x: 1, y: 0 } },
  { name: 's', x: 0.5, y: 1, dir: { x: 0, y: 1 } },
  { name: 'w', x: 0, y: 0.5, dir: { x: -1, y: 0 } },
  { name: 'center', x: 0.5, y: 0.5 },
];

type Fraction = { readonly x: number; readonly y: number };

const SIDE_AT = {
  n: (t: number) => ({ x: t, y: 0 }),
  e: (t: number) => ({ x: 1, y: t }),
  s: (t: number) => ({ x: t, y: 1 }),
  w: (t: number) => ({ x: 0, y: t }),
} as const;

/** Where `def` sits in the box as fractions; undefined when that depends on the outline or the other end (a perimeter anchor). */
function fractionOf(def: AnchorDef): Fraction | undefined {
  switch (
    def.kind // kind-switch-allow: anchor def kinds are a closed union of the schema, not element kinds
  ) {
    case 'center':
      return { x: 0.5, y: 0.5 };
    case 'side':
      return def.side === undefined ? undefined : SIDE_AT[def.side](def.t ?? 0.5);
    case 'perimeter':
      return undefined;
    default:
      return def.x === undefined || def.y === undefined ? undefined : { x: def.x, y: def.y };
  }
}

/** `lists` in priority order, the first anchor of each name kept (how routing resolves a name). */
function effective(...lists: ReadonlyArray<readonly AnchorDef[]>): AnchorDef[] {
  const seen = new Set<string>();
  return lists.flat().filter((a) => {
    if (seen.has(a.name)) return false;
    seen.add(a.name);
    return true;
  });
}

/**
 * The anchor a binding to `ref` takes when a shape's anchors `from` become `to` (both in priority
 * order, defaults included): the same name when `to` has it, else the `to` anchor nearest the old
 * one's box position (the first on a tie), else floating. Anchors that are not named, and names
 * `from` does not know (they float on either shape), are returned unchanged.
 *
 * @public
 */
export function mapAnchor(ref: AnchorRef, from: readonly AnchorDef[], to: readonly AnchorDef[]): AnchorRef {
  if (ref.kind !== 'named') return ref;
  if (to.some((a) => a.name === ref.name)) return ref;
  const old = from.find((a) => a.name === ref.name);
  if (old === undefined) return ref;
  const at = fractionOf(old);
  if (at === undefined) return { kind: 'floating' };
  let best: { readonly name: string; readonly d: number } | undefined;
  for (const a of to) {
    const p = fractionOf(a);
    if (p === undefined) continue;
    const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
    if (best === undefined || d < best.d) best = { name: a.name, d };
  }
  return best === undefined ? { kind: 'floating' } : { kind: 'named', name: best.name };
}

type ShapeRecord = { readonly kind?: unknown; readonly anchors?: readonly AnchorDef[] };
type BindingLike = { readonly type?: unknown; readonly elementId?: unknown; readonly anchor: AnchorRef };

const COMMAND = 'shape.replace';

/** The replace-shape command (FR-LIB-011). */
export const REPLACE_SHAPE_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: COMMAND,
    title: title(COMMAND, 'Replace shape'),
    // fromAnchors: the current definition's anchors; toAnchors: the new one's; params: the new definition's (absent: its defaults)
    args: z.object({
      id,
      defId: qualifiedNameSchema,
      fromAnchors: z.array(anchorDefSchema).default([]),
      toAnchors: z.array(anchorDefSchema).default([]),
      params: z.record(z.string(), z.unknown()).optional(),
    }),
    run: (ctx, args) => {
      const bad = checkIds(ctx, COMMAND, 'element', [[['id'], args.id]]);
      if (bad) return bad;
      const shape = ctx.store.get(args.id as RecordId) as unknown as ShapeRecord;
      if (shape.kind !== 'shape') return refuse(COMMAND, ['id'], `"${args.id}" is a ${String(shape.kind)} element, not a shape`);
      const from = effective(shape.anchors ?? [], args.fromAnchors, DEFAULT_ANCHOR_DEFS);
      const to = effective(args.toAnchors, DEFAULT_ANCHOR_DEFS);
      const moved: Array<readonly [RecordId, AnchorRef]> = [];
      for (const b of ctx.store.members('bindingsByElement', args.id)) {
        const binding = ctx.store.get(b) as unknown as BindingLike;
        if (binding.type !== 'binding' || binding.elementId !== args.id) continue;
        const anchor = mapAnchor(binding.anchor, from, to);
        if (anchor !== binding.anchor) moved.push([b, anchor]);
      }
      return write(ctx, COMMAND, (tx) => {
        tx.patch(args.id as RecordId, { defId: args.defId, params: args.params, anchors: undefined });
        for (const [b, anchor] of moved) tx.patch(b, { anchor });
      });
    },
  }),
];
