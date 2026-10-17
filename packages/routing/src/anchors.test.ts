import type { ShapeDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { AnchorDef, Transform } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { resolveAnchor, shapeAnchorTarget } from './anchor.js';

const near = (a: Vec2 | undefined, b: Vec2 | undefined) => {
  if (b === undefined) return expect(a).toBeUndefined();
  expect(a?.x).toBeCloseTo(b.x, 6);
  expect(a?.y).toBeCloseTo(b.y, 6);
};

const ellipse = {
  id: 'test:ellipse',
  outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 1 1 {w} {h/2} A {w/2} {h/2} 0 1 1 0 {h/2} Z' },
  defaultSize: { w: 100, h: 60 },
} as ShapeDef;

// a 100 x 60 box at (100, 100): centre (150, 130)
const placed: Transform = { x: 100, y: 100, w: 100, h: 60 };
const target = (anchors: readonly AnchorDef[], t = placed, def?: ShapeDef) => shapeAnchorTarget(t, def, { anchors });
const resolve = (def: AnchorDef, toward: Vec2, t = placed, shape?: ShapeDef) =>
  resolveAnchor(target([def], t, shape), { kind: 'named', name: def.name }, toward);

describe('anchor kinds (FR-ANC-003)', () => {
  it('FR-ANC-003: a fixed anchor (and a def without kind) resolves to its point with its declared direction', () => {
    for (const kind of [undefined, 'fixed'] as const) {
      const r = resolve({ name: 'a', ...(kind === undefined ? {} : { kind }), x: 0.25, y: 1, dir: { x: 0, y: 1 } }, { x: 0, y: 0 });
      near(r.point, { x: 125, y: 160 });
      near(r.dir, { x: 0, y: 1 });
    }
    // no declared direction: none
    near(resolve({ name: 'a', x: 0, y: 0 }, { x: 0, y: 0 }).dir, undefined);
  });

  it("FR-ANC-003: a side anchor is the point at t along its side (default the middle), leaving along the side's outward normal", () => {
    const cases: readonly [AnchorDef, Vec2, Vec2][] = [
      [
        { name: 'a', kind: 'side', side: 'n' },
        { x: 150, y: 100 },
        { x: 0, y: -1 },
      ],
      [
        { name: 'a', kind: 'side', side: 'e', t: 0.25 },
        { x: 200, y: 115 },
        { x: 1, y: 0 },
      ],
      [
        { name: 'a', kind: 'side', side: 's', t: 1 },
        { x: 200, y: 160 },
        { x: 0, y: 1 },
      ],
      [
        { name: 'a', kind: 'side', side: 'w', t: 0 },
        { x: 100, y: 100 },
        { x: -1, y: 0 },
      ],
    ];
    for (const [def, point, dir] of cases) {
      const r = resolve(def, { x: 900, y: 900 });
      near(r.point, point);
      near(r.dir, dir);
    }
    // it follows a rotation: the north side of a box turned a quarter leaves to the right
    const turned = resolve({ name: 'a', kind: 'side', side: 'n' }, { x: 0, y: 0 }, { ...placed, rot: 90 });
    near(turned.point, { x: 180, y: 130 });
    near(turned.dir, { x: 1, y: 0 });
  });

  it('FR-ANC-003: a center anchor is the box centre, leaving toward the other end', () => {
    const r = resolve({ name: 'a', kind: 'center' }, { x: 550, y: 130 });
    near(r.point, { x: 150, y: 130 });
    near(r.dir, { x: 1, y: 0 });
    near(resolve({ name: 'a', kind: 'center' }, { x: 150, y: -70 }).dir, { x: 0, y: -1 });
    // the other end at the centre: no direction
    near(resolve({ name: 'a', kind: 'center' }, { x: 150, y: 130 }).dir, undefined);
  });

  it('FR-ANC-003: a perimeter anchor without t floats: the outline point on the ray from the centre toward the other end', () => {
    const box = resolve({ name: 'a', kind: 'perimeter' }, { x: 550, y: 130 });
    near(box.point, { x: 200, y: 130 });
    near(box.dir, { x: 1, y: 0 });
    // an ellipse's outline, not its box
    near(resolve({ name: 'a', kind: 'perimeter' }, { x: 150, y: 900 }, placed, ellipse).point, { x: 150, y: 160 });
    near(resolve({ name: 'a', kind: 'perimeter' }, { x: -500, y: 130 }, placed, ellipse).point, { x: 100, y: 130 });
  });

  it('FR-ANC-003: a perimeter anchor with t is pinned at that fraction of the outline length, whatever the other end', () => {
    // the box outline starts at the top-left and runs clockwise: perimeter 320, so t = 0.15625 is 50 along the top edge
    for (const toward of [
      { x: 0, y: 0 },
      { x: 900, y: 900 },
    ]) {
      const top = resolve({ name: 'a', kind: 'perimeter', t: 0.15625 }, toward);
      near(top.point, { x: 150, y: 100 });
      near(top.dir, { x: 0, y: -1 });
    }
    // 100 + 60 + 50 = 210 of 320: halfway along the bottom edge, facing down
    const bottom = resolve({ name: 'a', kind: 'perimeter', t: 210 / 320 }, { x: 0, y: 0 });
    near(bottom.point, { x: 150, y: 160 });
    near(bottom.dir, { x: 0, y: 1 });
    // 100 + 30 of 320: the middle of the right edge
    const right = resolve({ name: 'a', kind: 'perimeter', t: 130 / 320 }, { x: 0, y: 0 });
    near(right.point, { x: 200, y: 130 });
    near(right.dir, { x: 1, y: 0 });
  });

  it('FR-ANC-003: an anchor that lacks what its kind needs floats, and an unknown kind reads as fixed', () => {
    const toward = { x: 550, y: 130 };
    near(resolve({ name: 'a', kind: 'side' }, toward).point, { x: 200, y: 130 });
    near(resolve({ name: 'a' }, toward).point, { x: 200, y: 130 });
    near(resolve({ name: 'a', kind: 'bogus' as never, x: 0, y: 0 }, toward).point, { x: 100, y: 100 });
  });
});
