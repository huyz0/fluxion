// FR-ANC-006: a connector end snaps to an anchor within the tolerance and shows the anchors while connecting; FR-ANC-003: an anchor
// with its `max` connections takes no more.
import { createCore, type ShapeDef } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { anchorDots, snapAnchor } from './anchor-snap.js';
import { registerBuiltinTools } from './builtin-tools.js';
import { endDrop } from './connector-handles.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

const rect = { id: 'test:rect', outline: { path: 'M 0 0 H {w} V {h} H 0 Z' }, defaultSize: { w: 100, h: 100 } } as ShapeDef;
const defs = { get: (id: string) => (id === 'test:rect' ? rect : undefined) };

/** Shapes a (0..100) and c (400..500), a port anchor `p` on c's left side taking one connection, and a connector into it. */
function setup() {
  const b = documentBuilder({ seed: 1617 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100, defId: 'test:rect' });
  const c = b.rect(screen, { x: 400, y: 0, w: 100, h: 100, defId: 'test:rect' });
  const z = b.rect(screen, { x: 0, y: 300, w: 100, h: 100, defId: 'test:rect' });
  const used = b.connect(z, c);
  const core = createCore(b.build());
  core.store.transact('anchors', (tx) => tx.patch(c, { anchors: [{ name: 'p', x: 0, y: 0.25, max: 1 }] }));
  return { core, screen, a, c, z, used };
}

const at = (phase: PointerPhase, x: number, y: number): PointerInfo => ({
  phase,
  pointerId: 1,
  pointerType: 'mouse',
  screen: { x, y },
  page: { x, y },
  button: 0,
  buttons: phase === 'up' ? 0 : 1,
  shift: false,
  alt: false,
  mod: false,
  pressure: 0.5,
  coalesced: [],
});

