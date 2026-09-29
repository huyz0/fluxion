import type { PathCommand, Vec2 } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { catmullRom } from './smooth.js';

const box = { w: 100, h: 100 };
type Cubic = Extract<PathCommand, { kind: 'C' }>;
const cubics = (cmds: PathCommand[]) => cmds.filter((c): c is Cubic => c.kind === 'C');

/** The tangent at the middle vertex `p` of an open curve a → p → b, read on both of its sides. */
function middle(a: Vec2, p: Vec2, b: Vec2): { readonly after: Vec2; readonly before: Vec2 } {
  const [into, out] = cubics(catmullRom([a, p, b], false, box));
  return {
    after: { x: (out?.control1.x ?? 0) - p.x, y: (out?.control1.y ?? 0) - p.y },
    before: { x: p.x - (into?.control2.x ?? 0), y: p.y - (into?.control2.y ?? 0) },
  };
}
const r = (v: Vec2) => ({ x: Math.round(v.x * 1e9) / 1e9, y: Math.round(v.y * 1e9) / 1e9 });

describe('smooth points outlines (ADR-0016, M5.11 review F1)', () => {
  it('FR-SHP-003: one tangent per vertex, (next - previous) / 6, fitted to the box', () => {
    const cases: [string, Vec2, Vec2, Vec2, Vec2][] = [
      // name, previous, vertex, next, expected tangent
      ['inside: the full tangent', { x: 20, y: 40 }, { x: 50, y: 50 }, { x: 80, y: 60 }, { x: 10, y: 20 / 6 }],
      ['right edge, pointing out: along the edge', { x: 70, y: 40 }, { x: 100, y: 50 }, { x: 94, y: 60 }, { x: 0, y: 20 / 6 }],
      ['right edge, pointing in: out on the other side', { x: 94, y: 40 }, { x: 100, y: 50 }, { x: 70, y: 60 }, { x: 0, y: 20 / 6 }],
      ['left edge, pointing in', { x: 30, y: 40 }, { x: 0, y: 50 }, { x: 6, y: 60 }, { x: 0, y: 20 / 6 }],
      ['left edge, pointing out', { x: 6, y: 40 }, { x: 0, y: 50 }, { x: 30, y: 60 }, { x: 0, y: 20 / 6 }],
      ['top edge', { x: 40, y: 30 }, { x: 50, y: 0 }, { x: 60, y: 6 }, { x: 20 / 6, y: 0 }],
      ['bottom edge', { x: 40, y: 94 }, { x: 50, y: 100 }, { x: 60, y: 70 }, { x: 20 / 6, y: 0 }],
      ['near the right: scaled by what is left ahead', { x: 40, y: 50 }, { x: 95, y: 50 }, { x: 100, y: 50 }, { x: 5, y: 0 }],
      ['near the left: scaled by what is left ahead', { x: 60, y: 50 }, { x: 5, y: 50 }, { x: 0, y: 50 }, { x: -5, y: 0 }],
      ['near the left: scaled by what is left behind', { x: 0, y: 50 }, { x: 5, y: 50 }, { x: 60, y: 50 }, { x: 5, y: 0 }],
      ['near the right: scaled by what is left behind', { x: 100, y: 50 }, { x: 95, y: 50 }, { x: 40, y: 50 }, { x: -5, y: 0 }],
      ['near the bottom: both axes scaled alike', { x: 20, y: 40 }, { x: 50, y: 95 }, { x: 80, y: 100 }, { x: 5, y: 5 }],
    ];
    for (const [name, a, p, b, want] of cases) {
      const t = middle(a, p, b);
      expect(r(t.after), name).toEqual(r(want));
      expect(r(t.before), name).toEqual(r(want));
    }
  });

  it('FR-SHP-003: an open end places its tangent on one side only; a closed curve on both', () => {
    // the first vertex on the left edge, pointing in: kept whole (nothing is placed before it)
    const [first] = cubics(
      catmullRom(
        [
          { x: 0, y: 50 },
          { x: 60, y: 50 },
        ],
        false,
        box,
      ),
    );
    expect(first?.control1).toEqual({ x: 10, y: 50 });
    // the last vertex on the right edge, the tangent pointing out: nothing is placed after it
    expect(first?.control2).toEqual({ x: 50, y: 50 });
    const [, end] = cubics(
      catmullRom(
        [
          { x: 0, y: 50 },
          { x: 40, y: 50 },
          { x: 100, y: 50 },
        ],
        false,
        box,
      ),
    );
    expect(end?.control2).toEqual({ x: 90, y: 50 });
    // ends on an edge whose tangent points into the box keep it: the first on the right edge, the last on the left
    const inwards = (pts: Vec2[]) => cubics(catmullRom(pts, false, box));
    expect(
      inwards([
        { x: 100, y: 50 },
        { x: 40, y: 50 },
      ])[0]?.control1,
    ).toEqual({ x: 90, y: 50 });
    expect(
      inwards([
        { x: 100, y: 40 },
        { x: 60, y: 50 },
        { x: 0, y: 50 },
      ])[1]?.control2,
    ).toEqual({ x: 10, y: 50 });
    // closed: the tangent at (5, 50) is (P1 - P2) / 6 = (10, -10/6), scaled to fit behind: (5, -5/6)
    const ring = cubics(
      catmullRom(
        [
          { x: 5, y: 50 },
          { x: 60, y: 50 },
          { x: 0, y: 60 },
        ],
        true,
        box,
      ),
    );
    expect(r({ x: 5 - (ring[2]?.control2.x ?? 0), y: 50 - (ring[2]?.control2.y ?? 0) })).toEqual(r({ x: 5, y: -5 / 6 }));
    // closed: the tangent at (95, 50) is (P1 - P2) / 6 = (10, 20/6), scaled to fit ahead: (5, 10/6)
    const loop = cubics(
      catmullRom(
        [
          { x: 95, y: 50 },
          { x: 100, y: 60 },
          { x: 40, y: 40 },
        ],
        true,
        box,
      ),
    );
    expect(loop).toHaveLength(3);
    expect(r({ x: (loop[0]?.control1.x ?? 0) - 95, y: (loop[0]?.control1.y ?? 0) - 50 })).toEqual(r({ x: 5, y: 10 / 6 }));
    expect(r({ x: 95 - (loop[2]?.control2.x ?? 0), y: 50 - (loop[2]?.control2.y ?? 0) })).toEqual(r({ x: 5, y: 10 / 6 }));
  });
});
