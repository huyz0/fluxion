// What a move changes (ADR-0028 §4, 04 §5): a translate writes only a box's `x` and `y`, which the
// element's wrapper places; its view need not be drawn again. Pure: the element subtree's memo reads it.
import type { ElementRecord } from '@fluxion/schema';

/** Two boxes equal but for their place: `x` and `y` may differ. */
function samePlaced(a: object | undefined, b: object | undefined): boolean {
  // tzap disable next-line ConditionalExpression: a fast path; the same box compares equal below too
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const moved = (k: string) => k === 'x' || k === 'y';
  const ka = Object.keys(a).filter((k) => !moved(k));
  const kb = Object.keys(b).filter((k) => !moved(k));
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

/**
 * Whether two records of one element are equal but for their box's place (`transform.x` and `.y`):
 * what a move changes. Fields are compared by identity, as records are immutable.
 */
export function sameButPlace(a: ElementRecord, b: ElementRecord): boolean {
  // tzap disable next-line ConditionalExpression: a fast path; the same record compares equal below too
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  const field = (r: ElementRecord, k: string) => (r as unknown as Record<string, unknown>)[k];
  const same = (k: string) =>
    field(a, k) === field(b, k) || (k === 'transform' && samePlaced(field(a, k) as object | undefined, field(b, k) as object | undefined));
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(k));
}
