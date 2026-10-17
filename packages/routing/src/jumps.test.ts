import type { PathCommand, Vec2 } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { createJumpCache, findJumps, hopPath, type JumpRoute } from './jumps.js';

const route = (id: string, z: number, pts: [number, number][], extra: Partial<JumpRoute> = {}): JumpRoute => ({
  id,
  z,
  revision: '1',
  points: pts.map(([x, y]) => ({ x, y })),
  ...extra,
});
const h = route('h', 1, [
  [0, 50],
  [100, 50],
]);
const v = route('v', 2, [
  [40, 0],
  [40, 100],
]);

describe('line jumps (FR-CON-008)', () => {
  it('FR-CON-008: the connector later in z-order hops over the other', () => {
    const jumps = findJumps([h, v]);
    expect([...jumps.keys()]).toEqual(['v']);
    expect(jumps.get('v')).toEqual([{ at: { x: 40, y: 50 }, segment: 0 }]);
    expect([...findJumps([{ ...h, z: 3 }, v]).keys()]).toEqual(['h']);
  });

  it('FR-CON-008: equal z falls back to the later id, and a style of none opts a connector out', () => {
    expect([
      ...findJumps([
        { ...h, z: 0 },
        { ...v, z: 0 },
      ]).keys(),
    ]).toEqual(['v']);
    expect(findJumps([h, { ...v, style: 'none' }]).size).toBe(0);
    expect(findJumps([h, v], 'none').size).toBe(0);
    expect(findJumps([h, { ...v, style: 'arc' }], 'none').size).toBe(1);
  });

  it('FR-CON-008: an arc hop crests a radius above the line', () => {
    const cmds = hopPath(v.points, findJumps([h, v]).get('v') ?? [], 'arc', 6);
    const curve = cmds.find((c) => c.kind === 'C') as Extract<PathCommand, { kind: 'C' }>;
    expect(curve.control1.x).toBeCloseTo(40 + 8);
    expect(curve.to).toEqual({ x: 40, y: 56 });
    expect(cmds[1]).toEqual({ kind: 'L', to: { x: 40, y: 44 } });
    // the hop bulges the same way whichever way the line runs
    const back = hopPath([...v.points].reverse(), [{ at: { x: 40, y: 50 }, segment: 0 }]);
    expect((back.find((c) => c.kind === 'C') as Extract<PathCommand, { kind: 'C' }>).control1.x).toBeCloseTo(48);
  });

  it('FR-CON-008: a gap hop leaves the line and restarts after it', () => {
    const cmds = hopPath(h.points, [{ at: { x: 40, y: 50 }, segment: 0 }], 'gap', 5);
    expect(cmds).toEqual([
      { kind: 'M', to: { x: 0, y: 50 } },
      { kind: 'L', to: { x: 35, y: 50 } },
      { kind: 'M', to: { x: 45, y: 50 } },
      { kind: 'L', to: { x: 100, y: 50 } },
    ]);
  });

  it('FR-CON-008: a crossing too near a corner or the previous hop is not hopped', () => {
    const near = (x: number) => ({ at: { x, y: 50 } as Vec2, segment: 0 });
    const count = (jumps: ReturnType<typeof near>[]) => hopPath(h.points, jumps, 'arc', 6).filter((c) => c.kind === 'C').length;
    expect(count([near(3), near(97)])).toBe(0);
    expect(count([near(40), near(48), near(70)])).toBe(2);
    expect(hopPath([], [])).toEqual([]);
  });

  it('FR-CON-008: the crossing list is cached until a route revision changes', () => {
    const jumps = createJumpCache();
    const first = jumps([h, v]);
    expect(jumps([h, v])).toBe(first);
    expect(jumps([h, { ...v, revision: '2' }])).not.toBe(first);
    expect(jumps([h, v], 'gap')).not.toBe(first);
  });
});

describe('line jumps golden (FR-CON-008)', () => {
  const d = (cmds: readonly PathCommand[]): string =>
    cmds
      .map((c) => {
        const num = (v: Vec2) => `${v.x} ${v.y}`;
        if (c.kind === 'C') return `C${num(c.control1)} ${num(c.control2)} ${num(c.to)}`;
        return c.kind === 'Z' ? 'Z' : `${c.kind}${num(c.to)}`;
      })
      .join(' ');

  it('FR-CON-008: the later connector draws an arc hop at the crossing', async () => {
    const routes = [
      h,
      v,
      route(
        'w',
        3,
        [
          [70, 0],
          [70, 100],
        ],
        { style: 'gap' },
      ),
    ];
    const jumps = findJumps(routes);
    const paths = routes.map(
      (r) => `  <path id="${r.id}" fill="none" stroke="black" d="${d(hopPath(r.points, jumps.get(r.id) ?? [], r.style === 'gap' ? 'gap' : 'arc'))}"/>`,
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Connectors with line jumps" viewBox="0 0 100 100">\n${paths.join('\n')}\n</svg>\n`;
    expect(svg).toContain('C');
    await expect(svg).toMatchFileSnapshot('../__golden__/line-jumps.svg');
  });
});
