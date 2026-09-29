// Shadows and effects of a style (FR-SHP-004): the first layer's list whose every entry is valid (a list
// with an invalid entry falls through to the next layer, as any field does); colours resolve like any
// colour field, token refs as `var(--fx-…)`.
import { isObject, type Resolver } from './resolver.js';

/**
 * A resolved shadow, in px.
 *
 * @public
 */
export type ResolvedShadow = {
  /** Horizontal offset. */
  readonly x: number;
  /** Vertical offset. */
  readonly y: number;
  /** Blur radius (≥ 0). */
  readonly blur: number;
  /** Spread (0 when unset). */
  readonly spread: number;
  /** CSS colour. */
  readonly color: string;
  /** Inside the outline instead of below it. */
  readonly inset: boolean;
};

/**
 * A resolved effect, in px.
 *
 * @public
 */
export type ResolvedEffect = {
  /** `blur` softens the element's drawing; `glow` lights around it (its text stays sharp). */
  readonly type: 'blur' | 'glow';
  /** Radius (≥ 0). */
  readonly radius: number;
  /** CSS colour of a glow (`currentColor` when unset). */
  readonly color: string;
};

type Where = ReadonlyArray<string | number>;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function shadow(r: Resolver, v: unknown, where: Where): ResolvedShadow | undefined {
  if (!isObject(v) || !finite(v['x']) || !finite(v['y']) || !finite(v['blur']) || v['blur'] < 0) return undefined;
  const color = r.color(v['color'], [...where, 'color']);
  if (color === undefined) return undefined;
  return { x: v['x'], y: v['y'], blur: v['blur'], spread: finite(v['spread']) ? v['spread'] : 0, color, inset: v['inset'] === true };
}

function effect(r: Resolver, v: unknown, where: Where): ResolvedEffect | undefined {
  if (!isObject(v) || (v['type'] !== 'blur' && v['type'] !== 'glow') || !finite(v['radius']) || v['radius'] < 0) return undefined;
  const color = v['color'] === undefined ? 'currentColor' : r.color(v['color'], [...where, 'color']);
  return color === undefined ? undefined : { type: v['type'], radius: v['radius'], color };
}

/** Every entry of a list converted, or undefined when one does not convert. */
function all<T>(v: unknown, where: Where, convert: (item: unknown, where: Where) => T | undefined): readonly T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((item, k) => convert(item, [...where, k]));
  return out.every((item) => item !== undefined) ? (out as T[]) : undefined;
}

/** The shadows of the first layer that has a valid list; none otherwise. */
export function shadowsOf(r: Resolver): readonly ResolvedShadow[] {
  return r.pick(['shadow'], (v, where) => all(v, where, (item, at) => shadow(r, item, at))) ?? [];
}

/** The effects of the first layer that has a valid list; none otherwise. */
export function effectsOf(r: Resolver): readonly ResolvedEffect[] {
  return r.pick(['effects'], (v, where) => all(v, where, (item, at) => effect(r, item, at))) ?? [];
}
