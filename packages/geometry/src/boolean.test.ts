import { describe, expect, it } from 'vitest';
import { runBooleanCases } from './__fixtures__/boolean-cases.js';
import goldens from './__fixtures__/boolean-goldens.json' with { type: 'json' };
import { areaOf, circle, flipX, operand, polygon, rect, reversed, roundedRect, signedArea, star } from './__fixtures__/boolean-shapes.js';
import { type BooleanOp, type BooleanOperand, booleanPaths } from './boolean.js';
import { type Path, pathFromCommands } from './path.js';
import { parsePathData } from './path-data.js';
import { pointInPaths } from './point-in-path.js';

/** The result of `op` over `operands`, which must succeed. */
function run(op: BooleanOp, operands: readonly BooleanOperand[]) {
  const r = booleanPaths(op, operands);
  if (!r.ok) throw new Error(r.error.message);
  const subpaths = parsePathData(r.value.d);
  if (!subpaths.ok) throw new Error(subpaths.error.message);
  const rings = subpaths.value.map((cmds) => {
    const p = pathFromCommands(cmds);
    if (!p.ok) throw new Error(p.error.message);
    return p.value;
  });
  // signed areas sum to the filled area: outer rings and holes are wound oppositely
  const area = Math.abs(rings.reduce((sum, p) => sum + signedArea(p.segments), 0));
  return { ...r.value, paths: rings, area };
}

const within = (actual: number, reference: number, fraction = 0.005) => expect(Math.abs(actual - reference) / reference).toBeLessThanOrEqual(fraction);
const segmentsOf = (operands: readonly BooleanOperand[]) => operands.reduce((n, o) => n + o.rings.reduce((m, p) => m + p.segments.length, 0), 0);
const bounded = (r: ReturnType<typeof run>, operands: readonly BooleanOperand[]) =>
  expect(r.segments).toBeLessThanOrEqual(2 * segmentsOf(operands) + 8 * r.rings);

const R = rect(0, 0, 200, 100);
const C = circle(200, 50, 50);
const S = star(100, 100, 80, 32);
const RR = roundedRect({ x: 150, y: 40, w: 160, h: 120 }, 30);
const [aR, aC] = [areaOf(R), areaOf(C)];

