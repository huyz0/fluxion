// Points along resolved draw.io edge routes, for edge-attached labels (ADR-0049).
import type { Point } from './drawio-arrows.js';
import { type Budget, step } from './drawio-paint.js';

/** Cumulative segment lengths per resolved route, measured once however many labels it carries. */
const measured = new WeakMap<readonly Point[], readonly number[]>();
function cumulative(route: readonly Point[]): readonly number[] {
  const known = measured.get(route);
  if (known) return known;
  const sums = [0];
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1] as Point, route[i] as Point];
    sums.push((sums[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  measured.set(route, sums);
  return sums;
}

/** The first non-empty segment ending at or beyond `distance`, or -1. */
function segmentAt(sums: readonly number[], distance: number): number {
  let [lo, hi] = [0, sums.length - 1];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sums[mid + 1] as number) >= distance) hi = mid;
    else lo = mid + 1;
  }
  while (lo < sums.length - 1 && sums[lo + 1] === sums[lo]) lo++;
  return lo < sums.length - 1 ? lo : -1;
}

/** The point at fraction `t` of a polyline's length; every route point is still charged, as when it was walked per call. */
export function along(route: readonly Point[], t: number, budget: Budget): Point {
  step(budget, route.length);
  const sums = cumulative(route);
  const distance = Math.min(1, Math.max(0, t)) * (sums.at(-1) as number);
  const i = segmentAt(sums, distance);
  if (i < 0) return route.at(-1) as Point;
  const [a, b] = [route[i] as Point, route[i + 1] as Point];
  const [left, length] = [distance - (sums[i] as number), (sums[i + 1] as number) - (sums[i] as number)];
  return [a[0] + ((b[0] - a[0]) * left) / length, a[1] + ((b[1] - a[1]) * left) / length];
}
