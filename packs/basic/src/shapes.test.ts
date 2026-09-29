import { createCoreRegistries, type EvaluatedOutline, evaluateOutline, type ShapeDef } from '@fluxion/sdk';
import { describe, expect, it } from 'vitest';
import { basicPack, blockArrow, diamond, ellipse, octagon, rect, roundedRect, star, triangle } from './index.js';

const EPS = 1e-9;

function outline(def: ShapeDef, size: { w: number; h: number }, params: { readonly [key: string]: unknown } = {}): EvaluatedOutline {
  const r = evaluateOutline(def, size, params);
  if (!r.ok) throw new Error(`${def.id}: ${r.error.code} ${r.error.path} ${r.error.message}`);
  return r.value;
}

/** Every point of the path's cubics, control points included (the curve lies in their hull). */
const points = (o: EvaluatedOutline) => o.path.segments.flatMap((s) => [s.p0, s.p1, s.p2, s.p3]);

/** The element params at each end of every number or int param's range. */
function extremes(def: ShapeDef): { readonly [key: string]: unknown }[] {
  const cases: { [key: string]: unknown }[] = [{}];
  for (const [name, spec] of Object.entries(def.params ?? {})) {
    if (spec.type !== 'number' && spec.type !== 'int') continue;
    for (const v of [spec.min, spec.max]) if (v !== undefined) cases.push({ [name]: v });
  }
  return cases;
}

/** Vertices of a straight outline: where its segments start. */
const vertices = (o: EvaluatedOutline) => o.path.segments.map((s) => s.p0);
const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 });

/** The outline of `def` is closed, not empty, and inside its box. */
function expectClosedInside(def: ShapeDef, size: { w: number; h: number }, params: { readonly [key: string]: unknown }): void {
  const o = outline(def, size, params);
  const where = `${def.id} ${size.w}x${size.h} ${JSON.stringify(params)}`;
  expect(o.path.closed, where).toBe(true);
  expect(o.path.segments.length, where).toBeGreaterThan(0);
  const outside = points(o).filter((p) => p.x < -EPS || p.x > size.w + EPS || p.y < -EPS || p.y > size.h + EPS);
  expect(outside, where).toEqual([]);
}

describe('basic shapes, batch 1 (FR-SHP-002, M5.10)', () => {
  it('FR-SHP-002: the batch registers and every outline is closed and inside its box, at any size and param', () => {
    const registries = createCoreRegistries();
    const r = basicPack.register(registries);
    expect(r.ok ? [] : r.error).toEqual([]);
    expect(basicPack.shapes.map((s) => s.id)).toEqual([
      'basic:rect',
      'basic:rounded-rect',
      'basic:ellipse',
      'basic:triangle',
      'basic:diamond',
      'basic:parallelogram',
      'basic:trapezoid',
      'basic:hexagon',
      'basic:octagon',
      'basic:star',
      'basic:block-arrow',
    ]);
    for (const def of basicPack.shapes) {
      for (const size of [def.defaultSize, { w: 300, h: 40 }, { w: 30, h: 200 }, { w: 1, h: 1 }]) {
        for (const params of extremes(def)) {
          expectClosedInside(def, size, params);
        }
      }
    }
  });

  it('FR-SHP-003: star points 5 to 8 gives 16 outline vertices', () => {
    expect(vertices(outline(star, star.defaultSize))).toHaveLength(10);
    const eight = outline(star, star.defaultSize, { points: 8 });
    expect(vertices(eight)).toHaveLength(16);
    // the first tip points up; inner vertices sit at `inner` of the radius
    expect(round(vertices(eight)[0] as { x: number; y: number })).toEqual({ x: 60, y: 0 });
    const inner = vertices(outline(star, { w: 100, h: 100 }, { points: 4, inner: 0.5 }))[1] as { x: number; y: number };
    expect(Math.hypot(inner.x - 50, inner.y - 50)).toBeCloseTo(25, 9);
    // points are an int param: fractions round, and the range holds
    expect(vertices(outline(star, star.defaultSize, { points: 6.4 }))).toHaveLength(12);
    expect(vertices(outline(star, star.defaultSize, { points: 1000 }))).toHaveLength(128);
  });

  it('FR-SHP-003: params reshape the outlines', () => {
    const box = { w: 100, h: 60 };
    // a rounded rectangle of radius 0 is the rectangle; a large radius stops at half the shorter side
    expect(outline(roundedRect, box, { r: 0 }).path.segments.map((s) => round(s.p3))).toEqual(outline(rect, box).path.segments.map((s) => round(s.p3)));
    expect(round(vertices(outline(roundedRect, box, { r: 500 }))[0] as { x: number; y: number })).toEqual({ x: 30, y: 0 });
    expect(round(vertices(outline(roundedRect, box))[0] as { x: number; y: number })).toEqual({ x: 12, y: 0 });
    // the ellipse passes through the midpoints of the sides
    const e = outline(ellipse, box).path.segments.map((s) => round(s.p3));
    for (const p of [
      { x: 50, y: 0 },
      { x: 100, y: 30 },
      { x: 50, y: 60 },
      { x: 0, y: 30 },
    ])
      expect(e).toContainEqual(p);
    expect(vertices(outline(triangle, box, { apex: 0 })).map(round)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ]);
    expect(vertices(outline(diamond, box)).map(round)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 30 },
      { x: 50, y: 60 },
      { x: 0, y: 30 },
    ]);
    // the octagon's cut is a fraction of the shorter side
    expect(round(vertices(outline(octagon, box, { cut: 0.5 }))[0] as { x: number; y: number })).toEqual({ x: 30, y: 0 });
    // the block arrow's tip is the middle of the right side; its shaft is `shaft` of the height
    const arrow = vertices(outline(blockArrow, box, { head: 0.5, shaft: 0.5 })).map(round);
    expect(arrow).toContainEqual({ x: 100, y: 30 });
    expect(arrow[0]).toEqual({ x: 0, y: 15 });
    expect(arrow[1]).toEqual({ x: 50, y: 15 });
  });
});
