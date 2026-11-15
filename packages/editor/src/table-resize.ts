// Resizing a table's rows and columns (FR-SHP-014): a press on a border between two rows (or columns) of the one selected table
// drags it; the two lines beside it share their space anew and the others keep theirs, so the table's box does not change. One
// gesture, so one undo step; Esc puts the weights back. A table locked against editing is not resized.
import { lockedWithin, type TableAxis } from '@fluxion/core';
import { apply, elementMatrix, invert, type Vec2 } from '@fluxion/geometry';
import type { TableElement } from '@fluxion/schema';
import { HANDLE_PX } from './overlay-geometry.js';
import { beginGesture, type Gesture, type PointerInfo } from './pointer.js';
import { tableOf } from './table-edit.js';
import type { StateNode, ToolCtx } from './tools.js';
import { TOUCH } from './touch.js';

/** The narrowest a row or column is dragged to, page units. */
const MIN_LINE = 8;

/** A press on a table border: the table as it was, and the border (between line `index - 1` and line `index` of `axis`). */
export type BorderGrab = { readonly table: TableElement; readonly axis: TableAxis; readonly index: number };

type Weighted = readonly { readonly [k: string]: number }[];

/** Each axis's lines, their weight field and the box length and point coordinate they share. */
const AXIS = {
  row: {
    lines: (t: TableElement) => t.rows as Weighted,
    field: 'h',
    length: (t: TableElement) => t.transform.h,
    along: (p: Vec2) => p.y,
    across: (p: Vec2) => p.x,
  },
  col: {
    lines: (t: TableElement) => t.cols as Weighted,
    field: 'w',
    length: (t: TableElement) => t.transform.w,
    along: (p: Vec2) => p.x,
    across: (p: Vec2) => p.y,
  },
} as const;

/** Where each inner border of `axis` is in the table's box. */
function borders(table: TableElement, axis: TableAxis): number[] {
  const a = AXIS[axis];
  const weights = a.lines(table).map((l) => l[a.field] as number);
  const sum = weights.reduce((x, y) => x + y, 0);
  const out: number[] = [];
  let run = 0;
  for (const w of weights.slice(0, -1)) {
    run += w;
    out.push((run / sum) * a.length(table));
  }
  return out;
}

/** Page point `p` in the table's box. */
function local(table: TableElement, p: Vec2): Vec2 | undefined {
  const back = invert(elementMatrix({ ...table.transform, rot: table.transform.rot ?? 0 }));
  return back.ok ? apply(back.value, p) : undefined;
}

/** The inner border of `table` within `reach` of the point `at` of its box, columns first. */
function borderAt(table: TableElement, at: Vec2, reach: number): BorderGrab | undefined {
  for (const axis of ['col', 'row'] as const) {
    const a = AXIS[axis];
    const across = a.across(at);
    // strictly inside the box: on its edge a press is the frame's
    if (across <= reach || across >= AXIS[axis === 'row' ? 'col' : 'row'].length(table) - reach) continue;
    const index = borders(table, axis).findIndex((b) => Math.abs(b - a.along(at)) <= reach);
    if (index >= 0) return { table, axis, index: index + 1 };
  }
  return undefined;
}

/** The inner border of the one selected table under `e`, if any, and not locked against editing. */
export function borderUnder(ctx: ToolCtx, e: PointerInfo): BorderGrab | undefined {
  const [only, ...rest] = ctx.session.selection.get();
  const table = only === undefined || rest.length > 0 ? undefined : tableOf(ctx.view, only);
  const at = table === undefined ? undefined : local(table, e.page);
  if (table === undefined || at === undefined || lockedWithin(ctx.view, table.id, 'edit')) return undefined;
  return borderAt(table, at, (e.pointerType === 'touch' ? TOUCH.handlePx : HANDLE_PX) / 2 / ctx.session.camera.get().z);
}

/**
 * The weights of `grab`'s axis with its border at `along` in the table's box: the two lines beside it share their space at that
 * point (each at least {@link MIN_LINE}), the others unchanged.
 */
export function resizedLines(grab: BorderGrab, along: number): Weighted {
  const { table, axis, index } = grab;
  const a = AXIS[axis];
  const lines = a.lines(table);
  const weights = lines.map((l) => l[a.field] as number);
  const sum = weights.reduce((x, y) => x + y, 0);
  const scale = a.length(table) / sum;
  const start = weights.slice(0, index - 1).reduce((x, y) => x + y, 0) * scale;
  const pair = ((weights[index - 1] as number) + (weights[index] as number)) * scale;
  const min = Math.min(MIN_LINE, pair / 2);
  const first = Math.max(min, Math.min(pair - min, along - start));
  return lines.map((l, i) => {
    if (i === index - 1) return { ...l, [a.field]: first / scale };
    return i === index ? { ...l, [a.field]: (pair - first) / scale } : l;
  });
}

/** The state that drags a table border: each move shares the two lines' space anew, one undo step; Esc puts it back. */
export function tableResizing(press: { border?: BorderGrab | undefined }): StateNode {
  let gesture: Gesture | undefined;
  const field = (g: BorderGrab) => (g.axis === 'row' ? 'rows' : 'cols');
  return {
    id: 'tableResizing',
    onEnter: (ctx) => {
      gesture = beginGesture(ctx.execute, ctx.seal);
    },
    onPointerMove: (_ctx, e) => {
      const grab = press.border as BorderGrab;
      const at = local(grab.table, e.page);
      if (at === undefined) return undefined;
      gesture?.update('element.update', { id: grab.table.id, fields: { [field(grab)]: resizedLines(grab, AXIS[grab.axis].along(at)) } });
      gesture?.commit();
      return undefined;
    },
    onPointerUp: () => ({ to: 'idle' }),
    onCancel: () => {
      const grab = press.border as BorderGrab;
      gesture?.update('element.update', { id: grab.table.id, fields: { [field(grab)]: AXIS[grab.axis].lines(grab.table) } });
      gesture?.commit();
      return { to: 'idle' };
    },
    onExit: () => {
      gesture?.end();
      gesture = undefined;
    },
  };
}
