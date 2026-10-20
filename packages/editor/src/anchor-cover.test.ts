// FR-ANC-006 (M16.30): an anchor another element covers, a shape painted over it, is neither shown nor snapped to while connecting;
// coverage comes from the canvas's hit index (by outline, above the anchor's element, hidden elements and connectors left out).
import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder, plainText } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { registries } from './__fixtures__/hit-shapes.js';
import { anchorDots } from './anchor-snap.js';
import { registerBuiltinTools } from './builtin-tools.js';
import { createHitIndex } from './hit-test.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

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

/** The connector tool over `core`'s screen as the editor wires it: hits, box queries and coverage from a hit index, at zoom 1. */
function connecting(core: ReturnType<typeof createCore>, screen: RecordId) {
  const reg = registries();
  const hits = createHitIndex(core.store, { registries: reg, theme: LIGHT_THEME });
  const session = createSession('doc');
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  let n = 0;
  const tools = createToolDispatcher(registry, {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => `covercovercov${String(++n).padStart(3, '0')}` as RecordId,
    screen,
    shapeDefs: reg.shapeDefs,
    hitTest: (p) => {
      const hit = hits.hitTest(screen, p, 1);
      return hit === undefined ? undefined : hits.selectableOf(hit);
    },
    elementsIn: (box, mode) => hits.within(screen, box, mode),
    allElements: () => hits.all(screen),
    covered: (elementId, p) => hits.covers(screen, elementId, p, 1),
  });
  session.tool.set('connector');
  const target = () =>
    core.store
      .members('byType', 'binding')
      .map((id) => core.store.get(id) as unknown as { connectorId: string; end: string; elementId: string; anchor: unknown })
      .find((x) => x.connectorId.startsWith('covercover') && x.end === 'target');
  return { session, tools, target, hits };
}

/** A source shape far left, a large shape (its anchor n at (200, 0)) and a small one painted over that anchor (180..220 by -20..20). */
function layout(seed: number) {
  const b = documentBuilder({ seed });
  const screen = b.screen({ size: { w: 1000, h: 1000 } });
  const source = b.rect(screen, { x: -400, y: 0, w: 100, h: 100, defId: 'basic:rect' });
  const large = b.rect(screen, { x: 0, y: 0, w: 400, h: 300, defId: 'basic:rect' });
  const small = b.rect(screen, { x: 180, y: -20, w: 40, h: 40, defId: 'basic:rect' });
  return { core: createCore(b.build()), screen, source, large, small };
}

describe('anchors another element covers (FR-ANC-006)', () => {
  it('FR-ANC-006: an end inside a small shape over a larger shape anchor binds the small shape auto, and that anchor is not shown', () => {
    const { core, screen, large, small } = layout(1630);
    const { session, tools, target } = connecting(core, screen);
    tools.pointer(at('down', -350, 50));
    // 2 below the large shape's n, inside the small shape, 18 or more from each of its own anchors
    tools.pointer(at('move', 200, 2));
    expect(session.hover.get()).toBe(small);
    expect(session.anchors.get().some((d) => d.snapped)).toBe(false);
    expect(anchorDots(core.store, registries().shapeDefs, { elementId: large, at: { x: 200, y: 2 }, tolerance: 8 }).some((d) => d.snapped)).toBe(true);
    tools.pointer(at('up', 200, 2));
    expect(target()).toMatchObject({ elementId: small, anchor: { kind: 'auto' } });
  });

  it('FR-ANC-006: the large shape shows its other anchors, but not the covered one, while the end is over it', () => {
    const { core, screen, large } = layout(1631);
    const { session, tools } = connecting(core, screen);
    tools.pointer(at('down', -350, 50));
    tools.pointer(at('move', 200, 150));
    expect(session.hover.get()).toBe(large);
    expect(
      session.anchors
        .get()
        .map((d) => d.name)
        .sort(),
    ).toEqual(['e', 's', 'w']);
  });

  it('FR-ANC-006: a hidden shape over the anchor covers nothing: the end snaps to the large shape anchor', () => {
    const { core, screen, large, small } = layout(1632);
    core.store.transact('hide', (tx) => tx.patch(small, { hidden: true }));
    const { session, tools, target } = connecting(core, screen);
    tools.pointer(at('down', -350, 50));
    tools.pointer(at('move', 200, 2));
    expect(session.anchors.get().find((d) => d.snapped)?.name).toBe('n');
    tools.pointer(at('up', 200, 2));
    expect(target()).toMatchObject({ elementId: large, anchor: { kind: 'named', name: 'n' } });
  });

  it('FR-ANC-006: a shape painted below the anchor element, or one whose edge only meets the anchor, does not cover it', () => {
    const b = documentBuilder({ seed: 1633 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    // under: painted before the large shape, across its anchor n
    const under = b.rect(screen, { x: 180, y: -20, w: 40, h: 40, defId: 'basic:rect' });
    const large = b.rect(screen, { x: 0, y: 0, w: 400, h: 300, defId: 'basic:rect' });
    // beside: above the large shape, its left edge on the large shape's anchor e (400, 150)
    const beside = b.rect(screen, { x: 400, y: 100, w: 100, h: 100, defId: 'basic:rect' });
    const core = createCore(b.build());
    const { hits } = connecting(core, screen);
    expect(hits.covers(screen, large, { x: 200, y: 0 }, 1)).toBe(false);
    expect(hits.covers(screen, large, { x: 400, y: 150 }, 1)).toBe(false);
    // the shape below is covered by the large one where they overlap inside it
    expect(hits.covers(screen, under, { x: 200, y: 10 }, 1)).toBe(true);
    // nothing above beside: a point well inside it is not covered for it
    expect(hits.covers(screen, beside, { x: 450, y: 150 }, 1)).toBe(false);
  });

  it('FR-ANC-006: a connector drawn over an anchor (its label on it) does not cover it', () => {
    const b = documentBuilder({ seed: 1634 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const large = b.rect(screen, { x: 0, y: 0, w: 400, h: 300, defId: 'basic:rect' });
    const line = b.connect({ x: 100, y: 0 }, { x: 300, y: 0 });
    const core = createCore(b.build());
    core.store.transact('label', (tx) => tx.patch(line, { labels: [{ text: plainText('a label'), position: 0.5 }] }));
    const { hits } = connecting(core, screen);
    expect(hits.hitTest(screen, { x: 200, y: 3 }, 1)).toBe(line);
    expect(hits.covers(screen, large, { x: 200, y: 0 }, 1)).toBe(false);
  });
});
