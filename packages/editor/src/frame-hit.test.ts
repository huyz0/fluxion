import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { registries } from './__fixtures__/hit-shapes.js';
import { createHitIndex } from './hit-test.js';

const FRAME = 'frameframe01' as RecordId;
const INNER = 'innerframe01' as RecordId;
const MEMBER = 'membermember' as RecordId;

/** Frame F (100,100 200x100, with `frame`'s fields) holding rect m (250,150 100x20), which overflows its right edge by 50. */
function clipped(frame: Record<string, unknown> = {}) {
  const b = documentBuilder({ seed: 1911 });
  const screen = b.screen({ size: { w: 1000, h: 1000 } });
  const core = createCore(b.build());
  const put = (r: Record<string, unknown>) => {
    const done = core.execute('element.createMany', { elements: [{ type: 'element', screenId: screen, ...r }] });
    if (!done.ok) throw new Error(JSON.stringify(done));
  };
  put({ id: FRAME, kind: 'frame', index: 'a5', transform: { x: 100, y: 100, w: 200, h: 100, rot: 0 }, ...frame });
  put({ id: MEMBER, kind: 'shape', defId: 'basic:rect', index: 'a0', parentId: FRAME, transform: { x: 250, y: 150, w: 100, h: 20, rot: 0 } });
  const hits = createHitIndex(core.store, { registries: registries(), theme: LIGHT_THEME });
  return { core, screen, put, hits };
}

describe('clipping frames under hit-testing (FR-ARR-006, ADR-0052)', () => {
  it('FR-ARR-006: a member overflowing a clipping frame is hit inside the frame only; with clip false it is hit where it overflows', () => {
    const { core, screen, hits } = clipped();
    expect(hits.hitTest(screen, { x: 280, y: 160 }, 1)).toBe(MEMBER);
    expect(hits.hitTest(screen, { x: 320, y: 160 }, 1)).toBeUndefined();
    // the pick margin does not reach the member past the frame's edge: there the frame's own box is hit
    expect(hits.hitTest(screen, { x: 302, y: 160 }, 1)).toBe(FRAME);
    core.store.transact('unclip', (tx) => tx.patch(FRAME, { clip: false }));
    expect(hits.hitTest(screen, { x: 320, y: 160 }, 1)).toBe(MEMBER);
    hits.dispose();
  });

  it('FR-ARR-006: a marquee touches or contains a clipped member by what the frame shows of it', () => {
    const { core, screen, hits } = clipped();
    // across the hidden overflow only: nothing (across the shown part the frame itself is touched and stands for its child)
    expect(hits.within(screen, { x: 310, y: 140, w: 30, h: 40 }, 'intersect')).toEqual([]);
    // a box around the shown part (250..300 with its stroke) contains it, though the member reaches 350
    expect(hits.within(screen, { x: 240, y: 140, w: 70, h: 40 }, 'contain')).toEqual([MEMBER]);
    core.store.transact('unclip', (tx) => tx.patch(FRAME, { clip: false }));
    expect(hits.within(screen, { x: 310, y: 140, w: 30, h: 40 }, 'intersect')).toEqual([MEMBER]);
    expect(hits.within(screen, { x: 240, y: 140, w: 70, h: 40 }, 'contain')).toEqual([]);
    hits.dispose();
  });

  it('FR-ARR-006: the clip follows the frame: moved, turned, or inside another clipping frame', () => {
    const { core, screen, put, hits } = clipped();
    core.store.transact('move', (tx) => tx.patch(FRAME, { transform: { x: 200, y: 100, w: 200, h: 100, rot: 0 } }));
    expect(hits.hitTest(screen, { x: 320, y: 160 }, 1)).toBe(MEMBER);
    // turned 90° about its centre (300, 150), the frame spans x 250..350, y 50..250: the member's band is shown on 250..350
    core.store.transact('turn', (tx) => tx.patch(FRAME, { transform: { x: 200, y: 100, w: 200, h: 100, rot: 90 } }));
    expect(hits.hitTest(screen, { x: 340, y: 160 }, 1)).toBe(MEMBER);
    core.store.transact('narrow', (tx) => tx.patch(MEMBER, { transform: { x: 200, y: 150, w: 100, h: 20, rot: 0 } }));
    expect(hits.hitTest(screen, { x: 230, y: 160 }, 1)).toBeUndefined();
    expect(hits.within(screen, { x: 210, y: 140, w: 30, h: 40 }, 'intersect')).toEqual([]);
    expect(hits.within(screen, { x: 245, y: 140, w: 60, h: 40 }, 'contain')).toEqual([MEMBER]);
    // inside an inner clipping frame (250,140 30x40) of the turned one, only their overlap shows it
    core.store.transact('unturn', (tx) => tx.patch(FRAME, { transform: { x: 100, y: 100, w: 200, h: 100, rot: 0 } }));
    put({ id: INNER, kind: 'frame', index: 'a1', parentId: FRAME, transform: { x: 250, y: 140, w: 30, h: 40, rot: 0 } });
    core.store.transact('nest', (tx) => tx.patch(MEMBER, { parentId: INNER }));
    expect(hits.hitTest(screen, { x: 270, y: 160 }, 1)).toBe(MEMBER);
    expect(hits.hitTest(screen, { x: 290, y: 160 }, 1)).toBe(FRAME);
    hits.dispose();
  });
});
