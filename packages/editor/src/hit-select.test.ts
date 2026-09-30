import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { registries } from './__fixtures__/hit-shapes.js';
import { createHitIndex } from './hit-test.js';

describe('hit index selection queries (FR-EDT-004)', () => {
  it('FR-EDT-004: a marquee box contains or touches drawn bounds, on its screen only, back to front', () => {
    const b = documentBuilder({ seed: 118 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const other = b.screen();
    const first = b.rect(screen, { x: 100, y: 100, w: 100, h: 100 });
    const second = b.rect(screen, { x: 300, y: 100, w: 100, h: 100 });
    const hidden = b.rect(screen, { x: 120, y: 120, w: 20, h: 20 });
    b.rect(other, { x: 100, y: 100, w: 100, h: 100 });
    const core = createCore(b.build());
    core.store.transact('hide', (tx) => tx.patch(hidden, { hidden: true }));
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    // the theme's 2 px stroke reaches 1 px past each box
    expect(hits.within(screen, { x: 98, y: 98, w: 104, h: 104 }, 'contain')).toEqual([first]);
    expect(hits.within(screen, { x: 100, y: 100, w: 100, h: 100 }, 'contain')).toEqual([]);
    for (const [x, y, w, h] of [
      [98, 98, 102.5, 104],
      [98, 98, 104, 102.5],
      [99.5, 98, 103, 104],
      [98, 99.5, 104, 103],
    ] as const)
      expect(hits.within(screen, { x, y, w, h }, 'contain')).toEqual([]);
    expect(hits.within(screen, { x: 150, y: 150, w: 200, h: 10 }, 'intersect')).toEqual([first, second]);
    expect(hits.within(screen, { x: 150, y: 150, w: 200, h: 10 }, 'contain')).toEqual([]);
    expect(hits.all(screen)).toEqual([first, second]);
    // back to front: brought forward, the first comes last
    core.store.transact('front', (tx) => tx.patch(first, { index: 'a9' }));
    expect(hits.all(screen)).toEqual([second, first]);
    expect(hits.within(screen, { x: 0, y: 0, w: 1000, h: 1000 }, 'contain')).toEqual([second, first]);
    hits.dispose();
  });

  it('FR-EDT-004: a marquee touches what is drawn, not the bounds: a diagonal connector, a turned box, a hollow shape', () => {
    const b = documentBuilder({ seed: 119 });
    const screen = b.screen({ size: { w: 2000, h: 2000 } });
    const link = b.connect({ x: 0, y: 0 }, { x: 1000, y: 1000 });
    const turned = b.text(screen, 'turned', { x: 1200, y: 100, w: 200, h: 40, rot: 45 });
    const hollow = b.rect(screen, { x: 1200, y: 800, w: 200, h: 200, style: { fill: 'transparent' } });
    const titled = b.rect(screen, { x: 1500, y: 1000, w: 200, h: 200, defId: 'test:inset', label: 'Hi', style: { fill: 'transparent' } });
    const core = createCore(b.build());
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    // empty canvas inside the connector's bounds, far from the line
    expect(hits.within(screen, { x: 800, y: 100, w: 100, h: 100 }, 'intersect')).toEqual([]);
    expect(hits.within(screen, { x: 450, y: 450, w: 100, h: 100 }, 'intersect')).toEqual([link]);
    // the turned box's upright bounds reach (1215, 35); its turned body, whose edge runs from (1215, 63)
    // to (1243, 35), does not
    expect(hits.within(screen, { x: 1215.5, y: 35.5, w: 7, h: 7 }, 'intersect')).toEqual([]);
    expect(hits.within(screen, { x: 1290, y: 110, w: 20, h: 20 }, 'intersect')).toEqual([turned]);
    // inside the hollow rectangle nothing is drawn; across its edge there is
    expect(hits.within(screen, { x: 1250, y: 850, w: 50, h: 50 }, 'intersect')).toEqual([]);
    expect(hits.within(screen, { x: 1190, y: 850, w: 50, h: 50 }, 'intersect')).toEqual([hollow]);
    // a label is drawn in its region (here the bottom-right quarter), over the hollow inside
    expect(hits.within(screen, { x: 1620, y: 1120, w: 20, h: 20 }, 'intersect')).toEqual([titled]);
    expect(hits.within(screen, { x: 1520, y: 1020, w: 20, h: 20 }, 'intersect')).toEqual([]);
    hits.dispose();
  });

  it('FR-EDT-004: a group or frame is selected as one: a marquee contains it only with all its members, touches it through any', () => {
    const b = documentBuilder({ seed: 121 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const inner = b.rect(screen, { x: 100, y: 100, w: 100, h: 100 });
    const outer = b.rect(screen, { x: 300, y: 100, w: 100, h: 100 });
    const alone = b.rect(screen, { x: 600, y: 100, w: 100, h: 100 });
    const core = createCore(b.build());
    const group = 'group0000000002' as RecordId;
    core.store.transact('group', (tx) => {
      tx.put({ id: group, type: 'element', kind: 'group', screenId: screen, index: 'a5', transform: { x: 100, y: 100, w: 300, h: 100 } } as never);
      tx.patch(inner, { parentId: group });
      tx.patch(outer, { parentId: group });
    });
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    expect([hits.selectableOf(inner), hits.selectableOf(outer), hits.selectableOf(alone), hits.selectableOf(group)]).toEqual([group, group, alone, group]);
    // around one member only: not the group
    expect(hits.within(screen, { x: 90, y: 90, w: 120, h: 120 }, 'contain')).toEqual([]);
    expect(hits.within(screen, { x: 90, y: 90, w: 320, h: 120 }, 'contain')).toEqual([group]);
    expect(hits.within(screen, { x: 150, y: 150, w: 10, h: 10 }, 'intersect')).toEqual([group]);
    // select all: the top-level elements, back to front
    expect(hits.all(screen)).toEqual([alone, group]);
    hits.dispose();
  });

  it('FR-EDT-004: a frame`s children are selected alone; a frame picked with its children stands for them; groups nest', () => {
    const b = documentBuilder({ seed: 122 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const child = b.rect(screen, { x: 120, y: 120, w: 60, h: 60 });
    const member = b.rect(screen, { x: 600, y: 100, w: 50, h: 50 });
    // a child reaching past its frame's edge: the frame alone is still contained without it
    const poking = b.rect(screen, { x: 280, y: 250, w: 60, h: 30 });
    const core = createCore(b.build());
    const frame = 'frame0000000001' as RecordId;
    const [outer, inner] = ['groupouter00001', 'groupinner00001'] as [RecordId, RecordId];
    core.store.transact('nest', (tx) => {
      tx.put({ id: frame, type: 'element', kind: 'frame', screenId: screen, index: 'a4', transform: { x: 100, y: 100, w: 200, h: 200 } } as never);
      tx.patch(child, { parentId: frame });
      tx.patch(poking, { parentId: frame });
      tx.put({ id: outer, type: 'element', kind: 'group', screenId: screen, index: 'a5', transform: { x: 600, y: 100, w: 50, h: 50 } } as never);
      tx.put({
        id: inner,
        type: 'element',
        kind: 'group',
        screenId: screen,
        index: 'a0',
        parentId: outer,
        transform: { x: 600, y: 100, w: 50, h: 50 },
      } as never);
      tx.patch(member, { parentId: inner });
    });
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    // a click on the frame's child picks the child; on a nested group's member, the outermost group
    expect([hits.selectableOf(child), hits.selectableOf(frame), hits.selectableOf(member), hits.selectableOf(inner)]).toEqual([child, frame, outer, outer]);
    // a marquee around the child alone picks it; around the frame, the frame alone (not its child too)
    expect(hits.within(screen, { x: 110, y: 110, w: 80, h: 80 }, 'contain')).toEqual([child]);
    expect(hits.within(screen, { x: 90, y: 90, w: 220, h: 220 }, 'contain')).toEqual([frame]);
    expect(hits.within(screen, { x: 90, y: 90, w: 260, h: 220 }, 'contain')).toEqual([frame]);
    expect(hits.within(screen, { x: 140, y: 140, w: 10, h: 10 }, 'intersect')).toEqual([frame]);
    expect(hits.within(screen, { x: 590, y: 90, w: 70, h: 70 }, 'contain')).toEqual([outer]);
    // select all: what sits in nothing else picked
    expect(hits.all(screen)).toEqual([frame, outer]);
    hits.dispose();
  });

  it('FR-EDT-004: a marquee touches a stroke where it is drawn, out to its reach, without crossing the outline', () => {
    const b = documentBuilder({ seed: 123 });
    const screen = b.screen({ size: { w: 1000, h: 1000 } });
    const link = b.connect({ x: 0, y: 500 }, { x: 400, y: 500 });
    const hollow = b.rect(screen, { x: 600, y: 400, w: 200, h: 200, style: { fill: 'transparent', stroke: { width: 20 } } });
    const core = createCore(b.build());
    core.store.transact('thick', (tx) => tx.patch(link, { style: { stroke: { width: 20 } } }));
    const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
    // 10 px of stroke each side: a box from 505 down, off the centre line, still touches it; from 515 not
    expect(hits.within(screen, { x: 100, y: 505, w: 50, h: 20 }, 'intersect')).toEqual([link]);
    expect(hits.within(screen, { x: 100, y: 515, w: 50, h: 20 }, 'intersect')).toEqual([]);
    expect(hits.within(screen, { x: 650, y: 385, w: 50, h: 10 }, 'intersect')).toEqual([hollow]);
    expect(hits.within(screen, { x: 650, y: 370, w: 50, h: 10 }, 'intersect')).toEqual([]);
    // an inside stroke is drawn 20 px in from the outline: a box 5 px in touches it
    core.store.transact('inside', (tx) => tx.patch(hollow, { style: { fill: 'transparent', stroke: { width: 20, align: 'inside' } } }));
    expect(hits.within(screen, { x: 650, y: 405, w: 50, h: 5 }, 'intersect')).toEqual([hollow]);
    expect(hits.within(screen, { x: 650, y: 440, w: 50, h: 5 }, 'intersect')).toEqual([]);
    hits.dispose();
  });
});
