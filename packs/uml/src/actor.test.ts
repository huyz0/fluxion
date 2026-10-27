// The actor's figure is one closed outline (FR-LIB-007, M18.25 review r3 F3, r4 F1): a connector's floating end, projected from
// the box centre like routing's floating anchor, lands on the figure's edge from every direction, never inside it.
import { evaluateOutline, hitTestShape, projectToOutline, type ShapeDef } from '@fluxion/sdk';
import { expect, it } from 'vitest';
import { shapes } from './shapes.js';

const actor = shapes.find((d) => d.id === 'uml:actor') as ShapeDef;
const { w, h } = actor.defaultSize;
const centre = { x: w / 2, y: h / 2 };

it('FR-LIB-007: floating connector ends land on the actor figure edge from every direction', () => {
  const outline = evaluateOutline(actor, { w, h });
  if (!outline.ok) throw new Error(outline.error.message);
  const path = outline.value.path;
  expect(path.closed).toBe(true);
  // the centre is inside the figure, so every ray from it leaves through the edge
  expect(hitTestShape(path, centre)).toBe(true);
  const inside = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const p = projectToOutline(path, centre, { x: Math.cos(a), y: Math.sin(a) });
    if (p === null || Math.hypot(p.x - centre.x, p.y - centre.y) < 0.1 * Math.min(w, h)) inside.push(deg);
  }
  expect(inside).toEqual([]);
});
