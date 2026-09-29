import { createCore } from '@fluxion/core';
import type { RecordId, Style } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScreenView } from './screen-view.js';
import { testRegistries } from './test-registries.js';

const registries = testRegistries();
let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A 100 x 100 rect with `style` on a screen at scale 1; its view's svg. */
async function show(style: Style) {
  const b = documentBuilder({ seed: 5340 });
  const screenId = b.screen({ size: { w: 400, h: 400 } });
  const id = b.rect(screenId, { x: 100, y: 100, w: 100, h: 100, style });
  const { store } = createCore(b.build());
  await act(async () =>
    root.render(<ScreenView registries={registries} store={store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 400 } }} />),
  );
  return host.querySelector(`.fx-el[data-el-id="${id as RecordId}"] > svg`) as SVGSVGElement;
}

/** The view rasterized with a 30 px margin, read back per pixel in the box's own coordinates (RGBA). */
async function pixels(svg: SVGSVGElement): Promise<(x: number, y: number) => readonly number[]> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('viewBox', '-30 -30 160 160');
  copy.setAttribute('width', '160');
  copy.setAttribute('height', '160');
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [160, 160];
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0);
  return (x, y) => [...g.getImageData(x + 30, y + 30, 1, 1).data];
}

const solid: Style = { fill: '#0000ff', stroke: { width: 0 } };

describe('shape style in the browser (FR-SHP-004, M5.34)', () => {
  it('FR-SHP-004: dash, cap, join, opacity, shadow, blur and glow render from the resolved style', async () => {
    // dash, cap, join and opacity reach the drawn outline
    const lined = await show({ fill: 'transparent', stroke: { color: '#ff0000', width: 4, dash: [4, 2], cap: 'round', join: 'bevel' }, opacity: 0.5 });
    const outline = getComputedStyle(lined.querySelector('.fx-outline') as SVGPathElement);
    expect([outline.strokeDasharray, outline.strokeLinecap, outline.strokeLinejoin]).toEqual(['4px, 2px', 'round', 'bevel']);
    expect(getComputedStyle(lined).opacity).toBe('0.5');
    // no effect: no filter, and nothing drawn beyond the box
    const plain = await show(solid);
    expect(plain.querySelector('filter')).toBeNull();
    expect((await pixels(plain))(110, 110)[3]).toBe(0);
    // a drop shadow, 15 px down and right: beyond the box's corner, black
    const shadowed = await show({ ...solid, shadow: [{ x: 15, y: 15, blur: 0, color: '#000000' }] });
    expect(shadowed.querySelector('feOffset')?.getAttribute('dx')).toBe('15');
    const shade = await pixels(shadowed);
    expect(shade(110, 110)).toEqual([0, 0, 0, 255]);
    expect(shade(50, 50)).toEqual([0, 0, 255, 255]);
    // a glow lights just outside the edge in its colour
    const glowing = await pixels(await show({ ...solid, effects: [{ type: 'glow', radius: 12, color: '#00ff00' }] }));
    const halo = glowing(-3, 50);
    expect(halo[1]).toBeGreaterThan(0);
    expect(halo[3]).toBeGreaterThan(0);
    expect(glowing(50, 50)).toEqual([0, 0, 255, 255]);
    // a blur softens the edge: part-covered pixels on both sides of it
    const blurred = await pixels(await show({ ...solid, effects: [{ type: 'blur', radius: 12 }] }));
    const [outside, inside] = [blurred(-2, 50)[3] as number, blurred(2, 50)[3] as number];
    expect(outside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(255);
    expect(blurred(50, 50)[3]).toBe(255);
    // a negative spread shrinks the shadow (review F1): 10 px down, 5 px in: down to y 105, and none beside the box
    const tucked = await pixels(await show({ ...solid, shadow: [{ x: 0, y: 10, blur: 0, spread: -5, color: '#000000' }] }));
    expect(tucked(50, 102)).toEqual([0, 0, 0, 255]);
    expect(tucked(2, 102)[3]).toBe(0);
    expect(tucked(97, 102)[3]).toBe(0);
    // effects apply in order (review F2): a glow of a blurred drawing differs from a blur of a glowing one
    const glowThenBlur = await pixels(
      await show({
        ...solid,
        effects: [
          { type: 'glow', radius: 16, color: '#00ff00' },
          { type: 'blur', radius: 4 },
        ],
      }),
    );
    const blurThenGlow = await pixels(
      await show({
        ...solid,
        effects: [
          { type: 'blur', radius: 4 },
          { type: 'glow', radius: 16, color: '#00ff00' },
        ],
      }),
    );
    expect(glowThenBlur(-8, 50)).not.toEqual(blurThenGlow(-8, 50));
    // an inset shadow darkens the inside along the edge and leaves the outside untouched
    const inset = await pixels(await show({ ...solid, shadow: [{ x: 0, y: 0, blur: 0, spread: 6, color: '#ff0000', inset: true }] }));
    expect(inset(2, 50)).toEqual([255, 0, 0, 255]);
    expect(inset(50, 50)).toEqual([0, 0, 255, 255]);
    expect(inset(-3, 50)[3]).toBe(0);
  });
});
