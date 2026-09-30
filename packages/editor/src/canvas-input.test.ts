import { describe, expect, it } from 'vitest';
import { type Camera, fitBox } from './camera.js';
import { type KeyInput, shortcutCamera, WHEEL_LINE_PX, WHEEL_ZOOM_PX, type WheelInput, wheelCamera, ZOOM_STEP } from './canvas-input.js';

const cam: Camera = { x: 10, y: 20, z: 2 };
const viewport = { w: 800, h: 600 };
const area = { x: 0, y: 0, w: 1600, h: 900 };
const fit = { screen: area, selection: { x: 100, y: 200, w: 300, h: 100 } };
const wheel = (w: Partial<WheelInput>): WheelInput => ({ dx: 0, dy: 0, mode: 0, zoom: false, shift: false, at: { x: 0, y: 0 }, ...w });
const key = (k: Partial<KeyInput>): KeyInput => ({ key: '', code: '', mod: false, shift: false, alt: false, ...k });

describe('canvas wheel and shortcuts (FR-EDT-002)', () => {
  it('FR-EDT-002: a wheel pans the page against the scroll, in px, lines or pages', () => {
    expect([WHEEL_LINE_PX, WHEEL_ZOOM_PX, ZOOM_STEP]).toEqual([16, 100, 2]);
    expect(wheelCamera(cam, wheel({ dx: 40, dy: 100 }), viewport)).toEqual({ x: 30, y: 70, z: 2 });
    expect(wheelCamera(cam, wheel({ dx: 2, dy: 3, mode: 1 }), viewport)).toEqual({ x: 26, y: 44, z: 2 });
    expect(wheelCamera(cam, wheel({ dy: 1, mode: 2 }), viewport)).toEqual({ x: 10, y: 320, z: 2 });
  });

  it('FR-EDT-002: shift turns a vertical wheel sideways; a sideways wheel stays as it is', () => {
    expect(wheelCamera(cam, wheel({ dy: 100, shift: true }), viewport)).toEqual({ x: 60, y: 20, z: 2 });
    expect(wheelCamera(cam, wheel({ dx: 40, dy: 100, shift: true }), viewport)).toEqual({ x: 30, y: 70, z: 2 });
  });

  it('FR-EDT-002: ctrl + wheel zooms about the pointer, halving or doubling per 100 px', () => {
    const at = { x: 200, y: 100 };
    const zin = wheelCamera(cam, wheel({ dy: -100, zoom: true, at }), viewport);
    expect(zin.z).toBe(4);
    // the page point under the pointer stays: (200 / 2 + 10, 100 / 2 + 20) = (110, 70)
    expect([at.x / zin.z + zin.x, at.y / zin.z + zin.y]).toEqual([110, 70]);
    expect(wheelCamera(cam, wheel({ dy: 100, zoom: true, at }), viewport).z).toBe(1);
    expect(wheelCamera(cam, wheel({ dy: 3, mode: 1, zoom: true, at }), viewport).z).toBeCloseTo(2 * 2 ** -0.48, 10);
    expect(wheelCamera(cam, wheel({ dy: -1e6, zoom: true }), viewport).z).toBe(32);
  });

  it('FR-EDT-002: ctrl/meta + = / + / - zoom about the centre; 0 goes to 100 %', () => {
    const centre = (c: Camera | undefined) => c && [400 / c.z + c.x, 300 / c.z + c.y];
    for (const k of ['=', '+']) {
      const zin = shortcutCamera(cam, key({ key: k, mod: true }), viewport, fit);
      expect(zin?.z).toBe(4);
      expect(centre(zin)).toEqual(centre(cam));
    }
    expect(shortcutCamera(cam, key({ key: '-', mod: true }), viewport, fit)?.z).toBe(1);
    const one = shortcutCamera(cam, key({ key: '0', code: 'Digit0', mod: true }), viewport, fit);
    expect(one?.z).toBe(1);
    expect(centre(one)).toEqual(centre(cam));
    expect(shortcutCamera(cam, key({ key: ')', code: 'Digit0', shift: true }), viewport, fit)?.z).toBe(1);
  });

  it('FR-EDT-002: shift + 1 fits the screen, shift + 2 the selection; other keys and alt combinations are not camera shortcuts', () => {
    expect(shortcutCamera(cam, key({ key: '!', code: 'Digit1', shift: true }), viewport, fit)).toEqual(fitBox(area, viewport));
    expect(shortcutCamera(cam, key({ key: '@', code: 'Digit2', shift: true }), viewport, fit)).toEqual(fitBox(fit.selection, viewport));
    // nothing to fit: no shortcut, the key is left to the tools
    expect(shortcutCamera(cam, key({ key: '@', code: 'Digit2', shift: true }), viewport, { screen: area })).toBeUndefined();
    expect(shortcutCamera(cam, key({ key: '!', code: 'Digit1', shift: true }), viewport, {})).toBeUndefined();
    for (const k of [
      key({ key: '=' }),
      key({ key: 'a', code: 'KeyA', mod: true }),
      key({ key: '1', code: 'Digit1', mod: true }),
      key({ key: '2', code: 'Digit2', mod: true }),
      key({ key: '#', code: 'Digit3', shift: true }),
      key({ key: '=', mod: true, alt: true }),
      key({ key: '!', code: 'Digit1', shift: true, alt: true }),
      key({ key: '1', code: 'Digit1' }),
    ])
      expect(shortcutCamera(cam, k, viewport, fit)).toBeUndefined();
  });
});
