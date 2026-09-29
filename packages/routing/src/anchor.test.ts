import type { ShapeDef } from '@fluxion/core';
import { outlineDistance } from '@fluxion/core';
import { apply, elementMatrix, invert, type Mat2d, type Ok, type Vec2 } from '@fluxion/geometry';
import type { Transform } from '@fluxion/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type AnchorTarget, DEFAULT_ANCHORS, resolveAnchor, shapeAnchorTarget } from './anchor.js';

const ellipse = {
  id: 'test:ellipse',
  outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 1 1 {w} {h/2} A {w/2} {h/2} 0 1 1 0 {h/2} Z' },
  defaultSize: { w: 100, h: 60 },
} as ShapeDef;
const diamond = { id: 'test:diamond', outline: { path: 'M {w/2} 0 L {w} {h/2} L {w/2} {h} L 0 {h/2} Z' }, defaultSize: { w: 100, h: 60 } } as ShapeDef;

const near = (a: Vec2 | undefined, b: Vec2, digits = 6) => {
  expect(a?.x).toBeCloseTo(b.x, digits);
  expect(a?.y).toBeCloseTo(b.y, digits);
};

/** `p` (screen) in the element's own box. */
const local = (t: Transform, p: Vec2) => apply((invert(elementMatrix({ ...t, rot: t.rot ?? 0 })) as Ok<Mat2d>).value, p);

describe('floating anchors (FR-ANC-001)', () => {
  it('FR-ANC-001: a floating anchor projects toward the other end onto the outline', () => {
    const t = { x: 100, y: 100, w: 100, h: 60 };
    const target = shapeAnchorTarget(t, ellipse);
    // straight right: the ellipse's rightmost point, leaving to the right
    const right = resolveAnchor(target, { kind: 'floating' }, { x: 500, y: 130 });
    near(right.point, { x: 200, y: 130 });
    near(right.dir, { x: 1, y: 0 });
    // any direction: on the outline, on the ray from the centre toward the other end
    const outline = target.outline;
    if (outline === undefined) throw new Error('the ellipse evaluates');
    fc.assert(
      fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), fc.double({ min: -60, max: 60, noNaN: true }), (a, rot) => {
        const placed = { ...t, rot };
        const toward = { x: 150 + 400 * Math.cos(a), y: 130 + 400 * Math.sin(a) };
        const { point } = resolveAnchor(shapeAnchorTarget(placed, ellipse), { kind: 'floating' }, toward);
        expect(outlineDistance(outline, local(placed, point))).toBeLessThan(1e-6);
        const [u, v] = [
          { x: point.x - 150, y: point.y - 130 },
          { x: toward.x - 150, y: toward.y - 130 },
        ];
        expect(Math.abs(u.x * v.y - u.y * v.x) / Math.hypot(v.x, v.y)).toBeLessThan(1e-6);
        expect(u.x * v.x + u.y * v.y).toBeGreaterThan(0);
      }),
    );
    // moving the other end re-projects: a diamond's tip toward the top, the box's edge without a definition
    near(resolveAnchor(shapeAnchorTarget(t, diamond), { kind: 'floating' }, { x: 150, y: -500 }).point, { x: 150, y: 100 });
    near(resolveAnchor(shapeAnchorTarget(t, undefined), { kind: 'floating' }, { x: 150, y: 500 }).point, { x: 150, y: 160 });
    // auto floats until FR-ANC-004; an unknown name floats too
    near(resolveAnchor(target, { kind: 'auto' }, { x: -500, y: 130 }).point, { x: 100, y: 130 });
    near(resolveAnchor(target, { kind: 'named', name: 'nope' }, { x: -500, y: 130 }).point, { x: 100, y: 130 });
  });

  it('FR-ANC-001: a floating anchor on a degenerate or undrawable element stays at its centre', () => {
    // zero size: the box is its centre
    near(resolveAnchor(shapeAnchorTarget({ x: 10, y: 20, w: 0, h: 0 }, ellipse), { kind: 'floating' }, { x: 99, y: 99 }).point, { x: 10, y: 20 });
    // toward its own centre: the nearest outline point, no direction
    const box = shapeAnchorTarget({ x: 0, y: 0, w: 100, h: 60 }, undefined);
    const still = resolveAnchor(box, { kind: 'floating' }, { x: 50, y: 30 });
    expect(still.dir).toBeUndefined();
    expect(still.point.y === 0 || still.point.y === 60 || still.point.x === 0 || still.point.x === 100).toBe(true);
    // the box's corner is where its edges end: a ray out through the right edge meets nothing above it
    near(resolveAnchor(box, { kind: 'floating' }, { x: 150, y: -20 }).point, { x: 100, y: 5 });
    // the element's params shape its outline: straight up from the centre, a triangle with its apex at a quarter meets its right edge
    const triangle = {
      id: 'test:triangle',
      params: { apex: { type: 'number', min: 0, max: 1, default: 0.5 } },
      outline: { path: 'M {w * apex} 0 L {w} {h} L 0 {h} Z' },
      defaultSize: { w: 100, h: 60 },
    } as ShapeDef;
    const up = (params: { readonly apex?: number }) =>
      resolveAnchor(shapeAnchorTarget({ x: 0, y: 0, w: 100, h: 60 }, triangle, { params }), { kind: 'floating' }, { x: 50, y: -500 }).point;
    near(up({ apex: 0.25 }), { x: 50, y: 20 });
    near(up({}), { x: 50, y: 0 });
    // an outline that does not evaluate falls back to the box
    const broken = { id: 'test:broken', outline: { path: 'M 0 0 L {nope} 0' }, defaultSize: { w: 1, h: 1 } } as ShapeDef;
    expect(shapeAnchorTarget({ x: 0, y: 0, w: 10, h: 10 }, broken).outline).toBeUndefined();
    // an empty outline: the centre
    const empty: AnchorTarget = { transform: { x: 0, y: 0, w: 10, h: 10 }, outline: { segments: [], closed: false }, anchors: [] };
    near(resolveAnchor(empty, { kind: 'floating' }, { x: 99, y: 5 }).point, { x: 5, y: 5 });
  });
});

