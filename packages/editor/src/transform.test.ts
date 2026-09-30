import { describe, expect, it } from 'vitest';
import { type Box2, carry, handlePoint, MIN_SIZE, ROTATE_STEP, resize, rotation } from './transform.js';

const box: Box2 = { x: 0, y: 0, w: 100, h: 50, rot: 0 };
const plain = { shift: false, alt: false };
const round = (b: Box2) => ({ x: +b.x.toFixed(6), y: +b.y.toFixed(6), w: +b.w.toFixed(6), h: +b.h.toFixed(6), rot: b.rot });

describe('resize and rotate (FR-EDT-004)', () => {
  it('FR-EDT-004: every resize handle moves its edges; shift keeps the aspect, alt resizes about the centre', () => {
    expect([MIN_SIZE, ROTATE_STEP]).toEqual([1, 15]);
    // each handle moves the edges it sits on, the opposite ones stay
    expect(resize(box, 'se', { x: 150, y: 80 }, plain)).toEqual({ x: 0, y: 0, w: 150, h: 80, rot: 0 });
    expect(resize(box, 'nw', { x: -20, y: -10 }, plain)).toEqual({ x: -20, y: -10, w: 120, h: 60, rot: 0 });
    expect(resize(box, 'ne', { x: 110, y: -10 }, plain)).toEqual({ x: 0, y: -10, w: 110, h: 60, rot: 0 });
    expect(resize(box, 'sw', { x: 10, y: 70 }, plain)).toEqual({ x: 10, y: 0, w: 90, h: 70, rot: 0 });
    expect(resize(box, 'n', { x: 999, y: -30 }, plain)).toEqual({ x: 0, y: -30, w: 100, h: 80, rot: 0 });
    expect(resize(box, 's', { x: 999, y: 20 }, plain)).toEqual({ x: 0, y: 0, w: 100, h: 20, rot: 0 });
    expect(resize(box, 'e', { x: 130, y: 999 }, plain)).toEqual({ x: 0, y: 0, w: 130, h: 50, rot: 0 });
    expect(resize(box, 'w', { x: 30, y: 999 }, plain)).toEqual({ x: 30, y: 0, w: 70, h: 50, rot: 0 });
    // dragged past the opposite edge, a side stops at the least size
    expect(resize(box, 'e', { x: -50, y: 0 }, plain)).toEqual({ x: 0, y: 0, w: 1, h: 50, rot: 0 });
    expect(resize(box, 'n', { x: 0, y: 500 }, plain)).toEqual({ x: 0, y: 49, w: 100, h: 1, rot: 0 });
    // shift: the side dragged furthest sets the scale of both
    expect(resize(box, 'se', { x: 200, y: 60 }, { shift: true, alt: false })).toEqual({ x: 0, y: 0, w: 200, h: 100, rot: 0 });
    expect(resize(box, 'nw', { x: 90, y: -50 }, { shift: true, alt: false })).toEqual({ x: -100, y: -50, w: 200, h: 100, rot: 0 });
    // a side handle with shift scales the other side about its middle
    expect(resize(box, 'e', { x: 200, y: 0 }, { shift: true, alt: false })).toEqual({ x: 0, y: -25, w: 200, h: 100, rot: 0 });
    expect(resize(box, 's', { x: 0, y: 100 }, { shift: true, alt: false })).toEqual({ x: -50, y: 0, w: 200, h: 100, rot: 0 });
    // shrinking with shift: a side handle scales the other side down too
    expect(resize(box, 's', { x: 0, y: 25 }, { shift: true, alt: false })).toEqual({ x: 25, y: 0, w: 50, h: 25, rot: 0 });
    expect(resize(box, 'e', { x: 50, y: 0 }, { shift: true, alt: false })).toEqual({ x: 0, y: 12.5, w: 50, h: 25, rot: 0 });
    // alt: about the centre
    expect(resize(box, 'e', { x: 150, y: 0 }, { shift: false, alt: true })).toEqual({ x: -50, y: 0, w: 200, h: 50, rot: 0 });
    expect(resize(box, 'nw', { x: 40, y: 20 }, { shift: false, alt: true })).toEqual({ x: 40, y: 20, w: 20, h: 10, rot: 0 });
    expect(resize(box, 'n', { x: 0, y: 25 }, { shift: false, alt: true })).toEqual({ x: 0, y: 24.5, w: 100, h: 1, rot: 0 });
    expect(resize(box, 'se', { x: 150, y: 50 }, { shift: true, alt: true })).toEqual({ x: -50, y: -25, w: 200, h: 100, rot: 0 });
  });

  it('FR-EDT-004: a turned box is resized in its own frame, its opposite side staying where it is', () => {
    // turned 90° clockwise: its own x axis points down the page
    const turned = { ...box, rot: 90 };
    expect(round(resize(turned, 'e', { x: 50, y: 100 }, plain))).toEqual({ x: -12.5, y: 12.5, w: 125, h: 50, rot: 90 });
    // its w edge stays: the page point (50, -25) before and after
    const after = resize(turned, 'e', { x: 50, y: 100 }, plain);
    const lowEdge = (b: Box2) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 - b.w / 2 });
    expect(round({ ...lowEdge(after), w: 0, h: 0, rot: 0 })).toEqual(round({ ...lowEdge(turned), w: 0, h: 0, rot: 0 }));
  });

  it('FR-EDT-004: a point is carried to the same place in a resized or turned frame', () => {
    // the frame doubled rightwards: a point at its middle lands at the new middle
    expect(carry(box, { ...box, w: 200 }, { x: 50, y: 25 })).toEqual({ x: 100, y: 25 });
    expect(carry(box, { ...box, w: 200 }, { x: 100, y: 0 })).toEqual({ x: 200, y: 0 });
    // turned a quarter about its centre: the right edge's middle goes to the bottom
    const turned = carry(box, { ...box, rot: 90 }, { x: 100, y: 25 });
    expect([+turned.x.toFixed(9), +turned.y.toFixed(9)]).toEqual([50, 75]);
    // from a turned frame: its own x axis points down the page; stretched along it, a point on it moves down
    const from = { ...box, rot: 90 };
    const stretched = carry(from, { ...from, w: 200 }, { x: 50, y: 75 });
    expect([+stretched.x.toFixed(9), +stretched.y.toFixed(9)]).toEqual([100, 125]);
    // a frame of no width or height scales nothing along it
    const line = { x: 0, y: 0, w: 0, h: 10, rot: 0 };
    expect(carry(line, { ...line, w: 0, h: 20 }, { x: 0, y: 10 })).toEqual({ x: 0, y: 20 });
    expect(carry({ ...line, w: 10, h: 0 }, { ...line, w: 20, h: 0 }, { x: 10, y: 0 })).toEqual({ x: 20, y: 0 });
  });

  it('FR-EDT-004: a handle`s place on the page, its frame`s turn included', () => {
    const b = { x: 0, y: 0, w: 100, h: 50, rot: 0 };
    expect([handlePoint(b, 'nw'), handlePoint(b, 'e'), handlePoint(b, 's')]).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 25 },
      { x: 50, y: 50 },
    ]);
    // turned a quarter about its centre (50, 25): its east edge's middle faces down
    const e = handlePoint({ ...b, rot: 90 }, 'e');
    const nw = handlePoint({ ...b, rot: 90 }, 'nw');
    expect([+e.x.toFixed(9), +e.y.toFixed(9), +nw.x.toFixed(9), +nw.y.toFixed(9)]).toEqual([50, 75, 75, -25]);
  });

  it('FR-EDT-004: shift snaps rotation to 15° steps', () => {
    // the centre is (50, 25); from straight above it, a quarter turn right
    const up = { x: 50, y: -100 };
    expect(rotation(box, up, { x: 150, y: 25 }, false)).toBe(90);
    expect(rotation(box, up, { x: 150, y: 30 }, false)).toBeCloseTo(92.862, 3);
    expect(rotation(box, up, { x: 150, y: 30 }, true)).toBe(90);
    expect(rotation(box, up, { x: 150, y: 60 }, true)).toBe(105);
    // anticlockwise, and past a full turn, within [0, 360)
    expect(rotation(box, up, { x: -50, y: 25 }, false)).toBe(270);
    expect(rotation({ ...box, rot: 350 }, up, { x: 150, y: -300 }, true)).toBe(0);
    expect(rotation({ ...box, rot: 350 }, up, { x: 100, y: -60 }, false)).toBeCloseTo(20.466, 2);
    expect(rotation(box, up, { x: 55, y: -100 }, true)).toBe(0);
  });
});
