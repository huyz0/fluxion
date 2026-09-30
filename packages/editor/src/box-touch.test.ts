import { type Mat2d, type Path, pathFromCommands } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { boxTouches, PAGE_FRAME, rectOutline } from './box-touch.js';

const line = (): Path => {
  const built = pathFromCommands([
    { kind: 'M', to: { x: 0, y: 0 } },
    { kind: 'L', to: { x: 1000, y: 1000 } },
  ]);
  if (!built.ok) throw new Error('bad path');
  return built.value;
};

describe('marquee touches (FR-EDT-004)', () => {
  it('FR-EDT-004: a box touches a line it crosses or holds, not one it only shares bounds with', () => {
    expect(boxTouches(line(), false, { x: 400, y: 450, w: 200, h: 100 }, PAGE_FRAME)).toBe(true);
    expect(boxTouches(line(), false, { x: 800, y: 100, w: 100, h: 100 }, PAGE_FRAME)).toBe(false);
    // holding one end, crossing nothing
    expect(boxTouches(line(), false, { x: -10, y: -10, w: 5, h: 50 }, PAGE_FRAME)).toBe(false);
    expect(boxTouches(line(), false, { x: -10, y: -10, w: 20, h: 20 }, PAGE_FRAME)).toBe(true);
  });

  it('FR-EDT-004: a box inside a filled outline touches it; inside a hollow one it does not', () => {
    const rect = rectOutline(100, 100) as Path;
    expect(boxTouches(rect, true, { x: 40, y: 40, w: 10, h: 10 }, PAGE_FRAME)).toBe(true);
    expect(boxTouches(rect, false, { x: 40, y: 40, w: 10, h: 10 }, PAGE_FRAME)).toBe(false);
    // around it, and across its edge
    expect(boxTouches(rect, false, { x: -10, y: -10, w: 200, h: 200 }, PAGE_FRAME)).toBe(true);
    expect(boxTouches(rect, false, { x: 90, y: 40, w: 20, h: 10 }, PAGE_FRAME)).toBe(true);
    expect(boxTouches(rect, true, { x: 200, y: 200, w: 10, h: 10 }, PAGE_FRAME)).toBe(false);
  });

  it('FR-EDT-004: the box is taken into the outline`s own frame; a box of no area touches only a filled inside', () => {
    const rect = rectOutline(100, 100) as Path;
    // the outline sits at (500, 500) on the page: its frame moves pages back by 500
    const frame: Mat2d = [1, 0, 0, 1, -500, -500];
    expect(boxTouches(rect, true, { x: 540, y: 540, w: 10, h: 10 }, frame)).toBe(true);
    expect(boxTouches(rect, true, { x: 40, y: 40, w: 10, h: 10 }, frame)).toBe(false);
    expect(boxTouches(rect, true, { x: 540, y: 540, w: 0, h: 0 }, frame)).toBe(true);
    expect(boxTouches(rect, false, { x: 540, y: 540, w: 0, h: 0 }, frame)).toBe(false);
    // a size that is no number makes no outline, and a box that is none touches nothing it crosses
    expect(rectOutline(Number.NaN, 10)).toBeUndefined();
    expect(boxTouches(rect, false, { x: Number.NaN, y: 40, w: 10, h: 10 }, PAGE_FRAME)).toBe(false);
    expect(rectOutline(10, 20)?.closed).toBe(true);
  });
});
