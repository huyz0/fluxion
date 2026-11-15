// The boolean goldens' cases (ADR-0053, M19 cp1 F4): each operation over the rect, circle, star and rounded-rectangle fixtures, a
// small circle in a large rect, and a turned and flipped operand placed by `booleanPlacement`. boolean.test.ts checks Node's bytes
// against boolean-goldens.json; e2e/geometry.boolean-engines.spec.ts bundles this module and checks Chromium's, Firefox's and
// WebKit's against the same file.

import { booleanPlacement } from '../boolean/place.js';
import { type BooleanOp, booleanPaths } from '../boolean.js';
import { circle, operand, rect, roundedRect, star } from './boolean-shapes.js';

const OPS: readonly BooleanOp[] = ['union', 'subtract', 'intersect', 'exclude'];

/** The operand pairs, by name. */
function pairs() {
  const R = operand([rect(0, 0, 200, 100)]);
  const C = operand([circle(200, 50, 50)]);
  const S = operand([star(100, 100, 80, 32).path]);
  const RR = operand([roundedRect({ x: 150, y: 40, w: 160, h: 120 }, 30).path]);
  // a 120 × 60 rounded rectangle in its own box, turned 30° and flipped, over the rect
  const turned = operand([roundedRect({ x: 0, y: 0, w: 120, h: 60 }, 12).path], booleanPlacement({ x: 120, y: 40, w: 120, h: 60, rot: 30, flipX: true }));
  return {
    'rect-circle': [R, C],
    'star-roundrect': [S, RR],
    'big-rect-small-circle': [operand([rect(0, 0, 1000, 1000)]), operand([circle(500, 500, 10)])],
    'rect-turned': [R, turned],
  } as const;
}

/**
 * Every case's result path data (or error code), by `<pair>/<op>`.
 *
 * @public
 */
export function runBooleanCases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, ops] of Object.entries(pairs()))
    for (const op of OPS) {
      const r = booleanPaths(op, ops);
      out[`${name}/${op}`] = r.ok ? r.value.d : r.error.code;
    }
  return out;
}
