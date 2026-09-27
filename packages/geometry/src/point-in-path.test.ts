import { describe, expect, it } from 'vitest';
import { type Path, type PathCommand, pathFromCommands, pointAt } from './path.js';
import { pointInPath } from './point-in-path.js';

function polygon(points: readonly [number, number][], isClosed = true): Path {
  const [first, ...rest] = points.map(([x, y]) => ({ x, y }));
  const cmds: PathCommand[] = [{ kind: 'M', to: first ?? { x: 0, y: 0 } }, ...rest.map((to): PathCommand => ({ kind: 'L', to }))];
  const result = pathFromCommands(isClosed ? [...cmds, { kind: 'Z' }] : cmds);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('pointInPath', () => {
  const square = polygon([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);

  it('FR-CON-001: classifies points against a square', () => {
    expect(pointInPath(square, { x: 5, y: 5 })).toBe(true);
    expect(pointInPath(square, { x: 15, y: 5 })).toBe(false);
    expect(pointInPath(square, { x: -1, y: 5 })).toBe(false);
    expect(pointInPath(square, { x: 5, y: 11 })).toBe(false);
    expect(pointInPath(square, { x: 5, y: 5 }, 'evenodd')).toBe(true);
  });

  it('FR-CON-001: classifies points against a concave (U-shaped) outline', () => {
    const u = polygon([
      [0, 0],
      [3, 0],
      [3, 7],
      [7, 7],
      [7, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(pointInPath(u, { x: 1, y: 5 })).toBe(true);
    expect(pointInPath(u, { x: 5, y: 3 })).toBe(false); // inside the notch
    expect(pointInPath(u, { x: 5, y: 9 })).toBe(true);
    expect(pointInPath(u, { x: 8.5, y: 3 }, 'evenodd')).toBe(true);
  });

  it('treats an open path as closed back to its start', () => {
    const open = polygon(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      false,
    );
    expect(pointInPath(open, { x: 5, y: 5 })).toBe(true);
  });

  it('FR-CON-001: nonzero and evenodd differ inside a doubly wound region', () => {
    // two overlapping squares wound the same way: the overlap has winding 2
    const doubled = polygon([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
      [4, 4],
      [14, 4],
      [14, 14],
      [4, 14],
      [4, 4],
    ]);
    expect(pointInPath(doubled, { x: 7, y: 7 }, 'nonzero')).toBe(true);
    expect(pointInPath(doubled, { x: 7, y: 7 }, 'evenodd')).toBe(false);
    expect(pointInPath(doubled, { x: 2, y: 2 }, 'evenodd')).toBe(true);
  });

  it('follows curved edges', () => {
    const result = pathFromCommands([
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'C', control1: { x: 0, y: 20 }, control2: { x: 20, y: 20 }, to: { x: 20, y: 0 } },
      { kind: 'Z' },
    ]);
    if (!result.ok) throw new Error(result.error.message);
    expect(pointInPath(result.value, { x: 10, y: 14 })).toBe(true); // curve peaks at y = 15
    expect(pointInPath(result.value, { x: 10, y: 16 })).toBe(false);
  });

  it('an empty path contains nothing', () => {
    expect(pointInPath({ segments: [], closed: false }, { x: 0, y: 0 })).toBe(false);
  });

  it('FR-CON-001: a large circle classifies points just inside and outside its rim (M2.16 review F2)', () => {
    const r = 1000;
    const k = 0.5522847498307936 * r;
    const result = pathFromCommands([
      { kind: 'M', to: { x: r, y: 0 } },
      { kind: 'C', control1: { x: r, y: k }, control2: { x: k, y: r }, to: { x: 0, y: r } },
      { kind: 'C', control1: { x: -k, y: r }, control2: { x: -r, y: k }, to: { x: -r, y: 0 } },
      { kind: 'C', control1: { x: -r, y: -k }, control2: { x: -k, y: -r }, to: { x: 0, y: -r } },
      { kind: 'C', control1: { x: k, y: -r }, control2: { x: r, y: -k }, to: { x: r, y: 0 } },
      { kind: 'Z' },
    ]);
    if (!result.ok) throw new Error(result.error.message);
    const circle = result.value;
    // the cubic circle deviates from the true one by < 0.03 %: compare against the cubic itself,
    // via points 0.05 inside and outside it along its own normal at 200 angles
    for (let i = 0; i < 200; i++) {
      const seg = circle.segments[i % 4];
      if (seg === undefined) continue;
      const on = pointAt(seg, (Math.floor(i / 4) + 0.5) / 50);
      const n = Math.hypot(on.x, on.y);
      expect(pointInPath(circle, { x: on.x * (1 - 0.05 / n), y: on.y * (1 - 0.05 / n) }), `inside ${i}`).toBe(true);
      expect(pointInPath(circle, { x: on.x * (1 + 0.05 / n), y: on.y * (1 + 0.05 / n) }), `outside ${i}`).toBe(false);
    }
  });
});
