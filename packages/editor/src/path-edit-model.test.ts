import { pointAt } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { type EditPath, handlePoint, insertPoint, moveHandle, pathHandles, readEditPath, removePoint, segmentCubic, writeEditPath } from './path-edit-model.js';

const read = (d: string): EditPath => {
  const p = readEditPath(d);
  if (p === undefined) throw new Error(`does not read: ${d}`);
  return p;
};

describe('the path tool model (FR-SHP-011, ADR-0053)', () => {
  it('FR-SHP-011: reads lines, cubics and quadratics into vertices and segments, and writes them back', () => {
    const square = read('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    expect(square).toEqual([
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        segments: Array(4).fill({ kind: 'L' }),
      },
    ]);
    expect(writeEditPath(square)).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    // a closed subpath whose last segment ends at its start keeps that segment and no repeated vertex
    const drop = read('M 0 0 C 10 0 10 10 0 10 C -10 10 -10 0 0 0 Z');
    expect(drop[0]?.points).toHaveLength(2);
    expect(writeEditPath(drop)).toBe('M 0 0 C 10 0 10 10 0 10 C -10 10 -10 0 0 0 Z');
    // Q is read as the cubic it equals; an open subpath has one segment fewer than vertices; two subpaths stay two
    const q = read('M 0 0 Q 30 30 60 0 M 100 0 L 120 0');
    expect(q[0]?.segments).toEqual([{ kind: 'C', c1: { x: 20, y: 20 }, c2: { x: 40, y: 20 } }]);
    expect(q[1]).toEqual({
      closed: false,
      points: [
        { x: 100, y: 0 },
        { x: 120, y: 0 },
      ],
      segments: [{ kind: 'L' }],
    });
    expect(writeEditPath(q, { x: 0, y: -10 })).toBe('M 0 10 C 20 30 40 30 60 10 M 100 10 L 120 10');
    expect(readEditPath('M 0 0 A 1 1 0 0 1 2 2')).toBeUndefined();
  });

  it('FR-SHP-011: a vertex drags its bezier handles along; a bezier handle moves alone', () => {
    const p = read('M 0 0 C 0 10 10 20 20 20 C 30 20 40 10 40 0');
    const moved = moveHandle(p, { kind: 'vertex', sub: 0, index: 1 }, { x: 20, y: 30 });
    expect(moved[0]?.points[1]).toEqual({ x: 20, y: 30 });
    expect(moved[0]?.segments).toEqual([
      { kind: 'C', c1: { x: 0, y: 10 }, c2: { x: 10, y: 30 } },
      { kind: 'C', c1: { x: 30, y: 30 }, c2: { x: 40, y: 10 } },
    ]);
    const bent = moveHandle(p, { kind: 'c2', sub: 0, index: 0 }, { x: 5, y: 5 });
    expect(handlePoint(bent, { kind: 'c2', sub: 0, index: 0 })).toEqual({ x: 5, y: 5 });
    expect(bent[0]?.points).toEqual(p[0]?.points);
    expect(handlePoint(p, { kind: 'c1', sub: 0, index: 5 })).toBeUndefined();
    // the first vertex of a closed subpath also moves the handle of the segment arriving from the last
    const ring = read('M 0 0 L 20 0 C 20 10 10 20 0 20 C -5 10 -5 5 0 0 Z');
    const turned = moveHandle(ring, { kind: 'vertex', sub: 0, index: 0 }, { x: 2, y: 2 });
    expect(turned[0]?.segments[2]).toEqual({ kind: 'C', c1: { x: -5, y: 10 }, c2: { x: -3, y: 7 } });
    expect(turned[0]?.segments[0]).toEqual({ kind: 'L' });
    expect(pathHandles(ring).map((h) => h.kind)).toEqual(['vertex', 'vertex', 'vertex', 'c1', 'c2', 'c1', 'c2']);
  });

  it('FR-SHP-011: adding a point on a segment keeps the curve; removing one joins its two segments', () => {
    const p = read('M 0 0 C 0 40 40 40 40 0 L 40 -20');
    const added = insertPoint(p, 0, 0, 0.25);
    const s = added[0];
    expect(s?.points).toHaveLength(4);
    expect(s?.points[1]?.x).toBeCloseTo(pointAt(segmentCubic(p[0] as EditPath[number], 0), 0.25).x, 9);
    // the two halves draw the original curve: the half-way point of the second is the original at 0.625
    const original = segmentCubic(p[0] as EditPath[number], 0);
    const second = segmentCubic(s as EditPath[number], 1);
    expect(pointAt(second, 0.5).x).toBeCloseTo(pointAt(original, 0.625).x, 9);
    expect(pointAt(second, 0.5).y).toBeCloseTo(pointAt(original, 0.625).y, 9);
    const line = insertPoint(p, 0, 1, 0.5)[0];
    expect(line?.points[2]).toEqual({ x: 40, y: -10 });
    expect(line?.segments.slice(1)).toEqual([{ kind: 'L' }, { kind: 'L' }]);
    // removing the added vertex joins its segments into one cubic with the outer handles
    const back = removePoint(added, 0, 1)?.[0];
    expect(back?.points).toEqual(p[0]?.points);
    expect(back?.segments[0]).toEqual({
      kind: 'C',
      c1: handlePoint(added, { kind: 'c1', sub: 0, index: 0 }),
      c2: handlePoint(added, { kind: 'c2', sub: 0, index: 1 }),
    });
    // an end of an open subpath drops its segment
    expect(removePoint(p, 0, 2)?.[0]).toEqual({ closed: false, points: p[0]?.points.slice(0, 2), segments: p[0]?.segments.slice(0, 1) });
    expect(removePoint(p, 0, 0)?.[0]?.segments).toEqual([{ kind: 'L' }]);
  });

  it('FR-SHP-011: removing a closed subpath’s first vertex joins the last segment to the second vertex; too few vertices refuse', () => {
    const square = read('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    const three = removePoint(square, 0, 0);
    expect(three?.[0]?.points).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(writeEditPath(three as EditPath)).toBe('M 10 0 L 10 10 L 0 10 Z');
    expect(removePoint(three as EditPath, 0, 1)).toBeUndefined();
    expect(removePoint(read('M 0 0 L 10 0'), 0, 0)).toBeUndefined();
    expect(removePoint(square, 1, 0)).toBeUndefined();
    expect(removePoint(square, 0, 9)).toBeUndefined();
  });
});
