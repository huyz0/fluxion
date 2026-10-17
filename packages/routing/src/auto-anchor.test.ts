// FR-ANC-004: the auto-anchor selector picks the sides after layout so no avoidable crossing is left, keeps the previous side unless
// another is clearly better, freezes during a drag, honours an assigned side and the roles, and gives the same answer every time.
import type { Box, Vec2 } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { AUTO_SCENES } from './__fixtures__/auto-anchors.js';
import { type AutoEdge, type AutoEnd, chooseAutoSides, type Side } from './auto-anchor.js';

const mid = (b: Box, s: Side): Vec2 =>
  ({ n: { x: b.x + b.w / 2, y: b.y }, s: { x: b.x + b.w / 2, y: b.y + b.h }, e: { x: b.x + b.w, y: b.y + b.h / 2 }, w: { x: b.x, y: b.y + b.h / 2 } })[s];
const end = (key: string, box: Box, rest: Partial<AutoEnd> = {}): AutoEnd => ({ key, box, ...rest });

type Seg = readonly [Vec2, Vec2];
const orient = (a: Vec2, b: Vec2, c: Vec2): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
function cross(p: Seg, q: Seg): boolean {
  if (same(p[0], q[0]) || same(p[0], q[1]) || same(p[1], q[0]) || same(p[1], q[1])) return false;
  return orient(p[0], p[1], q[0]) !== orient(p[0], p[1], q[1]) && orient(q[0], q[1], p[0]) !== orient(q[0], q[1], p[1]);
}

describe('auto anchors (FR-ANC-004)', () => {
  for (const scene of AUTO_SCENES) {
    it(`FR-ANC-004: ${scene.name}: no crossing is left and the facing sides are used`, () => {
      const edges: AutoEdge[] = scene.edges.map(([s, t]) => ({ source: end(s, scene.boxes[s] as Box), target: end(t, scene.boxes[t] as Box) }));
      const choice = chooseAutoSides(edges);
      const segs: Seg[] = scene.edges.map(([s, t], i) => [
        mid(scene.boxes[s] as Box, (choice[i] as { source: Side }).source),
        mid(scene.boxes[t] as Box, (choice[i] as { target: Side }).target),
      ]);
      let crossings = 0;
      for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (cross(segs[i] as Seg, segs[j] as Seg)) crossings++;
      expect(crossings).toBe(0);
    });
  }

  const left = end('a', { x: 0, y: 0, w: 100, h: 60 });
  const right = end('b', { x: 300, y: 0, w: 100, h: 60 });

  it('FR-ANC-004: two boxes side by side connect east to west', () => {
    expect(chooseAutoSides([{ source: left, target: right }])).toEqual([{ source: 'e', target: 'w' }]);
  });

  it('FR-ANC-004: a box below connects south to north', () => {
    const below = end('b', { x: 0, y: 200, w: 100, h: 60 });
    expect(chooseAutoSides([{ source: left, target: below }])).toEqual([{ source: 's', target: 'n' }]);
  });

  it('FR-ANC-004: crowding spreads a second connector to another side of the same box', () => {
    const near = end('c', { x: 300, y: 120, w: 100, h: 60 });
    const [first, second] = chooseAutoSides(
      [
        { source: left, target: right },
        { source: left, target: near },
      ],
      { weights: { crowding: 400 } },
    );
    expect(first?.source).toBe('e');
    expect(second?.source).not.toBe('e');
  });

  it('FR-ANC-004: an algorithm-assigned side wins over a shorter one', () => {
    const [c] = chooseAutoSides([{ source: end('a', left.box, { assigned: 'n' }), target: right }]);
    expect(c?.source).toBe('n');
  });

  it('FR-ANC-004: a side its roles do not allow is avoided', () => {
    const [c] = chooseAutoSides([{ source: end('a', left.box, { roleSides: ['s', 'w'] }), target: right }], { weights: { role: 1000 } });
    expect(['s', 'w']).toContain(c?.source);
  });

  it('FR-ANC-004: hysteresis keeps the previous side unless another is clearly better', () => {
    const nearlyEven = end('b', { x: 250, y: 20, w: 100, h: 60 });
    const from = end('a', left.box, { previous: 's' });
    expect(chooseAutoSides([{ source: from, target: nearlyEven }], { weights: { hysteresis: 0 } })[0]?.source).toBe('e');
    expect(chooseAutoSides([{ source: from, target: nearlyEven }], { weights: { hysteresis: 10 } })[0]?.source).toBe('s');
  });

  it('FR-ANC-004: hysteresis gives way when the previous side is clearly worse', () => {
    const kept = chooseAutoSides([{ source: end('a', left.box, { previous: 'w' }), target: right }]);
    expect(kept[0]?.source).toBe('e');
  });

  it('FR-ANC-004: during a drag the previous sides are kept, and re-scored after', () => {
    const edge: AutoEdge = { source: end('a', left.box, { previous: 'w' }), target: end('b', right.box, { previous: 'e' }) };
    expect(chooseAutoSides([edge], { frozen: true })).toEqual([{ source: 'w', target: 'e' }]);
    expect(chooseAutoSides([edge])).toEqual([{ source: 'e', target: 'w' }]);
  });

  it('FR-ANC-004: the same input gives the same answer', () => {
    const edges: AutoEdge[] = [{ source: left, target: right }];
    expect(chooseAutoSides(edges)).toEqual(chooseAutoSides(edges));
  });
});
