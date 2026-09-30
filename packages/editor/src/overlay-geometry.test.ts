import { describe, expect, it } from 'vitest';
import { frameBox, HANDLE_PX, HANDLES, handleAt, ROTATE_OFFSET_PX, screenBox, selectionFrame } from './overlay-geometry.js';

const round = (p: { x: number; y: number }) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];

describe('overlay geometry (FR-EDT-004)', () => {
  it('FR-EDT-004: one element`s frame is its box on the canvas, handles at its corners and edge middles', () => {
    expect([HANDLE_PX, ROTATE_OFFSET_PX]).toEqual([8, 24]);
    expect(HANDLES.map(([id]) => id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    const f = selectionFrame([{ x: 100, y: 100, w: 200, h: 100 }], { x: 0, y: 0, z: 0.5 });
    expect(f?.corners.map(round)).toEqual([
      [50, 50],
      [150, 50],
      [150, 100],
      [50, 100],
    ]);
    expect(f?.rotation).toBe(0);
    expect(f?.handles.map(([id, p]) => [id, ...round(p)])).toEqual([
      ['nw', 50, 50],
      ['n', 100, 50],
      ['ne', 150, 50],
      ['e', 150, 75],
      ['se', 150, 100],
      ['s', 100, 100],
      ['sw', 50, 100],
      ['w', 50, 75],
    ]);
    // the rotate handle 24 canvas px above the top edge, at any zoom
    expect(round(f?.rotate ?? { x: 0, y: 0 })).toEqual([100, 26]);
    const near = selectionFrame([{ x: 100, y: 100, w: 200, h: 100 }], { x: 100, y: 100, z: 4 });
    expect(round(near?.rotate ?? { x: 0, y: 0 })).toEqual([400, -24]);
  });

  it('FR-EDT-004: a turned element`s frame turns with it; its rotate handle stays above its own top edge', () => {
    // turned 90° clockwise about its centre (200, 150): its top edge now faces right
    const f = selectionFrame([{ x: 100, y: 100, w: 200, h: 100, rot: 90, flipX: true }], { x: 0, y: 0, z: 1 });
    expect(f?.rotation).toBe(90);
    expect(f?.corners.map(round)).toEqual([
      [250, 50],
      [250, 250],
      [150, 250],
      [150, 50],
    ]);
    expect(round(f?.rotate ?? { x: 0, y: 0 })).toEqual([274, 150]);
  });

  it('FR-EDT-004: several elements share one upright frame around all their corners; none have no frame', () => {
    const f = selectionFrame(
      [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 300, y: 200, w: 100, h: 100, rot: 45 },
      ],
      { x: 0, y: 0, z: 1 },
    );
    const reach = 50 * Math.SQRT2;
    expect(f?.rotation).toBe(0);
    expect(f?.corners.map(round)).toEqual([
      [0, 0],
      round({ x: 350 + reach, y: 0 }),
      round({ x: 350 + reach, y: 250 + reach }),
      round({ x: 0, y: 250 + reach }),
    ]);
    expect(selectionFrame([], { x: 0, y: 0, z: 1 })).toBeUndefined();
    // a frame of no size has its rotate handle straight up
    const dot = selectionFrame([{ x: 10, y: 10, w: 0, h: 0 }], { x: 0, y: 0, z: 1 });
    expect(round(dot?.rotate ?? { x: 0, y: 0 })).toEqual([10, -14]);
  });

  it('FR-EDT-004: the frame box is one element`s own box and turn, or several elements` upright bounds', () => {
    expect(frameBox([{ x: 1, y: 2, w: 3, h: 4, rot: 30 }])).toEqual({ x: 1, y: 2, w: 3, h: 4, rot: 30 });
    expect(frameBox([{ x: 1, y: 2, w: 3, h: 4 }])).toEqual({ x: 1, y: 2, w: 3, h: 4, rot: 0 });
    expect(
      frameBox([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 5, w: 10, h: 10 },
      ]),
    ).toEqual({ x: 0, y: 0, w: 30, h: 15, rot: 0 });
    expect(frameBox([])).toBeUndefined();
  });

  it('FR-EDT-004: a press within a handle`s size picks it; the rotate handle, above the frame, first', () => {
    const f = selectionFrame([{ x: 100, y: 100, w: 200, h: 100 }], { x: 0, y: 0, z: 1 });
    // outside the frame within a handle's size; inside it only within its drawn half
    expect([handleAt(f, { x: 100, y: 100 }), handleAt(f, { x: 94, y: 96 }), handleAt(f, { x: 103, y: 102 }), handleAt(f, { x: 106, y: 104 })]).toEqual([
      'nw',
      'nw',
      'nw',
      undefined,
    ]);
    expect([handleAt(f, { x: 300, y: 150 }), handleAt(f, { x: 200, y: 200 })]).toEqual(['e', 's']);
    expect([handleAt(f, { x: 200, y: 76 }), handleAt(f, { x: 200, y: 150 }), handleAt(f, { x: 109, y: 100 })]).toEqual(['rotate', undefined, undefined]);
    expect(handleAt(undefined, { x: 0, y: 0 })).toBeUndefined();
    // a small frame (10 px): its middle is the element's; its corners and just outside them, handles
    const small = selectionFrame([{ x: 0, y: 0, w: 10, h: 10 }], { x: 0, y: 0, z: 1 });
    expect([handleAt(small, { x: 5, y: 5 }), handleAt(small, { x: 1, y: 1 }), handleAt(small, { x: -6, y: -3 }), handleAt(small, { x: 5, y: 5.5 })]).toEqual([
      undefined,
      'nw',
      'nw',
      undefined,
    ]);
    // turned frames too: inside by their own outline
    const turned = selectionFrame([{ x: 0, y: 0, w: 10, h: 10, rot: 45 }], { x: 0, y: 0, z: 1 });
    expect(handleAt(turned, { x: 5, y: 5 })).toBeUndefined();
  });

  it('FR-EDT-004: a page box (the marquee) is drawn through the camera', () => {
    expect(screenBox({ x: 100, y: 50, w: 40, h: 20 }, { x: 50, y: 0, z: 2 })).toEqual({ x: 100, y: 100, w: 80, h: 40 });
  });
});
