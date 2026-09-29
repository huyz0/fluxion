import { type Path, type PathCommand, pathFromCommands } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { hitTestShape, outlineDistance, projectToOutline } from './hit.js';

const path = (cmds: PathCommand[]): Path => {
  const r = pathFromCommands(cmds);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const rect = path([
  { kind: 'M', to: { x: 0, y: 0 } },
  { kind: 'L', to: { x: 100, y: 0 } },
  { kind: 'L', to: { x: 100, y: 50 } },
  { kind: 'L', to: { x: 0, y: 50 } },
  { kind: 'Z' },
]);
const line = path([
  { kind: 'M', to: { x: 0, y: 10 } },
  { kind: 'L', to: { x: 100, y: 10 } },
]);
// a concave "U": a ray from its middle towards the top crosses the notch before the outer edge
const cup = path([
  { kind: 'M', to: { x: 0, y: 0 } },
  { kind: 'L', to: { x: 30, y: 0 } },
  { kind: 'L', to: { x: 30, y: 60 } },
  { kind: 'L', to: { x: 70, y: 60 } },
  { kind: 'L', to: { x: 70, y: 0 } },
  { kind: 'L', to: { x: 100, y: 0 } },
  { kind: 'L', to: { x: 100, y: 100 } },
  { kind: 'L', to: { x: 0, y: 100 } },
  { kind: 'Z' },
]);
const empty: Path = { segments: [], closed: false };
const round = (p: { x: number; y: number } | null) => (p === null ? null : { x: Math.round(p.x * 1e9) / 1e9, y: Math.round(p.y * 1e9) / 1e9 });

describe('hit-testing and projection over an outline (FR-SHP-005)', () => {
  it('FR-SHP-005: a closed outline hits inside and within the tolerance of its edge; an open one only near its stroke', () => {
    expect(hitTestShape(rect, { x: 50, y: 25 })).toBe(true);
    expect(hitTestShape(rect, { x: 101, y: 25 })).toBe(false);
    expect(hitTestShape(rect, { x: 101, y: 25 }, 1)).toBe(true);
    expect(hitTestShape(rect, { x: 101, y: 25 }, 0.99)).toBe(false);
    expect(hitTestShape(cup, { x: 50, y: 30 })).toBe(false);
    expect(hitTestShape(cup, { x: 50, y: 80 })).toBe(true);
    // an open outline has no inside
    expect(hitTestShape(line, { x: 50, y: 10 }, 0.5)).toBe(true);
    expect(hitTestShape(line, { x: 50, y: 13 }, 3)).toBe(true);
    expect(hitTestShape(line, { x: 50, y: 13 }, 2.9)).toBe(false);
    expect(hitTestShape(line, { x: 50, y: 11 })).toBe(false);
    expect(hitTestShape(empty, { x: 0, y: 0 }, 1e9)).toBe(false);
    expect(outlineDistance(rect, { x: 50, y: 60 })).toBeCloseTo(10, 9);
    expect(outlineDistance(empty, { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('FR-SHP-005: projection lands on the outline where the ray from a point last crosses it', () => {
    const centre = { x: 50, y: 25 };
    expect(round(projectToOutline(rect, centre, { x: 1, y: 0 }))).toEqual({ x: 100, y: 25 });
    expect(round(projectToOutline(rect, centre, { x: 0, y: -3 }))).toEqual({ x: 50, y: 0 });
    expect(round(projectToOutline(rect, centre, { x: -2, y: 1 }))).toEqual({ x: 0, y: 50 });
    // from under the notch upwards: the ray leaves the solid at the notch floor, the only crossing
    expect(round(projectToOutline(cup, { x: 50, y: 80 }, { x: 0, y: -1 }))).toEqual({ x: 50, y: 60 });
    // from below the cup upwards, through the bottom and the notch floor: the last crossing
    expect(round(projectToOutline(cup, { x: 15, y: 150 }, { x: 0, y: -1 }))).toEqual({ x: 15, y: 0 });
    // a ray that misses, a zero or non-finite direction: the nearest point of the outline
    expect(round(projectToOutline(rect, { x: 150, y: 25 }, { x: 1, y: 0 }))).toEqual({ x: 100, y: 25 });
    expect(round(projectToOutline(rect, { x: 50, y: 20 }, { x: 0, y: 0 }))).toEqual({ x: 50, y: 0 });
    expect(round(projectToOutline(rect, { x: 50, y: 20 }, { x: Number.NaN, y: 1 }))).toEqual({ x: 50, y: 0 });
    // an open outline is crossed where the ray meets it
    expect(round(projectToOutline(line, { x: 30, y: 40 }, { x: 0, y: -1 }))).toEqual({ x: 30, y: 10 });
    expect(projectToOutline(empty, centre, { x: 1, y: 0 })).toBeNull();
    // far from the outline, the ray still reaches it
    expect(round(projectToOutline(rect, { x: -5000, y: 25 }, { x: 1, y: 0 }))).toEqual({ x: 100, y: 25 });
    for (let k = 0; k < 16; k++) {
      const a = (2 * Math.PI * k) / 16;
      const p = projectToOutline(cup, { x: 50, y: 80 }, { x: Math.cos(a), y: Math.sin(a) });
      expect(p === null ? -1 : outlineDistance(cup, p)).toBeLessThan(1e-9);
    }
  });
});

describe('projection edge cases', () => {
  it('reaches an outline far from the ray start, and picks the farthest crossing whatever the order found', () => {
    const far = path([
      { kind: 'M', to: { x: 1000, y: 1000 } },
      { kind: 'L', to: { x: 1100, y: 1000 } },
      { kind: 'L', to: { x: 1100, y: 1050 } },
      { kind: 'L', to: { x: 1000, y: 1050 } },
      { kind: 'Z' },
    ]);
    // from beyond the box on the other side of the origin: the ray must be long enough to get there
    expect(round(projectToOutline(far, { x: -1000, y: 1025 }, { x: 1, y: 0 }))).toEqual({ x: 1100, y: 1025 });
    expect(round(projectToOutline(far, { x: 1050, y: -1000 }, { x: 0, y: 1 }))).toEqual({ x: 1050, y: 1050 });
    // leftwards through the cup: four crossings, the farthest is the left outer edge
    expect(round(projectToOutline(cup, { x: 150, y: 30 }, { x: -1, y: 0 }))).toEqual({ x: 0, y: 30 });
    expect(round(projectToOutline(cup, { x: 50, y: -30 }, { x: 0, y: 1 }))).toEqual({ x: 50, y: 100 });
    // a ray along an edge overlaps it without crossing: its far end (M5.12 review F1)
    expect(round(projectToOutline(line, { x: 80, y: 10 }, { x: 1, y: 0 }))).toEqual({ x: 100, y: 10 });
    expect(round(projectToOutline(line, { x: 80, y: 10 }, { x: -1, y: 0 }))).toEqual({ x: 0, y: 10 });
    expect(round(projectToOutline(rect, { x: 30, y: 0 }, { x: 1, y: 0 }))).toEqual({ x: 100, y: 0 });
    // along a diagonal edge, with a direction of any length
    const diagonal = path([
      { kind: 'M', to: { x: 10, y: 10 } },
      { kind: 'L', to: { x: 90, y: 90 } },
    ]);
    expect(round(projectToOutline(diagonal, { x: 50, y: 50 }, { x: 3, y: 3 }))).toEqual({ x: 90, y: 90 });
    expect(round(projectToOutline(diagonal, { x: 50, y: 50 }, { x: -0.5, y: -0.5 }))).toEqual({ x: 10, y: 10 });
    expect(round(projectToOutline(diagonal, { x: 30, y: 30 }, { x: 2, y: 2 }))).toEqual({ x: 90, y: 90 });
    // a very short direction still casts a ray that leaves the box
    expect(round(projectToOutline(rect, { x: 50, y: 25 }, { x: 0.001, y: 0 }))).toEqual({ x: 100, y: 25 });
    expect(round(projectToOutline(rect, { x: 50, y: 25 }, { x: 0, y: 0.001 }))).toEqual({ x: 50, y: 50 });
    // a joint behind the start never wins over the nearest point: past the end of a slanted edge
    const wedge = path([
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: 100, y: 0 } },
      { kind: 'L', to: { x: 140, y: 20 } },
      { kind: 'L', to: { x: 0, y: 20 } },
      { kind: 'Z' },
    ]);
    const past = projectToOutline(wedge, { x: 150, y: 0 }, { x: 1, y: 0 });
    expect(past?.x).toBeCloseTo(140, 6);
    expect(past?.y).toBeCloseTo(20, 6);
    // joints behind the start, or off the ray, do not count
    expect(round(projectToOutline(line, { x: 100, y: 10 }, { x: 1, y: 0 }))).toEqual({ x: 100, y: 10 });
    expect(round(projectToOutline(line, { x: 50, y: 10.001 }, { x: 1, y: 0 }))).toEqual({ x: 50, y: 10 });
  });
});