describe('boolean operations (ADR-0053, FR-SHP-010)', () => {
  it('FR-SHP-010: union, subtract, intersect and exclude of a rectangle and a circle half over it match their areas', () => {
    const ops = [operand([R]), operand([C])];
    // the circle's centre is on the rectangle's right edge: half of it overlaps
    const overlap = aC / 2;
    for (const [op, reference] of [
      ['union', aR + aC - overlap],
      ['subtract', aR - overlap],
      ['intersect', overlap],
      ['exclude', aR + aC - 2 * overlap],
    ] as const) {
      const r = run(op, ops);
      within(r.area, reference);
      bounded(r, ops);
    }
  });

  it('FR-SHP-010: a star and a rounded rectangle combine within 0.5 % of their reference areas', () => {
    const ops = [operand([S.path]), operand([RR.path])];
    const union = run('union', ops).area;
    const inter = run('intersect', ops).area;
    within(union + inter, S.area + RR.area);
    within(run('subtract', ops).area, S.area - inter);
    within(run('exclude', ops).area, union - inter);
    bounded(run('union', ops), ops);
  });

  it('FR-SHP-010: a small circle taken from and cut out of a 1000 px rectangle keeps its area and is drawn by cubics', () => {
    const big = rect(0, 0, 1000, 1000);
    const small = circle(500, 500, 10);
    const ops = [operand([big]), operand([small])];
    const cut = run('intersect', ops);
    within(cut.area, areaOf(small));
    expect(cut.d).toContain('C');
    // at most 4 cubics per quarter
    expect(cut.segments).toBeLessThanOrEqual(16);
    const holed = run('subtract', ops);
    within(holed.area, 1e6 - areaOf(small));
    // the hole is not inside the result under its stored rule, and its ring winds against the outer one
    const at = (x: number, y: number) => ({ x: x - holed.box.x, y: y - holed.box.y });
    expect(pointInPaths(holed.paths, at(500, 500), holed.fillRule)).toBe(false);
    expect(pointInPaths(holed.paths, at(500, 500), 'nonzero')).toBe(false);
    expect(pointInPaths(holed.paths, at(100, 100), holed.fillRule)).toBe(true);
    const [outer, hole] = holed.paths.map((p) => Math.sign(signedArea(p.segments)));
    expect(outer).toBe(-(hole as number));
  });

  it('FR-SHP-010: a nonzero operand keeps the hole of its counter-wound inner ring', () => {
    const ring = operand([rect(0, 0, 100, 100), reversed(rect(25, 25, 50, 50))]);
    const r = run('union', [ring, operand([rect(200, 0, 10, 10)])]);
    within(r.area, 10000 - 2500 + 100);
  });

  it('FR-SHP-010: a flipped operand, one whose outer ring is reversed, and two oppositely wound blobs keep their full area in a union', () => {
    // a right triangle flipped about its own middle: every ring reversed by the matrix
    const triangle = polygon([
      { x: 300, y: 0 },
      { x: 400, y: 0 },
      { x: 300, y: 80 },
    ]);
    const flipped = run('union', [operand([R]), operand([triangle], flipX(350))]);
    within(flipped.area, aR + 4000);
    // the flip moved the right angle to the right
    expect(pointInPaths(flipped.paths, { x: 395 - flipped.box.x, y: 5 - flipped.box.y }, 'evenodd')).toBe(true);
    expect(pointInPaths(flipped.paths, { x: 305 - flipped.box.x, y: 75 - flipped.box.y }, 'evenodd')).toBe(false);
    within(run('union', [operand([R]), operand([reversed(C)])]).area, aR + aC - aC / 2);
    const blobs = operand([rect(0, 0, 50, 50), reversed(rect(100, 0, 50, 50))]);
    within(run('union', [blobs, operand([rect(300, 0, 10, 10)])]).area, 2500 + 2500 + 100);
  });

  it('FR-SHP-010: a self-crossing nonzero ring (a pentagram) fills its middle', () => {
    const pts = [0, 2, 4, 1, 3].map((i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      return { x: 100 + 100 * Math.cos(a), y: 100 + 100 * Math.sin(a) };
    });
    const pentagram = operand([polygon(pts)]);
    const evenodd = operand([polygon(pts)], undefined, 'evenodd');
    const extra = operand([rect(400, 0, 10, 10)]);
    const filled = run('union', [pentagram, extra]);
    const holed = run('union', [evenodd, extra]);
    // the middle pentagon is the difference
    expect(filled.area).toBeGreaterThan(holed.area * 1.2);
  });

  it('FR-SHP-010: results with no area are refused, and so is a single operand', () => {
    const far = [operand([rect(0, 0, 10, 10)]), operand([rect(100, 100, 10, 10)])];
    const none = booleanPaths('intersect', far);
    expect(none.ok ? undefined : none.error.code).toBe('BOOLEAN_EMPTY');
    const gone = booleanPaths('subtract', [operand([rect(10, 10, 10, 10)]), operand([rect(0, 0, 100, 100)])]);
    expect(gone.ok ? undefined : gone.error.code).toBe('BOOLEAN_EMPTY');
    const one = booleanPaths('union', [operand([R])]);
    expect(one.ok ? undefined : one.error.code).toBe('BOOLEAN_OPERANDS');
  });

  it('FR-SHP-010: the same operands give the same bytes, normalised into the result box at 2 decimals', () => {
    const ops = [operand([S.path]), operand([C])];
    const [a, b] = [run('union', ops), run('union', ops)];
    expect(a.d).toBe(b.d);
    expect(a.d).toMatch(/^M (-?\d+(\.\d{1,2})? ?|[LCZM] ?)+$/);
    expect(Math.min(...a.paths.flatMap((p: Path) => p.segments.map((s) => s.p0.x)))).toBeCloseTo(0, 1);
  });

  it('FR-SHP-010: a smooth ring (a circle) keeps one tangent where its fitted curve closes', () => {
    const r = run('intersect', [operand([rect(0, 0, 2000, 2000)]), operand([circle(1000, 1000, 500)])]);
    const segs = r.paths[0]?.segments ?? [];
    const [first, last] = [segs[0], segs[segs.length - 1]];
    if (first === undefined || last === undefined) throw new Error('no segments');
    const out = { x: first.p1.x - first.p0.x, y: first.p1.y - first.p0.y };
    const into = { x: last.p3.x - last.p2.x, y: last.p3.y - last.p2.y };
    // the cross product of the unit tangents is the sine of the kink: below 0.01 rad (about 0.6 degree, rounding to 2 decimals)
    const sine = (out.x * into.y - out.y * into.x) / Math.sqrt((out.x * out.x + out.y * out.y) * (into.x * into.x + into.y * into.y));
    expect(Math.abs(sine)).toBeLessThan(0.01);
    expect(out.x * into.x + out.y * into.y).toBeGreaterThan(0);
  });

  it('FR-SHP-010: every golden case gives its committed bytes (the browsers check the same file, e2e/geometry.boolean-engines.spec.ts)', () => {
    expect(runBooleanCases()).toEqual(goldens);
  });
});
