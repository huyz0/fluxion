// draw.io edge markers as SVG (ADR-0049): classic/block triangles, open chevrons and ovals; unknown markers draw the
// classic triangle. Plain markup that the single-SVG importer sanitizes and witnesses again.
import { num } from './drawio-paint.js';

/** A point in model coordinates. */
export type Point = readonly [number, number];

type Head = {
  readonly tip: Point;
  readonly size: number;
  readonly color: string;
  readonly filled: boolean;
  readonly at: (back: number, side: number) => string;
};

/** Arrowhead painters by draw.io marker name; unknown markers draw the classic triangle. */
const HEADS: Readonly<Record<string, (h: Head) => string>> = {
  none: () => '',
  '': () => '',
  oval: (h) => `<circle cx="${num(h.tip[0])}" cy="${num(h.tip[1])}" r="${num(h.size / 2)}" fill="${h.filled ? h.color : '#FFFFFF'}" stroke="${h.color}"/>`,
  open: (h) =>
    `<polyline points="${h.at(h.size, h.size / 2)} ${num(h.tip[0])},${num(h.tip[1])} ${h.at(h.size, -h.size / 2)}" fill="none" stroke="${h.color}"/>`,
};
const triangle = (h: Head): string =>
  `<polygon points="${num(h.tip[0])},${num(h.tip[1])} ${h.at(h.size, h.size / 2)} ${h.at(h.size, -h.size / 2)}" fill="${h.filled ? h.color : '#FFFFFF'}" stroke="${h.color}"/>`;

/** The marker `marker` at `tip`, pointing away from `from`. */
export function arrowhead(marker: string, tip: Point, from: Point, spec: { size: number; color: string; filled: boolean }): string {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const at = (back: number, side: number): string =>
    `${num(tip[0] - back * Math.cos(angle) + side * Math.sin(angle))},${num(tip[1] - back * Math.sin(angle) - side * Math.cos(angle))}`;
  const paint = Object.hasOwn(HEADS, marker) ? (HEADS[marker] as (h: Head) => string) : triangle;
  return paint({ tip, ...spec, at });
}
