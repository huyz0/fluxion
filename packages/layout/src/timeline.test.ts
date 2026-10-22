// FR-LAY-003: the built-in `timeline` layout: events in date order along an axis, each inside its lane band.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type TimelineOptions, timelineLayout } from './timeline.js';
import type { LayoutInput, LayoutNode } from './types.js';

type Placed = { x: number; y: number; w: number; h: number };
const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const event = (id: string, [w, h]: readonly [number, number], order: number, hints: { lane?: string; date?: number | string } = {}): LayoutNode => ({
  id,
  box: { x: 0, y: 0, w, h },
  order,
  hints,
});
const options = (raw: unknown): TimelineOptions => {
  const r = timelineLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const overlap = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `out` mirrored on the diagonal (x and y, w and h swapped) when `flip`. */
function transposedIf(flip: boolean, out: Readonly<Record<string, Placed>>): Readonly<Record<string, Placed>> {
  return flip ? Object.fromEntries(Object.entries(out).map(([id, b]) => [id, { x: b.y, y: b.x, w: b.h, h: b.w }])) : out;
}

/** The span the boxes of `lane` take across the lanes (y when time runs right). */
function span(input: LayoutInput, out: Readonly<Record<string, Placed>>, lane: string) {
  const boxes = input.nodes.filter((n) => n.hints?.['lane'] === lane).map((n) => out[n.id] as Placed);
  return { lo: Math.min(...boxes.map((b) => b.y)), hi: Math.max(...boxes.map((b) => b.y + b.h)) };
}

function expectNoOverlap(placed: readonly Placed[]) {
  for (const [i, b] of placed.entries()) for (const o of placed.slice(i + 1)) expect(overlap(b, o)).toBe(false);
}

function expectDisjointBands(spans: ReadonlyArray<{ lo: number; hi: number }>) {
  for (const [i, s] of spans.entries()) for (const t of spans.slice(i + 1)) expect(s.hi <= t.lo || t.hi <= s.lo).toBe(true);
}

/** Events in date order (ties in model order) lie strictly further along the axis. */
function expectTimeForwards(input: LayoutInput, out: Readonly<Record<string, Placed>>) {
  const byDate = [...input.nodes].sort((a, b) => (a.hints?.['date'] as number) - (b.hints?.['date'] as number) || a.order - b.order);
  for (const [i, n] of byDate.entries()) if (i > 0) expect((out[n.id] as Placed).x).toBeGreaterThan((out[(byDate[i - 1] as LayoutNode).id] as Placed).x);
}

/** Fixture timeline-lanes: 12 events over 3 lanes (design, build, ship), dates not in model order. The golden is the top-left corners. */
function laneFixture(): LayoutInput {
  const lanes = ['design', 'build', 'ship'];
  const nodes = Array.from({ length: 12 }, (_, i) =>
    event(`e${i}`, [120 + (i % 3) * 20, 50 + (i % 2) * 20], i, { lane: lanes[i % 3] as string, date: ((i * 5) % 12) * 86_400_000 }),
  );
  return { frame, nodes };
}

/** Random events: size, lane and a day number. */
const events = fc.array(
  fc.tuple(fc.integer({ min: 1, max: 220 }), fc.integer({ min: 1, max: 140 }), fc.constantFrom('a', 'b', 'c'), fc.integer({ min: 0, max: 50 })),
  {
    minLength: 1,
    maxLength: 30,
  },
);

describe('timeline layout (FR-LAY-003)', () => {
  it('FR-LAY-003: golden timeline-lanes, twelve events in three lanes', () => {
    const input = laneFixture();
    const out = timelineLayout.run(input, options(undefined)).boxes as Record<string, Placed>;
    const corners = input.nodes.map((n) => `${n.id} ${(out[n.id] as Placed).x},${(out[n.id] as Placed).y}`);
    expect(corners).toEqual(GOLDEN_TIMELINE_LANES);
  });

  it('FR-LAY-003: WHEN nodes carry a lane each stays inside its lane band, the bands are disjoint, and time never runs backwards (property)', () => {
    fc.assert(
      fc.property(events, fc.constantFrom('compact', 'comfortable', 'spacious'), fc.constantFrom('right', 'down'), (list, spacing, direction) => {
        const input: LayoutInput = { frame, nodes: list.map(([w, h, lane, date], i) => event(`n${i}`, [w, h], i, { lane, date })) };
        // a vertical timeline, mirrored on the diagonal, is checked as a horizontal one (review M17.7 F2)
        const out = transposedIf(direction === 'down', timelineLayout.run(input, options({ spacing, direction })).boxes as Record<string, Placed>);
        expectNoOverlap(input.nodes.map((n) => out[n.id] as Placed));
        expectDisjointBands(['a', 'b', 'c'].map((lane) => span(input, out, lane)).filter((s) => Number.isFinite(s.lo)));
        expectTimeForwards(input, out);
      }),
    );
  });

  it('FR-LAY-003: dates may be numbers or date strings; undated events follow the dated ones in model order; down turns lanes into columns', () => {
    const input: LayoutInput = {
      frame,
      nodes: [
        event('undated', [50, 50], 0),
        event('late', [50, 50], 1, { date: '2026-03-01' }),
        event('early', [50, 50], 2, { date: '2026-01-01' }),
        event('also', [50, 50], 3),
      ],
    };
    const right = timelineLayout.run(input, options({ padding: 0 })).boxes as Record<string, Placed>;
    const order = Object.keys(right).sort((a, b) => (right[a] as Placed).x - (right[b] as Placed).x);
    expect(order).toEqual(['early', 'late', 'undated', 'also']);
    const down = timelineLayout.run(input, options({ padding: 0, direction: 'down' })).boxes as Record<string, Placed>;
    expect(Object.keys(down).sort((a, b) => (down[a] as Placed).y - (down[b] as Placed).y)).toEqual(order);
    expect(new Set(Object.values(down).map((b) => b.x)).size).toBe(1);
  });

  it('FR-LAY-008: the same events in another order give the same boxes; pinned nodes keep theirs; odd ids work', () => {
    const input: LayoutInput = {
      frame,
      nodes: [
        event('constructor', [80, 40], 0, { lane: 'x', date: 2 }),
        { ...event('__proto__', [60, 30], 1, { lane: 'x', date: 1 }), pinned: true, box: { x: 5, y: 6, w: 60, h: 30 } },
        event('c', [70, 30], 2, { lane: 'y', date: 3 }),
      ],
    };
    const o = options({});
    const first = timelineLayout.run(input, o);
    expect(timelineLayout.run({ ...input, nodes: [...input.nodes].reverse() }, o)).toEqual(first);
    expect(Object.keys(first.boxes).sort()).toEqual(['__proto__', 'c', 'constructor']);
    expect(first.boxes['__proto__']).toEqual({ x: 5, y: 6, w: 60, h: 30 });
    expect(timelineLayout.run({ frame, nodes: [] }, o)).toEqual({ boxes: {} });
  });

  it('FR-LAY-001: options are checked against the schema', () => {
    expect(timelineLayout.parseOptions({ direction: 'up' })).toMatchObject({ ok: false });
    expect(timelineLayout.parseOptions({ spacing: 'roomy' })).toMatchObject({ ok: false });
    expect(options(undefined)).toEqual({ direction: 'right', spacing: 'comfortable', padding: 80 });
  });
});

// regenerate only for a deliberate change to the algorithm, with the reason in the commit and a `version` bump
const GOLDEN_TIMELINE_LANES: readonly string[] = [
  'e0 80,90',
  'e1 980,230',
  'e2 1860,390',
  'e3 620,80',
  'e4 1520,240',
  'e5 240,380',
  'e6 1160,90',
  'e7 2060,230',
  'e8 780,390',
  'e9 1700,80',
  'e10 440,240',
  'e11 1320,380',
];
