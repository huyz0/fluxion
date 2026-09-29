import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Camera, clampZoom, FIT_PADDING, fitBox, pageToScreen, panBy, screenToPage, ZOOM_LIMITS, zoomAt, zoomBy, zoomTo100 } from './camera.js';

const coord = fc.double({ min: -1e5, max: 1e5, noNaN: true });
const zoom = fc.double({ min: ZOOM_LIMITS.min, max: ZOOM_LIMITS.max, noNaN: true });
const camera = fc.record({ x: coord, y: coord, z: zoom });
const point = fc.record({ x: fc.double({ min: 0, max: 4000, noNaN: true }), y: fc.double({ min: 0, max: 4000, noNaN: true }) });

const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe('camera math (FR-EDT-002)', () => {
  it('FR-EDT-002: zoom stays within 5 % and 3200 % and keeps the point under the cursor still', () => {
    expect(ZOOM_LIMITS).toEqual({ min: 0.05, max: 32 });
    fc.assert(
      fc.property(camera, point, fc.double({ min: 1e-6, max: 1e6, noNaN: true }), (cam, at, factor) => {
        const next = zoomBy(cam, at, factor);
        expect(next.z).toBeGreaterThanOrEqual(0.05);
        expect(next.z).toBeLessThanOrEqual(32);
        close(screenToPage(next, at), screenToPage(cam, at), 3);
      }),
    );
    const cam: Camera = { x: 10, y: 20, z: 1 };
    expect(zoomAt(cam, { x: 0, y: 0 }, 1000).z).toBe(32);
    expect(zoomAt(cam, { x: 0, y: 0 }, 0.001).z).toBe(0.05);
    expect(zoomAt(cam, { x: 100, y: 50 }, 2)).toEqual({ x: 60, y: 45, z: 2 });
    expect(zoomBy({ x: 0, y: 0, z: 2 }, { x: 0, y: 0 }, 3)).toEqual({ x: 0, y: 0, z: 6 });
  });

  it('FR-EDT-002: page and canvas points convert both ways', () => {
    const cam: Camera = { x: 100, y: -50, z: 2 };
    expect(pageToScreen(cam, { x: 110, y: -40 })).toEqual({ x: 20, y: 20 });
    expect(screenToPage(cam, { x: 20, y: 20 })).toEqual({ x: 110, y: -40 });
    fc.assert(
      fc.property(camera, point, (c, p) => {
        close(pageToScreen(c, screenToPage(c, p)), p, 4);
      }),
    );
  });

  it('FR-EDT-002: a zoom outside the limits clamps to the nearer limit; NaN is 100 %', () => {
    expect([clampZoom(0), clampZoom(0.05), clampZoom(0.5), clampZoom(32), clampZoom(33)]).toEqual([0.05, 0.05, 0.5, 32, 32]);
    expect([clampZoom(Number.NaN), clampZoom(Number.POSITIVE_INFINITY), clampZoom(Number.NEGATIVE_INFINITY)]).toEqual([1, 32, 0.05]);
    // a zoom-in that overflows stops at 3200 %, not back at 100 %
    expect(zoomBy({ x: 0, y: 0, z: 2 }, { x: 0, y: 0 }, Number.MAX_VALUE).z).toBe(32);
  });

  it('FR-EDT-002: panning moves the page with the pointer, at any zoom', () => {
    expect(panBy({ x: 10, y: 10, z: 2 }, { x: 40, y: -20 })).toEqual({ x: -10, y: 20, z: 2 });
    fc.assert(
      fc.property(camera, point, point, (c, p, d) => {
        const page = screenToPage(c, p);
        close(pageToScreen(panBy(c, d), page), { x: p.x + d.x, y: p.y + d.y }, 3);
      }),
    );
  });

  it('FR-EDT-002: fit shows the box whole and centred with padding, clamped', () => {
    expect(FIT_PADDING).toBe(32);
    // 1920x1080 into 1000x600 less 32 px each side: the width limits the zoom to 0.5
    const fitted = fitBox({ x: 0, y: 0, w: 1872, h: 500 }, { w: 1000, h: 600 });
    expect(fitted.z).toBe(0.5);
    close(pageToScreen(fitted, { x: 936, y: 250 }), { x: 500, y: 300 });
    const tall = fitBox({ x: 10, y: 10, w: 100, h: 1000 }, { w: 800, h: 600 }, 0);
    expect(tall.z).toBe(0.6);
    close(pageToScreen(tall, { x: 60, y: 510 }), { x: 400, y: 300 });
    // the height limits, less its padding: (264 - 64) / 100
    expect(fitBox({ x: 0, y: 0, w: 100, h: 100 }, { w: 1000, h: 264 }).z).toBe(2);
    expect(fitBox({ x: 0, y: 0, w: 1, h: 1 }, { w: 800, h: 600 }).z).toBe(32);
    expect(fitBox({ x: 0, y: 0, w: 1e6, h: 1e6 }, { w: 800, h: 600 }).z).toBe(0.05);
    // a canvas smaller than its padding still fits at a positive zoom
    expect(fitBox({ x: 0, y: 0, w: 100, h: 100 }, { w: 40, h: 40 }).z).toBe(0.05);
  });

  it('FR-EDT-002: a line fits along its length; a point is centred at 100 %', () => {
    const line = fitBox({ x: 0, y: 5, w: 200, h: 0 }, { w: 400, h: 300 }, 0);
    expect(line.z).toBe(2);
    close(pageToScreen(line, { x: 100, y: 5 }), { x: 200, y: 150 });
    expect(fitBox({ x: 5, y: 0, w: 0, h: 150 }, { w: 400, h: 300 }, 0).z).toBe(2);
    const dot = fitBox({ x: 7, y: 9, w: 0, h: 0 }, { w: 400, h: 300 });
    expect(dot).toEqual({ x: 7 - 200, y: 9 - 150, z: 1 });
  });

  it('FR-EDT-002: 100 % zooms about the canvas centre', () => {
    const cam: Camera = { x: 0, y: 0, z: 4 };
    const one = zoomTo100(cam, { w: 800, h: 600 });
    expect(one.z).toBe(1);
    close(screenToPage(one, { x: 400, y: 300 }), screenToPage(cam, { x: 400, y: 300 }));
  });
});
