// Selection rules (FR-EDT-004): shift toggles a click into or out of the selection; a marquee dragged
// left to right selects what it contains, dragged right to left what it touches; select all, and
// select the same type or style as what is selected. Pure: what is where comes from the hit index.
import type { ReadView } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';

/**
 * How a marquee selects: what lies wholly inside it, or anything it touches.
 *
 * @public
 */
export type MarqueeMode = 'contain' | 'intersect';

/**
 * A press moves this far on the canvas, px, before it is a drag rather than a click.
 *
 * @public
 */
export const DRAG_PX = 4;

/**
 * The selection after a click on `hit` (or on nothing): with shift, `hit` toggles and the rest stays;
 * without, the selection is `hit` alone, or empty.
 *
 * @public
 */
export function clickSelection(current: readonly RecordId[], hit: RecordId | undefined, shift: boolean): readonly RecordId[] {
  if (!shift) return hit === undefined ? [] : [hit];
  if (hit === undefined) return current;
  return current.includes(hit) ? current.filter((id) => id !== hit) : [...current, hit];
}

/**
 * A marquee: its box and how it selects.
 *
 * @public
 */
export type Marquee = {
  /** The box, page units. */
  readonly box: Box;
  /** What it selects: what it contains, or what it touches. */
  readonly mode: MarqueeMode;
};

/**
 * The marquee from `start` to `end` (page points) and how it selects: dragged rightwards it
 * contains, leftwards it intersects.
 *
 * @public
 */
export function marquee(start: Vec2, end: Vec2): Marquee {
  return {
    box: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) },
    mode: end.x >= start.x ? 'contain' : 'intersect',
  };
}

/**
 * `base` with `picked` added, each once, in order (a shift-marquee adds to the selection).
 *
 * @public
 */
export function union(base: readonly RecordId[], picked: readonly RecordId[]): readonly RecordId[] {
  return [...base, ...picked.filter((id) => !base.includes(id))];
}

/** A record's field as a string that is equal for equal values, whatever the order of object keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    // tzap disable next-line StringLiteral: another separator between canonical entries separates as well
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  // tzap disable next-line LogicalOperator, StringLiteral: undefined in a template reads 'undefined' as well
  return JSON.stringify(value) ?? 'undefined';
}

/** The type of an element: its kind, and for a shape its definition. */
const typeOf = (view: ReadView, id: RecordId): string => {
  const r = view.get(id) as { kind?: unknown; defId?: unknown } | undefined;
  return `${String(r?.kind)}/${String(r?.defId)}`;
};

/** An element's style, canonical. */
const styleOf = (view: ReadView, id: RecordId): string => canonical((view.get(id) as { style?: unknown } | undefined)?.style ?? {});

/**
 * The elements of `pool` of the same type as one of `selected` (a shape's type is its definition).
 *
 * @public
 */
export function sameType(view: ReadView, selected: readonly RecordId[], pool: readonly RecordId[]): readonly RecordId[] {
  const types = new Set(selected.map((id) => typeOf(view, id)));
  return pool.filter((id) => types.has(typeOf(view, id)));
}

/**
 * The elements of `pool` styled exactly as one of `selected` (their own style, before the theme).
 *
 * @public
 */
export function sameStyle(view: ReadView, selected: readonly RecordId[], pool: readonly RecordId[]): readonly RecordId[] {
  const styles = new Set(selected.map((id) => styleOf(view, id)));
  return pool.filter((id) => styles.has(styleOf(view, id)));
}