describe('anchor snapping (FR-ANC-006, FR-ANC-003)', () => {
  it('FR-ANC-006: the anchors of an element are dots, and a drop within the tolerance of one snaps to it; farther away it binds auto', () => {
    const { core, a } = setup();
    const dots = anchorDots(core.store, defs, { elementId: a, at: { x: 97, y: 52 }, tolerance: 8 });
    expect(dots.map((d) => d.name).sort()).toEqual(['e', 'n', 's', 'w']);
    expect(dots.find((d) => d.name === 'e')).toEqual({ name: 'e', point: { x: 100, y: 50 }, full: false, snapped: true });
    expect(dots.filter((d) => d.snapped)).toHaveLength(1);
    expect(snapAnchor(core.store, defs, { elementId: a, at: { x: 97, y: 52 }, tolerance: 8 })).toEqual({ kind: 'named', name: 'e' });
    // 20 from the nearest anchor: no snap
    expect(snapAnchor(core.store, defs, { elementId: a, at: { x: 80, y: 30 }, tolerance: 8 })).toEqual({ kind: 'auto' });
    // the middle is no snap target: a drop there connects to the whole shape
    expect(snapAnchor(core.store, defs, { elementId: a, at: { x: 50, y: 50 }, tolerance: 8 })).toEqual({ kind: 'auto' });
    expect(anchorDots(core.store, defs, { elementId: a, at: { x: 80, y: 30 }, tolerance: 8 }).some((d) => d.snapped)).toBe(false);
  });

  it('FR-ANC-006: a centre anchor is no dot even when it overrides a default anchor by name', () => {
    const { core, a } = setup();
    const odd = { ...rect, anchors: [{ name: 'n', kind: 'center' }] } as ShapeDef;
    const dots = anchorDots(core.store, { get: () => odd }, { elementId: a, at: { x: 50, y: 50 }, tolerance: 8 });
    expect(dots.map((d) => d.name).sort()).toEqual(['e', 's', 'w']);
  });

  it('FR-ANC-006: an anchor that floats (a perimeter anchor without a place) is no dot and takes no snap from a fixed anchor beside it', () => {
    const { core, a } = setup();
    const floating = { ...rect, anchors: [{ name: 'any', kind: 'perimeter' }] } as ShapeDef;
    const dots = anchorDots(core.store, { get: () => floating }, { elementId: a, at: { x: 53, y: 1 }, tolerance: 8 });
    expect(dots.map((d) => d.name).sort()).toEqual(['e', 'n', 's', 'w']);
    expect(snapAnchor(core.store, { get: () => floating }, { elementId: a, at: { x: 53, y: 1 }, tolerance: 8 })).toEqual({ kind: 'named', name: 'n' });
  });

  it('FR-ANC-003: an anchor with its max connections is full: no drop snaps to it, but the end already there re-drops onto it, but not the other end of that connector', () => {
    const { core, c, used } = setup();
    // bind the existing connector's target at the port p (c's left side, a quarter down: 400, 25)
    expect(
      endDrop(core.store, defs, { connector: used, end: 'target', onto: c, at: { x: 401, y: 26 }, newId: () => 'bindingbindingp1' as RecordId, tolerance: 8 }),
    ).toMatchObject([{ args: { anchor: { kind: 'named', name: 'p' } } }]);
    const [bind] = endDrop(core.store, defs, {
      connector: used,
      end: 'target',
      onto: c,
      at: { x: 401, y: 26 },
      newId: () => 'bindingbindingp1' as RecordId,
      tolerance: 8,
    });
    expect(core.execute(bind?.id as string, bind?.args).ok).toBe(true);
    const other = 'otherconnector01' as RecordId;
    const port = anchorDots(core.store, defs, { elementId: c, at: { x: 401, y: 26 }, tolerance: 8, except: { connector: other, end: 'source' } }).find(
      (d) => d.name === 'p',
    );
    expect(port).toMatchObject({ full: true, snapped: false });
    // the next nearest within the tolerance does not exist: auto
    expect(snapAnchor(core.store, defs, { elementId: c, at: { x: 401, y: 26 }, tolerance: 8, except: { connector: other, end: 'source' } })).toEqual({
      kind: 'auto',
    });
    // at any distance (no tolerance) the drop takes the nearest anchor that is not full: w
    expect(endDrop(core.store, defs, { connector: other, end: 'source', onto: c, at: { x: 401, y: 26 }, newId: () => 'x' as RecordId })).toMatchObject([
      { args: { anchor: { kind: 'named', name: 'w' } } },
    ]);
    // the connector bound there does not count against itself
    expect(snapAnchor(core.store, defs, { elementId: c, at: { x: 401, y: 26 }, tolerance: 8, except: { connector: used, end: 'target' } })).toEqual({
      kind: 'named',
      name: 'p',
    });
    // but its other end does: the port takes no second end of the same connector
    expect(snapAnchor(core.store, defs, { elementId: c, at: { x: 401, y: 26 }, tolerance: 8, except: { connector: used, end: 'source' } })).toEqual({
      kind: 'auto',
    });
  });

  it('FR-ANC-006: the connector tool shows the anchors of the element under a dragged end and binds both ends where they snap', () => {
    const { core, a, c } = setup();
    const session = createSession('doc');
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    let n = 0;
    const hitTest = (p: { x: number; y: number }) =>
      [a, c].find((id) => {
        const t = (core.store.get(id) as unknown as { transform: { x: number; y: number; w: number; h: number } }).transform;
        return p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;
      });
    const tools = createToolDispatcher(registry, {
      session,
      view: core.store,
      execute: core.execute,
      seal: () => core.store.history.seal(),
      newId: () => `snapsnapsnaps${String(++n).padStart(3, '0')}` as RecordId,
      screen: core.store.members('byType', 'screen')[0] as RecordId,
      shapeDefs: defs,
      hitTest,
      // the elements whose boxes a page box touches
      elementsIn: (box) =>
        [a, c].filter((id) => {
          const t = (core.store.get(id) as unknown as { transform: { x: number; y: number; w: number; h: number } }).transform;
          return box.x <= t.x + t.w && box.x + box.w >= t.x && box.y <= t.y + t.h && box.y + box.h >= t.y;
        }),
      allElements: () => [],
    });
    session.tool.set('connector');
    tools.pointer(at('down', 98, 50));
    // from the press, the source shape's anchors show, the one its end took marked
    expect(session.anchors.get().find((d) => d.snapped)?.name).toBe('e');
    tools.pointer(at('move', 404, 27));
    expect(session.anchors.get().find((d) => d.snapped)?.name).toBe('p');
    // back over the source: its dots as at the press, then over c again
    tools.pointer(at('move', 60, 60));
    expect(
      session.anchors
        .get()
        .map((d) => [d.name, d.snapped])
        .filter(([, on]) => on),
    ).toEqual([['e', true]]);
    expect(session.anchors.get().find((d) => d.name === 'p')).toBeUndefined();
    tools.pointer(at('move', 404, 27));
    tools.pointer(at('up', 404, 27));
    expect(session.anchors.get()).toEqual([]);
    const anchors = core.store
      .members('byType', 'binding')
      .map((id) => core.store.get(id) as unknown as { connectorId: string; end: string; anchor: unknown })
      .filter((b) => b.connectorId.startsWith('snapsnap'))
      .map((b) => [b.end, b.anchor]);
    expect(anchors.sort()).toEqual([
      ['source', { kind: 'named', name: 'e' }],
      ['target', { kind: 'named', name: 'p' }],
    ]);
  });

  it('FR-ANC-006: an end dropped just outside a shape, within the tolerance of an anchor on its outline, still snaps onto it', () => {
    const { core, a, c } = setup();
    const session = createSession('doc');
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    let n = 0;
    const hitTest = (p: { x: number; y: number }) =>
      [a, c].find((id) => {
        const t = (core.store.get(id) as unknown as { transform: { x: number; y: number; w: number; h: number } }).transform;
        return p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;
      });
    const tools = createToolDispatcher(registry, {
      session,
      view: core.store,
      execute: core.execute,
      seal: () => core.store.history.seal(),
      newId: () => `snapsnapsnaps${String(++n).padStart(3, '0')}` as RecordId,
      screen: core.store.members('byType', 'screen')[0] as RecordId,
      shapeDefs: defs,
      hitTest,
      // the elements whose boxes a page box touches
      elementsIn: (box) =>
        [a, c].filter((id) => {
          const t = (core.store.get(id) as unknown as { transform: { x: number; y: number; w: number; h: number } }).transform;
          return box.x <= t.x + t.w && box.x + box.w >= t.x && box.y <= t.y + t.h && box.y + box.h >= t.y;
        }),
      allElements: () => [],
    });
    session.tool.set('connector');
    // 6 above the top of c (anchor n at 450, 0): outside the shape, inside the tolerance
    tools.pointer(at('down', 98, 50));
    tools.pointer(at('move', 451, -6));
    expect(session.hover.get()).toBe(c);
    expect(session.anchors.get().find((d) => d.snapped)?.name).toBe('n');
    tools.pointer(at('up', 451, -6));
    const target = core.store
      .members('byType', 'binding')
      .map((id) => core.store.get(id) as unknown as { connectorId: string; end: string; elementId: string; anchor: unknown })
      .find((b) => b.connectorId.startsWith('snapsnap') && b.end === 'target');
    expect(target).toMatchObject({ elementId: c, anchor: { kind: 'named', name: 'n' } });
  });
});
