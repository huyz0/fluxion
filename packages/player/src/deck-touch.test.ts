import { describe, expect, it } from 'vitest';
import { boundedView, FIT, MAX_ZOOM, TouchGestures } from './deck-touch.js';

const SIZE = { w: 400, h: 300 };
function make(): { g: TouchGestures; at: (ms: number) => void } {
  const clock = { now: 0 };
  return {
    g: new TouchGestures(
      () => SIZE,
      () => clock.now,
    ),
    at: (ms) => {
      clock.now = ms;
    },
  };
}
/** A finger from (x0, y0) to (x1, y1) in `ms`. */
function stroke(m: ReturnType<typeof make>, from: [number, number], to: [number, number], ms: number) {
  const id = 1;
  m.at(0);
  m.g.down(id, from[0], from[1]);
  m.g.move(id, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  m.g.move(id, to[0], to[1]);
  m.at(ms);
  return m.g.up(id);
}
/** Two fingers spread from `a` apart to `b` apart, around (200, 150). */
function pinch(m: ReturnType<typeof make>, a: number, b: number) {
  m.g.down(1, 200 - a, 150);
  m.g.down(2, 200 + a, 150);
  m.g.move(2, 200 + b, 150);
  return m.g.move(1, 200 - b, 150);
}

describe('touch gestures on the deck (FR-RSP-001)', () => {
  it('FR-RSP-001: a quick swipe left goes to the next screen and a swipe right to the previous; a short, slow or mostly vertical one does nothing', () => {
    const m = make();
    expect(stroke(m, [300, 150], [100, 160], 200)).toEqual({ kind: 'next' });
    expect(stroke(m, [100, 150], [300, 140], 200)).toEqual({ kind: 'prev' });
    expect(stroke(m, [200, 150], [180, 150], 100)).toBeUndefined();
    expect(stroke(m, [300, 150], [100, 150], 2000)).toBeUndefined();
    expect(stroke(m, [200, 50], [150, 250], 200)).toBeUndefined();
  });

  it('FR-RSP-001: a pinch zooms from where the fingers are, never past the bounds, and the screen stays over the stage', () => {
    const m = make();
    const out = pinch(m, 40, 80);
    expect(out).toMatchObject({ kind: 'view', view: { zoom: expect.closeTo(2, 5) } });
    const far = pinch(make(), 10, 1000);
    expect(far).toMatchObject({ view: { zoom: MAX_ZOOM } });
    // a pinch closed past fit stops at fit
    const closed = make();
    closed.g.down(1, 150, 150);
    closed.g.down(2, 250, 150);
    expect(closed.g.move(2, 160, 150)).toMatchObject({ view: { zoom: 1 } });
    for (const e of [out, far]) {
      const v = (e as { view: { zoom: number; x: number; y: number } }).view;
      expect(v.x).toBeLessThanOrEqual(0);
      expect(v.x).toBeGreaterThanOrEqual(SIZE.w * (1 - v.zoom));
      expect(v.y).toBeGreaterThanOrEqual(SIZE.h * (1 - v.zoom));
    }
  });

  it('FR-RSP-001: a drag of a zoomed screen pans it within the bounds, a swipe no longer moves, and a double tap fits it', () => {
    const m = make();
    pinch(m, 40, 80);
    m.g.up(1);
    m.g.up(2);
    expect(m.g.view.zoom).toBeCloseTo(2, 5);
    // a swipe left pans (bounded at the far edge) and does not step
    m.at(0);
    m.g.down(1, 300, 150);
    m.g.move(1, 100, 150);
    m.g.move(1, -500, 150);
    m.at(100);
    expect(m.g.up(1)).toBeUndefined();
    expect(m.g.view.x).toBe(SIZE.w * (1 - m.g.view.zoom));
    // a double tap fits
    m.at(1000);
    m.g.down(1, 200, 150);
    m.at(1050);
    expect(m.g.up(1)).toBeUndefined();
    m.at(1150);
    m.g.down(1, 202, 151);
    m.at(1200);
    expect(m.g.up(1)).toEqual({ kind: 'view', view: FIT });
    expect(m.g.view).toEqual(FIT);
  });

  it('FR-RSP-001: a double tap at fit does nothing of its own, and reset puts the screen back to fit', () => {
    const m = make();
    for (const t of [0, 100]) {
      m.at(t);
      m.g.down(1, 200, 150);
      m.at(t + 40);
      expect(m.g.up(1)).toBeUndefined();
    }
    pinch(m, 40, 80);
    expect(m.g.reset()).toEqual(FIT);
    expect(boundedView({ zoom: 9, x: 50, y: -9999 }, SIZE)).toEqual({ zoom: MAX_ZOOM, x: 0, y: SIZE.h * (1 - MAX_ZOOM) });
  });

  it('FR-RSP-001: lifting the last finger of a pinch at fit is no swipe, and the next touch is judged afresh', () => {
    const m = make();
    m.at(0);
    m.g.down(1, 100, 150);
    m.g.down(2, 400, 150);
    m.g.move(2, 150, 150);
    m.g.move(1, 40, 150);
    expect(m.g.view.zoom).toBe(1);
    m.at(200);
    m.g.up(2);
    expect(m.g.up(1)).toBeUndefined();
    expect(stroke(m, [300, 150], [100, 150], 200)).toEqual({ kind: 'next' });
  });
});