describe('named, side and point anchors (FR-ANC-002)', () => {
  it('FR-ANC-002: an n-bound endpoint stays at top-middle under resize and rotation', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -500, max: 500, noNaN: true }),
          y: fc.double({ min: -500, max: 500, noNaN: true }),
          w: fc.double({ min: 1, max: 800, noNaN: true }),
          h: fc.double({ min: 1, max: 800, noNaN: true }),
          rot: fc.double({ min: -360, max: 360, noNaN: true }),
          flipX: fc.boolean(),
          flipY: fc.boolean(),
        }),
        (t) => {
          const { point, dir } = resolveAnchor(shapeAnchorTarget(t, ellipse), { kind: 'named', name: 'n' }, { x: 0, y: 0 });
          const m = elementMatrix(t);
          near(point, apply(m, { x: t.w / 2, y: 0 }), 4);
          // it leaves away from the top edge
          const up = apply(m, { x: t.w / 2, y: -1 });
          near(dir, { x: up.x - point.x, y: up.y - point.y }, 4);
        },
      ),
    );
  });

  it('FR-ANC-002: the default anchors are the side midpoints and the centre; instance and definition anchors come first', () => {
    const t = { x: 0, y: 0, w: 100, h: 60 };
    const at = (target: AnchorTarget, name: string) => resolveAnchor(target, { kind: 'named', name }, { x: 999, y: 999 });
    const plain = shapeAnchorTarget(t, undefined);
    expect(DEFAULT_ANCHORS.map((a) => a.name)).toEqual(['n', 'e', 's', 'w', 'center']);
    expect(at(plain, 'e')).toEqual({ point: { x: 100, y: 30 }, dir: { x: 1, y: 0 } });
    expect(at(plain, 's')).toEqual({ point: { x: 50, y: 60 }, dir: { x: 0, y: 1 } });
    expect(at(plain, 'w')).toEqual({ point: { x: 0, y: 30 }, dir: { x: -1, y: 0 } });
    expect(at(plain, 'center')).toEqual({ point: { x: 50, y: 30 }, dir: undefined });
    // the definition's anchors, then the instance's override them by name
    const def = {
      ...ellipse,
      anchors: [
        { name: 'port', x: 0.25, y: 1, dir: { x: 0, y: 2 } },
        { name: 'n', x: 0, y: 0 },
      ],
    } as ShapeDef;
    near(at(shapeAnchorTarget(t, def), 'port').point, { x: 25, y: 60 });
    near(at(shapeAnchorTarget(t, def), 'port').dir, { x: 0, y: 1 });
    near(at(shapeAnchorTarget(t, def), 'n').point, { x: 0, y: 0 });
    const inst = shapeAnchorTarget(t, def, { anchors: [{ name: 'port', x: 1, y: 1 }] });
    expect(at(inst, 'port')).toEqual({ point: { x: 100, y: 60 }, dir: undefined });
    // a zero direction has none
    expect(at(shapeAnchorTarget(t, undefined, { anchors: [{ name: 'z', x: 0, y: 0, dir: { x: 0, y: 0 } }] }), 'z').dir).toBeUndefined();
  });

  it('FR-ANC-002: side anchors sit along their side (middle by default), point anchors inside the box', () => {
    const target = shapeAnchorTarget({ x: 10, y: 20, w: 100, h: 60 }, ellipse);
    const toward = { x: 0, y: 0 };
    expect(resolveAnchor(target, { kind: 'side', side: 'n', t: 0.25 }, toward)).toEqual({ point: { x: 35, y: 20 }, dir: { x: 0, y: -1 } });
    expect(resolveAnchor(target, { kind: 'side', side: 'e' }, toward)).toEqual({ point: { x: 110, y: 50 }, dir: { x: 1, y: 0 } });
    expect(resolveAnchor(target, { kind: 'side', side: 's', t: 1 }, toward)).toEqual({ point: { x: 110, y: 80 }, dir: { x: 0, y: 1 } });
    expect(resolveAnchor(target, { kind: 'side', side: 'w', t: 0 }, toward)).toEqual({ point: { x: 10, y: 20 }, dir: { x: -1, y: 0 } });
    expect(resolveAnchor(target, { kind: 'point', x: 0.1, y: 0.5 }, toward)).toEqual({ point: { x: 20, y: 50 }, dir: undefined });
  });
});
