import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, defaultLayout, NARROW_PX } from './layout.js';
import { HANDLE_PX, handleAt, selectionFrame } from './overlay-geometry.js';
import { moved, pinchCamera, TOUCH } from './touch.js';

describe('touch recognizers (FR-EDT-019)', () => {
  it('FR-EDT-019: the thresholds sit in one place', () => {
    expect(TOUCH).toEqual({ longPressMs: 500, slopPx: 8, handlePx: 22 });
    expect([moved({ x: 0, y: 0 }, { x: 8, y: 0 }), moved({ x: 0, y: 0 }, { x: 6, y: 6 })]).toEqual([false, true]);
  });

  it('FR-EDT-019: two fingers zoom by their spread about their midpoint, and pan with it', () => {
    const start = { x: 100, y: 50, z: 2 };
    // spread twice as far about the same midpoint (100, 100): zoom doubles, the page point there stays
    const zoomed = pinchCamera(
      start,
      [
        { x: 50, y: 100 },
        { x: 150, y: 100 },
      ],
      [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
    );
    expect(zoomed).toEqual({ x: 125, y: 75, z: 4 });
    // both fingers 40 px right and 10 down: the page follows them, the zoom stays
    const panned = pinchCamera(
      start,
      [
        { x: 50, y: 100 },
        { x: 150, y: 100 },
      ],
      [
        { x: 90, y: 110 },
        { x: 190, y: 110 },
      ],
    );
    expect(panned).toEqual({ x: 80, y: 45, z: 2 });
    // zoom is clamped; fingers pressed on one spot keep it
    const far = pinchCamera(
      start,
      [
        { x: 99, y: 0 },
        { x: 101, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
    );
    expect(far.z).toBe(32);
    const same = pinchCamera(
      start,
      [
        { x: 10, y: 10 },
        { x: 10, y: 10 },
      ],
      [
        { x: 30, y: 10 },
        { x: 50, y: 10 },
      ],
    );
    // (their midpoint moved 30 px right: the page follows it)
    expect(same).toEqual({ x: 85, y: 50, z: 2 });
  });

  it('FR-EDT-019: a first visit on a phone starts with the side panels collapsed', () => {
    expect(NARROW_PX).toBe(768);
    expect(defaultLayout(768)).toBe(DEFAULT_LAYOUT);
    const narrow = defaultLayout(767);
    expect([narrow.panels.left.collapsed, narrow.panels.right.collapsed, narrow.panels.bottom]).toEqual([true, true, DEFAULT_LAYOUT.panels.bottom]);
    expect([narrow.panels.left.size, narrow.panels.right.size, narrow.focus]).toEqual([240, 280, false]);
  });

  it('FR-EDT-019: a finger reaches a handle further than a mouse', () => {
    const f = selectionFrame([{ x: 100, y: 100, w: 200, h: 100 }], { x: 0, y: 0, z: 1 });
    // 15 px left of the top-left corner: out of a mouse's reach, within a finger's
    expect([handleAt(f, { x: 85, y: 100 }), handleAt(f, { x: 85, y: 100 }, TOUCH.handlePx), HANDLE_PX]).toEqual([undefined, 'nw', 8]);
    // inside the frame, only where the handle is drawn, for a finger too: a small element's middle moves it
    expect([handleAt(f, { x: 104, y: 100 }, TOUCH.handlePx), handleAt(f, { x: 106, y: 100 }, TOUCH.handlePx)]).toEqual(['nw', undefined]);
    const small = selectionFrame([{ x: 0, y: 0, w: 28, h: 17 }], { x: 0, y: 0, z: 1 });
    expect(handleAt(small, { x: 14, y: 8.5 }, TOUCH.handlePx)).toBeUndefined();
    // the nearest handle in reach wins: 5 px above the top edge's middle is n, not rotate (24 px up);
    // 10 px right of a small frame's east handle is e, not ne
    expect(handleAt(f, { x: 200, y: 95 }, TOUCH.handlePx)).toBe('n');
    expect(handleAt(f, { x: 200, y: 85 }, TOUCH.handlePx)).toBe('rotate');
    expect(handleAt(small, { x: 38, y: 8.5 }, TOUCH.handlePx)).toBe('e');
  });
});
