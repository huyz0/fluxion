import { type CubicSegment, derivativeAt, nearestPoint, type PathCommand, pathFromCommands, type Vec2 } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { trimRoute } from './trim.js';

const unit = (v: Vec2): Vec2 => ({ x: v.x / Math.hypot(v.x, v.y), y: v.y / Math.hypot(v.x, v.y) });
/** Whether `p` lies on `seg` (within a millionth of a pixel). */
const onCurve = (seg: CubicSegment, p: Vec2) => (nearestPoint({ segments: [seg], closed: false }, p)?.distance ?? 1) < 1e-6;
const close = (a: Vec2 | undefined, b: Vec2, digits = 6) => {
  expect(a?.x).toBeCloseTo(b.x, digits);
  expect(a?.y).toBeCloseTo(b.y, digits);
};
const gap = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const endOf = (c: PathCommand | undefined) => (c as { to: Vec2 }).to;

describe('trimming routes under markers (FR-CON-003)', () => {
  it('FR-CON-003: lines are shortened at either end along their direction', () => {
    const elbow: PathCommand[] = [
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: 100, y: 0 } },
      { kind: 'L', to: { x: 100, y: 50 } },
    ];
    expect(trimRoute(elbow, 10, 5)).toEqual({
      commands: [
        { kind: 'M', to: { x: 10, y: 0 } },
        { kind: 'L', to: { x: 100, y: 0 } },
        { kind: 'L', to: { x: 100, y: 45 } },
      ],
      start: 10,
      end: 5,
    });
    expect(trimRoute(elbow, 0, 0)).toEqual({ commands: elbow, start: 0, end: 0 });
    // a trim takes at most half its segment, so the segment keeps its direction (M5.20 review F1)
    expect(trimRoute(elbow, 500, 500)).toEqual({
      commands: [
        { kind: 'M', to: { x: 50, y: 0 } },
        { kind: 'L', to: { x: 100, y: 0 } },
        { kind: 'L', to: { x: 100, y: 25 } },
      ],
      start: 50,
      end: 25,
    });
    // away from the origin: lengths are measured from each segment's own start
    expect(
      trimRoute(
        [
          { kind: 'M', to: { x: 50, y: 40 } },
          { kind: 'L', to: { x: 50, y: 140 } },
          { kind: 'L', to: { x: 150, y: 140 } },
        ],
        10,
        30,
      ).commands,
    ).toEqual([
      { kind: 'M', to: { x: 50, y: 50 } },
      { kind: 'L', to: { x: 50, y: 140 } },
      { kind: 'L', to: { x: 120, y: 140 } },
    ]);
    // one segment trimmed at both ends: the start measures what the end left
    const line: PathCommand[] = [
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: 0, y: 100 } },
    ];
    expect(trimRoute(line, 10, 20)).toEqual({
      commands: [
        { kind: 'M', to: { x: 0, y: 10 } },
        { kind: 'L', to: { x: 0, y: 80 } },
      ],
      start: 10,
      end: 20,
    });
    expect(trimRoute(line, 90, 90)).toEqual({
      commands: [
        { kind: 'M', to: { x: 0, y: 25 } },
        { kind: 'L', to: { x: 0, y: 50 } },
      ],
      start: 25,
      end: 50,
    });
    // nothing to trim: no segment, a zero-length one, or a negative trim
    expect(trimRoute([{ kind: 'M', to: { x: 1, y: 1 } }], 5, 5)).toEqual({ commands: [{ kind: 'M', to: { x: 1, y: 1 } }], start: 0, end: 0 });
    expect(trimRoute([], 5, 5)).toEqual({ commands: [], start: 0, end: 0 });
    const dot: PathCommand[] = [
      { kind: 'M', to: { x: 1, y: 1 } },
      { kind: 'L', to: { x: 1, y: 1 } },
    ];
    expect(trimRoute(dot, 5, 5)).toEqual({ commands: dot, start: 0, end: 0 });
    expect(trimRoute(line, -5, -5)).toEqual({ commands: line, start: 0, end: 0 });
  });

  it('FR-CON-003: curves are split where the trimmed length is reached and keep their shape', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -200, max: 200 }), { minLength: 8, maxLength: 8 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
        (n, start, end) => {
          const [x0, y0, x1, y1, x2, y2, x3, y3] = n as [number, number, number, number, number, number, number, number];
          const seg = { p0: { x: x0, y: y0 }, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, p3: { x: x3, y: y3 } };
          const curve: PathCommand[] = [
            { kind: 'M', to: seg.p0 },
            { kind: 'C', control1: seg.p1, control2: seg.p2, to: seg.p3 },
          ];
          fc.pre(gap(seg.p0, seg.p3) > 4 * (start + end) + 1);
          const trimmed = trimRoute(curve, start, end);
          expect([trimmed.start, trimmed.end]).toEqual([start, end]);
          const [s0, cut] = [endOf(trimmed.commands[0]), trimmed.commands[1] as Extract<PathCommand, { kind: 'C' }>];
          // each new end is the trim's straight distance from the old one (review F2) ...
          expect(Math.abs(gap(s0, seg.p0) - start)).toBeLessThan(1e-6);
          expect(Math.abs(gap(cut.to, seg.p3) - end)).toBeLessThan(1e-6);
          // ... on the original curve ...
          expect(onCurve(seg, s0) && onCurve(seg, cut.to)).toBe(true);
          // ... and the cut ends' tangents point at the old ends, where a marker drawn along them reaches
          if (end > 0)
            close(unit(derivativeAt({ p0: s0, p1: cut.control1, p2: cut.control2, p3: cut.to }, 1)), unit({ x: seg.p3.x - cut.to.x, y: seg.p3.y - cut.to.y }));
          if (start > 0)
            close(unit(derivativeAt({ p0: s0, p1: cut.control1, p2: cut.control2, p3: cut.to }, 0)), unit({ x: s0.x - seg.p0.x, y: s0.y - seg.p0.y }));
        },
      ),
    );
    // a quadratic end is raised to a cubic (its controls two thirds toward the quadratic's) and cut on it
    const arch: PathCommand[] = [
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'Q', control: { x: 50, y: 60 }, to: { x: 100, y: 0 } },
    ];
    const quad = trimRoute(arch, 0, 25);
    expect(quad.commands[1]?.kind).toBe('C');
    const raised = { p0: { x: 0, y: 0 }, p1: { x: 100 / 3, y: 40 }, p2: { x: 200 / 3, y: 40 }, p3: { x: 100, y: 0 } };
    expect(onCurve(raised, endOf(quad.commands[1]))).toBe(true);
    expect(gap(endOf(quad.commands[1]), { x: 100, y: 0 })).toBeCloseTo(25, 6);
    // no trim leaves any route exactly as it is, a quadratic included
    const kept: PathCommand[] = [
      { kind: 'M', to: { x: 3, y: 1 } },
      { kind: 'C', control1: { x: 40, y: 90 }, control2: { x: 70, y: -20 }, to: { x: 120, y: 30 } },
    ];
    expect(trimRoute(kept, 0, 0).commands).toEqual(kept);
    expect(trimRoute(arch, 0, 0).commands).toEqual(arch);
    // a longer route: the start trim touches only the first segment, the curve at its end stays whole
    const bend: PathCommand[] = [
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: 100, y: 0 } },
      { kind: 'C', control1: { x: 150, y: 0 }, control2: { x: 200, y: 50 }, to: { x: 200, y: 100 } },
    ];
    expect(trimRoute(bend, 10, 0).commands).toEqual([{ kind: 'M', to: { x: 10, y: 0 } }, bend[1], bend[2]]);
    // a start trim longer than half the curve takes half of it
    const long = trimRoute(
      [
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'C', control1: { x: 10, y: 0 }, control2: { x: 20, y: 0 }, to: { x: 30, y: 0 } },
      ],
      100,
      0,
    );
    expect(long.start).toBeCloseTo(15, 6);
    close(endOf(long.commands[0]), { x: 15, y: 0 }, 6);
    // a trim longer than half the curve takes half of it
    const over = trimRoute(
      [
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'C', control1: { x: 10, y: 0 }, control2: { x: 20, y: 0 }, to: { x: 30, y: 0 } },
      ],
      0,
      100,
    );
    expect(over.end).toBeCloseTo(15, 6);
    close(endOf(over.commands[1]), { x: 15, y: 0 }, 6);
  });
});
