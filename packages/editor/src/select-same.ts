// Select same type / same style (FR-EDT-004, M7.25): from the first selected element, select every element of
// the shown screen that is of the same type, or styled the same.
import type { RecordId } from '@fluxion/schema';
import type { ToolCtx } from './tools.js';

type Props = { readonly kind?: unknown; readonly defId?: unknown; readonly style?: unknown };

/** `value` as JSON with the keys of every object sorted, so equal values read equal whatever their key order. */
function stable(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

/** What makes elements the same, by what is asked: the type is the kind (and a shape's definition); the style is the kind and its style, key order aside. */
const SAME: { readonly [by: string]: (e: Props) => string } = {
  type: (e) => `${String(e.kind)}|${String(e.defId ?? '')}`,
  style: (e) => `${String(e.kind)}|${stable(e.style ?? {})}`,
};

/**
 * Select every element of the shown screen of the same `by` ('type' or 'style') as the first selected one, that one
 * included; false with nothing selected (or `by` unknown).
 *
 * @public
 */
export function selectSame(ctx: ToolCtx, by: 'type' | 'style'): boolean {
  const key = SAME[by];
  const first = ctx.session.selection.get()[0];
  const reference = first === undefined ? undefined : (ctx.view.get(first) as Props | undefined);
  if (key === undefined || reference === undefined || first === undefined) return false;
  const want = key(reference);
  const same = ctx.allElements().filter((id): id is RecordId => {
    const e = ctx.view.get(id) as Props | undefined;
    return e !== undefined && key(e) === want;
  });
  ctx.session.selection.set(same.includes(first) ? same : [first, ...same]);
  return true;
}
