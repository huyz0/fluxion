import { describe, expect, it } from 'vitest';
import { CONTENT_CSS } from './content-css.js';
import { fitTransform, screenArea } from './fit.js';
import { modePolicy } from './mode-policy.js';

describe('fit view (FR-SCR-001) and mode policy (04 §2.6)', () => {
  it('FR-SCR-001: a screen fits its box at the largest uniform scale, centred', () => {
    expect(fitTransform({ w: 1920, h: 1080 }, { w: 960, h: 540 })).toEqual({ scale: 0.5, x: 0, y: 0 });
    // letterboxed: a 4:3 screen in a 16:9 box keeps its ratio and is centred horizontally
    expect(fitTransform({ w: 1024, h: 768 }, { w: 1600, h: 900 })).toEqual({ scale: 900 / 768, x: (1600 - 1024 * (900 / 768)) / 2, y: 0 });
    // a degenerate area does not divide by zero
    expect(fitTransform({ w: 0, h: 10 }, { w: 100, h: 100 })).toEqual({ scale: 1, x: 50, y: 45 });
  });

  it('FR-SCR-001: the area of a screen is its size (default 1920x1080) or an infinite screen viewport', () => {
    expect(screenArea({})).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(screenArea({ size: { w: 800, h: 600 } })).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(screenArea({ kind: 'infinite', viewport: { x: -100, y: 50, w: 400, h: 300 } })).toEqual({ x: -100, y: 50, w: 400, h: 300 });
  });

  it('only edit mounts the overlay; only present is interactive; export and thumbnails do not measure', () => {
    expect(modePolicy('edit')).toEqual({ editOverlay: true, interactive: false, measure: true });
    expect(modePolicy('present')).toEqual({ editOverlay: false, interactive: true, measure: true });
    expect(modePolicy('export')).toEqual({ editOverlay: false, interactive: false, measure: false });
    expect(modePolicy('thumbnail')).toEqual({ editOverlay: false, interactive: false, measure: false });
  });

  it('content CSS is fx-prefixed and in @layer fx.content (ADR-0010, ADR-0015)', () => {
    expect(CONTENT_CSS.startsWith('@layer fx.content {')).toBe(true);
    const selectors = [...CONTENT_CSS.matchAll(/^\.([\w-]+)/gm)].map((m) => m[1]);
    expect(selectors.length).toBeGreaterThan(3);
    expect(selectors.every((s) => s?.startsWith('fx-'))).toBe(true);
  });
});
