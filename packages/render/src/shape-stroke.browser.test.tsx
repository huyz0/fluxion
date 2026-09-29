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
  const b = documentBuilder({ seed: 5280 });
  const screenId = b.screen({ size: { w: 400, h: 400 } });
  const id = b.rect(screenId, { x: 100, y: 100, w: 100, h: 100, style });
  const { store } = createCore(b.build());
  await act(async () =>
    root.render(<ScreenView registries={registries} store={store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 400 } }} />),
  );
  return host.querySelector(`.fx-el[data-el-id="${id as RecordId}"] > svg`) as SVGSVGElement;
}

/** The view rasterized with a 20 px margin around its box (the box's corner at 20, 20), read back per pixel. */
async function pixels(svg: SVGSVGElement): Promise<(x: number, y: number) => number> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('viewBox', '-20 -20 140 140');
  copy.setAttribute('width', '140');
  copy.setAttribute('height', '140');
  // the screen's CSS variables do not travel with the copy: styles here are literal
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [140, 140];
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0);
  // the alpha of the pixel at (x, y) in the box's own coordinates
  return (x, y) => g.getImageData(x + 20, y + 20, 1, 1).data[3] as number;
}

const stroke = (align?: 'center' | 'inside' | 'outside'): Style => ({
  fill: 'transparent',
  stroke: { color: '#ff0000', width: 10, ...(align ? { align } : {}) },
});

describe('shape strokes (FR-SHP-004, ADR-0019)', () => {
  it('FR-SHP-004: stroke align inside and outside draw inside and outside the outline', async () => {
    // centred: 5 px either side of the edge at x = 0
    const centre = await pixels(await show(stroke()));
    expect([centre(-3, 50), centre(3, 50), centre(-8, 50), centre(8, 50)]).toEqual([255, 255, 0, 0]);
    // inside: the full 10 px within the box, nothing outside it
    const inside = await pixels(await show(stroke('inside')));
    expect([inside(-3, 50), inside(3, 50), inside(8, 50), inside(13, 50)]).toEqual([0, 255, 255, 0]);
    // outside: the full 10 px beyond the box, nothing within it
    const outside = await pixels(await show(stroke('outside')));
    expect([outside(3, 50), outside(-3, 50), outside(-8, 50), outside(-13, 50)]).toEqual([0, 255, 255, 0]);
    // the fill stays the outline's in every case
    const filled = await show({ ...stroke('inside'), fill: '#0000ff' });
    expect((filled.querySelector('.fx-outline') as SVGPathElement).style.fill).toBe('rgb(0, 0, 255)');
  });

  it('FR-SHP-004: a corner radius rounds the drawn outline', async () => {
    const sharp = await pixels(await show({ fill: '#0000ff', stroke: { width: 0 } }));
    expect(sharp(1, 1)).toBe(255);
    const round = await show({ fill: '#0000ff', stroke: { width: 0 }, radius: 20 });
    expect(round.querySelector('.fx-outline')?.getAttribute('d')).toMatch(/C/);
    const rounded = await pixels(round);
    // the corner is cut away; the middle of an edge is not
    expect(rounded(1, 1)).toBe(0);
    expect(rounded(50, 1)).toBe(255);
    expect(rounded(20, 20)).toBe(255);
  });
});
