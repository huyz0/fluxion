// Boolean operations in the editor (FR-SHP-010, ADR-0053): union, subtract, intersect and exclude over the selected shapes, one core
// command and so one undo step. The editor resolves each operand's outline (its definition's, or a path shape's own path), placed
// by its transform, and geometry computes the result; core replaces the operands by it. Pure over the tool context; the palette and
// the menus call it.
import { evaluateOutline, ownPathOf, type ShapeDef } from '@fluxion/core';
import { type BooleanOp, type BooleanOperand, booleanPaths, booleanPlacement } from '@fluxion/geometry/boolean';
import { compareKeys, type PathData, type RecordId, type Transform } from '@fluxion/schema';
import type { ToolCtx } from './tools.js';

/** The boolean operations, with the words people read. */
export const BOOLEAN_OPS = [
  ['union', 'Union'],
  ['subtract', 'Subtract'],
  ['intersect', 'Intersect'],
  ['exclude', 'Exclude'],
] as const;

type Shape = {
  readonly id: RecordId;
  readonly kind?: unknown;
  readonly defId?: unknown;
  readonly index: string;
  readonly params?: Record<string, unknown>;
  readonly path?: PathData;
  readonly transform?: Transform;
};

/** Shape `s` as an operand, its outline placed on the screen; undefined without a definition, a box or a closed outline. */
function operandOf(s: Shape, def: ShapeDef | undefined): BooleanOperand | undefined {
  const t = s.transform;
  if (def === undefined || t === undefined) return undefined;
  const size = { w: t.w, h: t.h };
  const matrix = booleanPlacement({ ...t, rot: t.rot ?? 0 });
  const own = ownPathOf({ defId: def.id, path: s.path }, size);
  if (own !== undefined) return { rings: own.paths, matrix, fillRule: own.fillRule };
  const outline = evaluateOutline(def, size, s.params);
  if (!outline.ok || !outline.value.path.closed) return undefined;
  return { rings: [outline.value.path], matrix, fillRule: 'nonzero' };
}

/**
 * Combine the selected shapes by `op` into one path shape, which is selected: `subtract` takes the upper shapes from the bottom
 * one. False with fewer than two shapes selected, one without a closed outline, a result with no area, or when the document
 * refuses (shapes in different containers, a locked one).
 *
 * @public
 */
export function combineSelection(ctx: ToolCtx, op: BooleanOp): boolean {
  const ids = ctx.session.selection.get();
  if (ids.length < 2 || ctx.shapeDefs === undefined) return false;
  const shapes = ids.map((x) => ctx.view.get(x) as Shape | undefined);
  if (shapes.some((s) => s?.kind !== 'shape' || typeof s.defId !== 'string')) return false;
  // bottom first, in the sibling order: what `subtract` takes from
  const ordered = [...(shapes as Shape[])].sort((a, b) => compareKeys(a.index, b.index));
  const operands = ordered.map((s) => operandOf(s, ctx.shapeDefs?.get(s.defId as string)));
  if (operands.some((o) => o === undefined)) return false;
  const result = booleanPaths(op, operands as BooleanOperand[]);
  if (!result.ok) return false;
  const { box, d, fillRule } = result.value;
  const resultId = ctx.newId();
  const args = { ids: ordered.map((s) => s.id), resultId, op, path: { d, w: box.w, h: box.h, fillRule }, box };
  if (!ctx.execute('shape.boolean', args).ok) return false;
  ctx.session.selection.set([resultId]);
  return true;
}
