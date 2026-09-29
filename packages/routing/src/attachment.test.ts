import { createCore, createRegistry, outlineDistance, type ShapeDef } from '@fluxion/core';
import { apply, elementMatrix, invert, type Mat2d, type Ok, type Vec2 } from '@fluxion/geometry';
import type { AnchorRef, DocumentFile, RecordId, Transform } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ANCHORS, shapeAnchorTarget } from './anchor.js';
import { registerBuiltinRouters } from './builtins.js';
import { type RouteContext, routeConnector } from './connector-route.js';
import type { Router } from './router.js';

const ellipse = {
  id: 'test:ellipse',
  outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 1 1 {w} {h/2} A {w/2} {h/2} 0 1 1 0 {h/2} Z' },
  defaultSize: { w: 100, h: 60 },
} as ShapeDef;
const diamond = { id: 'test:diamond', outline: { path: 'M {w/2} 0 L {w} {h/2} L {w/2} {h} L 0 {h/2} Z' }, defaultSize: { w: 100, h: 60 } } as ShapeDef;

function context(): RouteContext {
  const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
  shapeDefs.register(ellipse.id, ellipse, 'test');
  shapeDefs.register(diamond.id, diamond, 'test');
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  return { shapeDefs, routers };
}

const placement = fc.record({
  x: fc.integer({ min: -400, max: 400 }),
  y: fc.integer({ min: -400, max: 400 }),
  w: fc.integer({ min: 10, max: 300 }),
  h: fc.integer({ min: 10, max: 300 }),
  rot: fc.integer({ min: -360, max: 360 }),
  flipX: fc.boolean(),
  flipY: fc.boolean(),
});
/** One edit of a bound element: moved, resized, rotated and flipped at once, or reparented into or out of the group. */
const edit = fc.oneof(
  fc.record({ kind: fc.constant('place' as const), which: fc.constantFrom(0, 1), to: placement }),
  fc.record({ kind: fc.constant('reparent' as const), which: fc.constantFrom(0, 1), into: fc.boolean() }),
);
const anchor: fc.Arbitrary<AnchorRef> = fc.oneof(
  fc.constant({ kind: 'floating' } as const),
  fc.constantFrom(...DEFAULT_ANCHORS.map((a) => ({ kind: 'named', name: a.name }) as const)),
  fc.record({ kind: fc.constant('side' as const), side: fc.constantFrom('n', 'e', 's', 'w'), t: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ kind: fc.constant('point' as const), x: fc.double({ min: 0, max: 1, noNaN: true }), y: fc.double({ min: 0, max: 1, noNaN: true }) }),
);

const matrixOf = (t: Transform): Mat2d => elementMatrix({ ...t, rot: t.rot ?? 0 });

/** The fraction of the box the anchor `ref` pins an end to; undefined for a floating one (it depends on the other end). */
function fraction(ref: AnchorRef): Vec2 | undefined {
  if (ref.kind === 'named') return DEFAULT_ANCHORS.find((a) => a.name === ref.name);
  if (ref.kind === 'point') return ref;
  if (ref.kind !== 'side') return undefined;
  const t = ref.t ?? 0.5;
  return { n: { x: t, y: 0 }, e: { x: 1, y: t }, s: { x: t, y: 1 }, w: { x: 0, y: t } }[ref.side];
}

/** Where the anchor `ref` of an element at `t` puts an end, when that does not depend on the other end. */
function fixedPoint(t: Transform, ref: AnchorRef): Vec2 | undefined {
  const f = fraction(ref);
  return f === undefined ? undefined : apply(matrixOf(t), { x: f.x * t.w, y: f.y * t.h });
}

/** How far the screen point `p` is from the outline of the element of definition `def` at `t`. */
function offOutline(t: Transform, def: ShapeDef, p: Vec2): number {
  const outline = shapeAnchorTarget(t, def).outline;
  if (outline === undefined) throw new Error('the test outlines evaluate');
  return outlineDistance(outline, apply((invert(matrixOf(t)) as Ok<Mat2d>).value, p));
}

describe('attachment invariant (FR-CON-012)', () => {
  // 1000 runs, each building a document and a store: seconds on a loaded CI runner or under coverage (M5.37)
  it('FR-CON-012: after random transforms endpoints lie on anchors', { timeout: 60_000 }, () => {
    const ctx = context();
    let [runs, edited] = [0, 0];
    fc.assert(
      fc.property(
        fc.tuple(placement, placement),
        fc.tuple(anchor, anchor),
        fc.constantFrom('straight', 'curved', 'orthogonal', 'polyline'),
        fc.array(edit, { maxLength: 6 }),
        ([p0, p1], [a0, a1], type, edits) => {
          const b = documentBuilder({ seed: 5230 });
          const screenId = b.screen();
          const ids = [b.rect(screenId, { ...p0, defId: 'test:ellipse' }), b.rect(screenId, { ...p1, defId: 'test:diamond' })] as const;
          const group = b.rect(screenId, { x: 0, y: 0, w: 50, h: 50 });
          const line = b.connect(ids[0], ids[1], { route: type, sourceAnchor: a0, targetAnchor: a1 });
          const file = b.build();
          const records = { ...file.records, [group]: { ...(file.records[group] as object), kind: 'group', defId: undefined } };
          const { store } = createCore({ ...file, records } as DocumentFile);
          const routed = store.query((view) => routeConnector(view, ctx, line));
          runs++;
          edited += edits.length;
          for (const e of edits) {
            const id = ids[e.which];
            const done = store.transact('edit', (tx) => tx.patch(id, e.kind === 'place' ? { transform: e.to } : { parentId: e.into ? group : undefined }));
            expect(done.ok).toBe(true);
          }
          const route = routed();
          expect(route).toBeDefined();
          const ends = [route?.source.point, route?.target.point] as Vec2[];
          // each end lies on its anchor: a fixed anchor's point, or the outline for a floating one
          [0, 1].forEach((k) => {
            const t = (store.get(ids[k] as RecordId) as { transform: Transform }).transform;
            const fixed = fixedPoint(t, [a0, a1][k] as AnchorRef);
            if (fixed === undefined) expect(offOutline(t, k === 0 ? ellipse : diamond, ends[k] as Vec2)).toBeLessThan(1e-6);
            else {
              expect(ends[k]?.x).toBeCloseTo(fixed.x, 6);
              expect(ends[k]?.y).toBeCloseTo(fixed.y, 6);
            }
          });
          // and the drawn route runs from one to the other
          const commands = route?.commands ?? [];
          expect(commands[0]).toEqual({ kind: 'M', to: ends[0] });
          expect((commands.at(-1) as { to: Vec2 }).to).toEqual(ends[1]);
        },
      ),
      { numRuns: 1000 },
    );
    // every run ran, and they moved the elements around (a property that edits nothing proves little)
    expect(runs).toBe(1000);
    expect(edited).toBeGreaterThan(1000);
  });
});
