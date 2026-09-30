import { createCore } from '@fluxion/core';
import type { Router } from '@fluxion/routing';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { FRAME, registries } from './__fixtures__/hit-shapes.js';
import { createHitIndex, PICK_PX } from './hit-test.js';

describe('hit-testing (FR-EDT-004)', () => {
  it('FR-EDT-004: rotated, hollow and thin-stroke shapes hit where they are drawn', () => {
    const b = documentBuilder({ seed: 110 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const rotated = b.rect(screen, { x: 100, y: 100, w: 200, h: 100, rot: 45, style: { stroke: { width: 1 } } });
    const hollow = b.rect(screen, { x: 500, y: 100, w: 200, h: 100, style: { fill: 'transparent', stroke: { width: 2 } } });
    const line = b.rect(screen, { x: 400, y: 400, w: 200, h: 16, defId: 'basic:line', style: { stroke: { width: 1 } } });
    const core = createCore(b.build());
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    const at = (x: number, y: number, zoom = 1) => hits.hitTest(screen, { x, y }, zoom);
    // rotated 45° about its centre (200, 150): drawn beyond its unrotated box, and not in that box's corners
    expect(at(200, 150)).toBe(rotated);
    expect(at(140, 90)).toBe(rotated);
    expect(at(105, 195)).toBeUndefined();
    // hollow: its inside is empty, its stroke (1 px out, plus the pick margin) is not
    expect(at(600, 150)).toBeUndefined();
    expect(at(600, 100)).toBe(hollow);
    expect(at(600, 96)).toBe(hollow);
    expect(at(600, 90)).toBeUndefined();
    // a 1 px line, open: hit along its stroke within the pick margin, which grows as the zoom shrinks
    expect(at(500, 408)).toBe(line);
    expect(at(500, 408 + 0.5 + PICK_PX - 0.1)).toBe(line);
    expect(at(500, 420)).toBeUndefined();
    expect(at(500, 420, 0.25)).toBe(line);
    // its box's height is not drawn
    expect(at(500, 401)).toBeUndefined();
    hits.dispose();
  });

  it('FR-EDT-004: a stroke is hit where it is drawn: centred, inside or outside its outline, at its width', () => {
    const b = documentBuilder({ seed: 113 });
    const screen = b.screen({ size: { w: 2000, h: 1000 } });
    const hollow = (x: number, stroke: Record<string, unknown>) =>
      b.rect(screen, { x, y: 100, w: 200, h: 200, style: { fill: 'transparent', stroke } as never });
    // the theme's stroke (`{stroke.regular}`, 2 px, centred)
    const themed = b.rect(screen, { x: 0, y: 100, w: 200, h: 200, style: { fill: 'transparent' } });
    const centred = hollow(300, { width: 20 });
    const inside = hollow(600, { width: 20, align: 'inside' });
    const outside = hollow(900, { width: 20, align: 'outside' });
    const clear = hollow(1200, { width: 20, color: 'transparent' });
    // round joins: no spikes to widen its bounds, so only the band's growth reaches past the outline
    const roundJoined = b.rect(screen, { x: 300, y: 500, w: 200, h: 200, style: { fill: 'transparent', stroke: { width: 20, join: 'round' } } });
    const unfilled = b.rect(screen, { x: 1500, y: 100, w: 200, h: 200, defId: 'test:frame' });
    const core = createCore(b.build());
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    // d above the top edge (y = 100), or below it inside the shape when d < 0
    const above = (x: number, d: number) => hits.hitTest(screen, { x: x + 100, y: 100 - d }, 1);
    expect([above(0, 5), above(0, 5.5)]).toEqual([themed, undefined]);
    expect([above(300, 14), above(300, 14.5), above(300, -14), above(300, -14.5)]).toEqual([centred, undefined, centred, undefined]);
    // drawn beyond the outline on every side: the index grows each box by the stroke's reach
    expect([
      hits.hitTest(screen, { x: 287, y: 200 }, 1),
      hits.hitTest(screen, { x: 513, y: 200 }, 1),
      hits.hitTest(screen, { x: 400, y: 313 }, 1),
      hits.hitTest(screen, { x: 400, y: 87 }, 1),
    ]).toEqual([centred, centred, centred, centred]);
    expect([
      hits.hitTest(screen, { x: 287, y: 600 }, 1),
      hits.hitTest(screen, { x: 513, y: 600 }, 1),
      hits.hitTest(screen, { x: 400, y: 713 }, 1),
      hits.hitTest(screen, { x: 400, y: 487 }, 1),
    ]).toEqual([roundJoined, roundJoined, roundJoined, roundJoined]);
    // inside: the 20 px lie within the outline; the pick margin reaches past both of its sides
    expect([above(600, -24), above(600, -25), above(600, 4), above(600, 5)]).toEqual([inside, undefined, inside, undefined]);
    // outside: the 20 px lie beyond it, plus the pick margin; inside only the margin
    expect([above(900, 24), above(900, 25), above(900, -4), above(900, -5)]).toEqual([outside, undefined, outside, undefined]);
    // a transparent stroke draws nothing: only the outline's pick margin
    expect([above(1200, 4), above(1200, 5)]).toEqual([clear, undefined]);
    // a definition's default style applies: this one is unfilled
    expect([hits.hitTest(screen, { x: 1600, y: 200 }, 1), above(1500, 0)]).toEqual([undefined, unfilled]);
    hits.dispose();
  });

  it('FR-EDT-004: a miter-joined stroke is hit on its spikes; a round join has none; a label is hit over a hollow inside', () => {
    const b = documentBuilder({ seed: 115 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    // the theme's join is miter; a 20 px centred stroke on the triangle's 45° corner at (100, 0)
    const mitred = b.rect(screen, { x: 0, y: 0, w: 100, h: 100, defId: 'test:triangle', style: { stroke: { width: 20 } } });
    const rounded = b.rect(screen, { x: 400, y: 0, w: 100, h: 100, defId: 'test:triangle', style: { stroke: { width: 20, join: 'round' } } });
    const titled = b.rect(screen, { x: 0, y: 400, w: 200, h: 100, label: 'Start', style: { fill: 'transparent' } });
    b.rect(screen, { x: 400, y: 400, w: 200, h: 100, label: '', style: { fill: 'transparent' } });
    const bare = b.rect(screen, { x: 700, y: 400, w: 200, h: 100, style: { fill: 'transparent' } });
    const notched = b.rect(screen, { x: 600, y: 0, w: 200, h: 200, defId: 'test:notched', style: { fill: 'transparent', stroke: { width: 40 } } });
    const core = createCore(b.build());
    // a paragraph with no content key draws nothing either
    core.store.transact('bare', (tx) => tx.patch(bare, { text: { type: 'doc', content: [{ type: 'paragraph' }] } }));
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    // along the corner's bisector: its miter tip is 10 / sin(22.5°) ≈ 26.1 px out
    const bisector = { x: Math.cos(Math.PI / 8), y: -Math.sin(Math.PI / 8) };
    const out = (x0: number, d: number) => hits.hitTest(screen, { x: x0 + 100 + bisector.x * d, y: bisector.y * d }, 1);
    expect([out(0, 20), out(0, 29), out(0, 31)]).toEqual([mitred, mitred, undefined]);
    // an outside stroke is drawn twice as wide and masked inside: its spike at the corner reaches
    // twice as far; an inside one is clipped, so its outward spikes are not drawn
    core.store.transact('outside', (tx) => tx.patch(mitred, { style: { stroke: { width: 10, align: 'outside' } } }));
    expect([out(0, 20), out(0, 29), out(0, 31)]).toEqual([mitred, mitred, undefined]);
    core.store.transact('inside', (tx) => tx.patch(mitred, { style: { stroke: { width: 10, align: 'inside' } } }));
    expect([out(0, 3), out(0, 5), out(0, 20)]).toEqual([mitred, undefined, undefined]);
    // round: only the band, 10 + 4 px
    expect([out(400, 13.5), out(400, 20)]).toEqual([rounded, undefined]);
    // a centred stroke's spike at a concave corner points into the shape: the notch's corner at
    // (700, 100) has its 40 px stroke's tip 20 * √2 ≈ 28.3 px above it, past the band's 20 + 4
    expect([hits.hitTest(screen, { x: 700, y: 75 }, 1), hits.hitTest(screen, { x: 700, y: 60 }, 1)]).toEqual([notched, undefined]);
    // a label is drawn over the hollow inside; an empty one draws nothing there
    expect([hits.hitTest(screen, { x: 100, y: 450 }, 1), hits.hitTest(screen, { x: 500, y: 450 }, 1), hits.hitTest(screen, { x: 800, y: 450 }, 1)]).toEqual([
      titled,
      undefined,
      undefined,
    ]);
    hits.dispose();
  });

  it('FR-EDT-004: flipped shapes and element boxes hit where they are drawn, within the pick margin', () => {
    const b = documentBuilder({ seed: 114 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const plain = b.rect(screen, { x: 0, y: 0, w: 100, h: 100, defId: 'test:triangle' });
    const text = b.text(screen, 'label', { x: 300, y: 0, w: 100, h: 40 });
    const turned = b.text(screen, 'turned', { x: 500, y: 500, w: 200, h: 40, rot: 45 });
    const core = createCore(b.build());
    const flipped = (id: RecordId, flip: Record<string, boolean>) =>
      core.store.transact('flip', (tx) => tx.patch(id, { transform: { x: 0, y: 0, w: 100, h: 100, ...flip } }));
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    const at = (x: number, y: number) => hits.hitTest(screen, { x, y }, 1);
    // the right angle at the top-left; flipped, at the top-right; flipped the other way, at the bottom-left
    expect([at(15, 45), at(90, 60), at(60, 90)]).toEqual([plain, undefined, undefined]);
    flipped(plain, { flipX: true });
    expect([at(15, 45), at(90, 60), at(60, 90)]).toEqual([undefined, plain, undefined]);
    flipped(plain, { flipY: true });
    expect([at(15, 45), at(90, 60), at(60, 90)]).toEqual([plain, undefined, plain]);
    // a box: 3 px out on any side is within the 4 px margin, 5 px is not
    expect([at(297, 20), at(403, 20), at(350, -3), at(350, 43)]).toEqual([text, text, text, text]);
    expect([at(295, 20), at(405, 20), at(350, -5), at(350, 45)]).toEqual([undefined, undefined, undefined, undefined]);
    // a turned box is hit within its turned edges: its centre (600, 520) and along its turned length,
    // but not points inside its upright bounds 10 or more px past each turned edge (local (100, 80),
    // (100, -40), (210, 20) and (-10, 20))
    expect([at(600, 520), at(650, 570), at(550, 470)]).toEqual([turned, turned, turned]);
    expect([at(557.6, 562.4), at(642.4, 477.6), at(677.8, 597.8), at(522.2, 442.2)]).toEqual([undefined, undefined, undefined, undefined]);
    hits.dispose();
  });

  it('FR-EDT-004: the topmost drawn element wins; hidden ones, groups and other screens are not hit', () => {
    const b = documentBuilder({ seed: 111 });
    const screen = b.screen();
    const other = b.screen();
    const below = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
    const above = b.rect(screen, { x: 50, y: 50, w: 100, h: 100 });
    const text = b.text(screen, 'label', { x: 300, y: 0, w: 100, h: 40 });
    const elsewhere = b.rect(other, { x: 0, y: 0, w: 100, h: 100 });
    const broken = b.rect(screen, { x: 600, y: 0, w: 50, h: 50, defId: 'test:broken' });
    const unknown = b.rect(screen, { x: 700, y: 0, w: 50, h: 50, defId: 'test:missing' });
    const core = createCore(b.build());
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    expect(hits.hitTest(screen, { x: 75, y: 75 }, 1)).toBe(above);
    expect(hits.hitTest(screen, { x: 25, y: 25 }, 1)).toBe(below);
    expect(hits.hitTest(screen, { x: 350, y: 20 }, 1)).toBe(text);
    expect(hits.hitTest(other, { x: 75, y: 75 }, 1)).toBe(elsewhere);
    // a shape whose outline does not evaluate, or whose definition is unknown, is hit as its box
    expect(hits.hitTest(screen, { x: 625, y: 25 }, 1)).toBe(broken);
    expect(hits.hitTest(screen, { x: 725, y: 25 }, 1)).toBe(unknown);
    core.store.transact('hide', (tx) => tx.patch(above, { hidden: true }));
    expect(hits.hitTest(screen, { x: 75, y: 75 }, 1)).toBe(below);
    // members of a hidden group are not drawn; the group itself is never hit
    const group = 'group0000000001' as RecordId;
    core.store.transact('group', (tx) => {
      tx.put({ id: group, type: 'element', kind: 'group', screenId: screen, index: 'a0V', transform: { x: 0, y: 0, w: 100, h: 100 }, hidden: true } as never);
      tx.patch(below, { parentId: group });
    });
    expect(hits.hitTest(screen, { x: 25, y: 25 }, 1)).toBeUndefined();
    core.store.transact('show', (tx) => tx.patch(group, { hidden: false }));
    expect(hits.hitTest(screen, { x: 25, y: 25 }, 1)).toBe(below);
    // the group's own box draws nothing
    core.store.transact('widen', (tx) => tx.patch(group, { transform: { x: 0, y: 0, w: 300, h: 300 } }));
    expect(hits.hitTest(screen, { x: 250, y: 250 }, 1)).toBeUndefined();
    core.store.transact('reveal', (tx) => tx.patch(above, { hidden: false }));
    // the group sorts between `below`'s old place and `above`, so `above` still draws on top of its member
    expect(hits.hitTest(screen, { x: 75, y: 75 }, 1)).toBe(above);
    // moved to the front, the group's member draws above `above`
    core.store.transact('front', (tx) => tx.patch(group, { index: 'a9' }));
    expect(hits.hitTest(screen, { x: 75, y: 75 }, 1)).toBe(below);
    hits.dispose();
  });

  it('FR-EDT-004: siblings with one index are ordered as render draws them, by id, whatever order they were added in', () => {
    const b = documentBuilder({ seed: 116 });
    const screen = b.screen();
    const doc = b.build();
    const rect = (id: string, x: number) =>
      ({ id, type: 'element', kind: 'shape', defId: 'basic:rect', screenId: screen, index: 'a0', transform: { x, y: 0, w: 100, h: 100 } }) as never;
    const core = createCore(doc);
    // the greater id first in one pair, last in the other
    core.store.transact('ties', (tx) => {
      for (const r of [rect('zzzzzzzzzzzzzzz1', 0), rect('aaaaaaaaaaaaaaa1', 0), rect('aaaaaaaaaaaaaaa2', 300), rect('zzzzzzzzzzzzzzz2', 300)]) tx.put(r);
    });
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    expect([hits.hitTest(screen, { x: 50, y: 50 }, 1), hits.hitTest(screen, { x: 350, y: 50 }, 1)]).toEqual(['zzzzzzzzzzzzzzz1', 'zzzzzzzzzzzzzzz2']);
    hits.dispose();
  });

  it('FR-EDT-004: a shape definition or router registered later changes what is hit', () => {
    const b = documentBuilder({ seed: 117 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const late = b.rect(screen, { x: 0, y: 0, w: 200, h: 200, defId: 'test:late' });
    const a = b.rect(screen, { x: 0, y: 400, w: 100, h: 100 });
    const c = b.rect(screen, { x: 400, y: 400, w: 100, h: 100 });
    const link = b.connect(a, c);
    const core = createCore(b.build());
    const reg = registries();
    const hits = createHitIndex(core.store, { registries: reg, theme: LIGHT_THEME });
    // unknown, the shape is hit as its box
    expect(hits.hitTest(screen, { x: 100, y: 100 }, 1)).toBe(late);
    reg.shapeDefs.register('test:late', { ...FRAME, id: 'test:late' }, 'test');
    expect(hits.hitTest(screen, { x: 100, y: 100 }, 1)).toBeUndefined();
    expect(hits.hitTest(screen, { x: 250, y: 450 }, 1)).toBe(link);
    // a router that detours 100 px below the straight line (a route starts at its source point)
    const detour: Router = {
      route: ({ source, target }) => [
        { kind: 'M', to: source.point },
        { kind: 'L', to: { x: source.point.x, y: source.point.y + 100 } },
        { kind: 'L', to: { x: target.point.x, y: target.point.y + 100 } },
        { kind: 'L', to: target.point },
      ],
    };
    const registered = reg.routers.register('straight', detour, 'test');
    expect([hits.hitTest(screen, { x: 250, y: 450 }, 1), hits.hitTest(screen, { x: 250, y: 550 }, 1)]).toEqual([undefined, link]);
    hits.dispose();
    // disposed, it follows the registries no longer
    if (registered.ok) registered.value.dispose();
    expect(hits.hitTest(screen, { x: 250, y: 550 }, 1)).toBe(link);
  });

  it('FR-EDT-004: the index follows the store: moves, deletes, and connectors moved by their ends', () => {
    const b = documentBuilder({ seed: 112 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
    const c = b.rect(screen, { x: 400, y: 0, w: 100, h: 100 });
    const link = b.connect(a, c);
    const core = createCore(b.build());
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    // the straight connector runs between the two boxes
    expect(hits.hitTest(screen, { x: 250, y: 50 }, 1)).toBe(link);
    // a route is open, so its stroke is centred whatever the style says: 20 px wide reaches 10 + 4 px
    core.store.transact('thick', (tx) => tx.patch(link, { style: { stroke: { width: 20, align: 'outside' } } }));
    expect([hits.hitTest(screen, { x: 250, y: 64 }, 1), hits.hitTest(screen, { x: 250, y: 66 }, 1)]).toEqual([link, undefined]);
    core.store.transact('move', (tx) => tx.patch(c, { transform: { x: 400, y: 400, w: 100, h: 100 } }));
    expect(hits.hitTest(screen, { x: 450, y: 50 }, 1)).toBeUndefined();
    expect(hits.hitTest(screen, { x: 450, y: 450 }, 1)).toBe(c);
    expect(hits.hitTest(screen, { x: 250, y: 50 }, 1)).toBeUndefined();
    // the connector now runs down to c
    expect(hits.hitTest(screen, { x: 250, y: 250 }, 1)).toBe(link);
    // a changed binding moves its connector: bound to d instead, it runs along the top
    const d = 'rectd00000000001' as RecordId;
    const target = core.store.members('bindingsByElement', c)[0] as RecordId;
    core.store.transact('rebind', (tx) => {
      tx.put({ ...(core.store.get(c) as object), id: d, index: 'a9', transform: { x: 800, y: 0, w: 100, h: 100 } } as never);
      tx.patch(target, { elementId: d });
    });
    expect(hits.hitTest(screen, { x: 250, y: 250 }, 1)).toBeUndefined();
    expect(hits.hitTest(screen, { x: 450, y: 50 }, 1)).toBe(link);
    core.store.transact('delete', (tx) => {
      for (const id of core.store.ids()) if ((core.store.get(id) as { type?: string }).type === 'binding') tx.delete(id);
      tx.delete(link);
      tx.delete(c);
    });
    expect(hits.hitTest(screen, { x: 450, y: 450 }, 1)).toBeUndefined();
    hits.dispose();
    core.store.transact('move', (tx) => tx.patch(a, { transform: { x: 600, y: 600, w: 100, h: 100 } }));
    // disposed: the index no longer follows
    expect(hits.hitTest(screen, { x: 650, y: 650 }, 1)).toBeUndefined();
    expect(hits.hitTest(screen, { x: 50, y: 50 }, 1)).toBe(a);
  });
});
