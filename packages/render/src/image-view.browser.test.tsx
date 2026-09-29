import { createCore, type ShapeDef } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistries } from './builtins.js';
import { ScreenView } from './screen-view.js';
import { testShapeDefs } from './test-shapes.js';

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

const ELLIPSE: ShapeDef = {
  id: 'test:ellipse',
  outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 1 1 {w} {h/2} A {w/2} {h/2} 0 1 1 0 {h/2} Z' },
  defaultSize: { w: 10, h: 10 },
};

/** A PNG of `w` x `h`, its left half `left` and its right half `right`, as a data URL. */
function halves(w: number, h: number, left: string, right: string): string {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [w, h];
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = left;
  g.fillRect(0, 0, w / 2, h);
  g.fillStyle = right;
  g.fillRect(w / 2, 0, w / 2, h);
  return canvas.toDataURL('image/png');
}

/** A solid PNG of `w` x `h` in `color`, as a data URL (the host's in-memory asset). */
function solid(w: number, h: number, color: string): string {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [w, h];
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  return canvas.toDataURL('image/png');
}

/** A 200 x 100 image element over the asset `pic` (40 x 20), with `fields`, on a screen at scale 1. */
async function show(fields: object, url: string | undefined, asset: object = {}) {
  const defs = testShapeDefs();
  defs.register(ELLIPSE.id, ELLIPSE, 'test');
  const b = documentBuilder({ seed: 5150 });
  const screenId = b.screen({ size: { w: 400, h: 400 } });
  const id = b.rect(screenId, { x: 0, y: 0, w: 200, h: 100 });
  const file = b.build();
  const { defId: _, ...base } = file.records[id] as { defId: string };
  const image = { ...base, kind: 'image', assetId: 'pic', ...fields };
  const pic = { id: 'pic', type: 'asset', hash: 'd'.repeat(64), mime: 'image/png', size: 100, name: 'pic.png', w: 40, h: 20, ...asset };
  const { store } = createCore({ ...file, records: { ...file.records, [id]: image, pic } } as unknown as DocumentFile);
  await act(async () =>
    root.render(
      <ScreenView
        registries={builtinRegistries(defs)}
        store={store}
        screenId={screenId}
        mode="present"
        view={{ kind: 'fit', box: { w: 400, h: 400 } }}
        assets={(asset) => (asset === 'pic' ? url : undefined)}
      />,
    ),
  );
  return host.querySelector(`.fx-el[data-el-id="${id as RecordId}"] > svg`) as SVGSVGElement;
}

/** The view's SVG rasterized at its size: what the browser draws, read back pixel by pixel. */
async function pixels(svg: SVGSVGElement): Promise<(x: number, y: number) => readonly number[]> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', '200');
  copy.setAttribute('height', '100');
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [200, 100];
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0);
  return (x, y) => [...g.getImageData(x, y, 1, 1).data];
}

describe('image view (FR-SHP-012)', () => {
  it('FR-SHP-012: mask with ellipse clips image', async () => {
    const red = solid(40, 20, '#ff0000');
    const masked = await pixels(await show({ fit: 'fill', maskDefId: 'test:ellipse' }, red));
    // inside the ellipse the image shows; in the box's corners, outside it, nothing does
    expect(masked(100, 50)).toEqual([255, 0, 0, 255]);
    expect(masked(40, 50)).toEqual([255, 0, 0, 255]);
    for (const [x, y] of [
      [3, 3],
      [196, 3],
      [3, 96],
      [196, 96],
    ])
      expect(masked(x as number, y as number)[3], `${x},${y}`).toBe(0);
    // without a mask the whole box shows the image
    const plain = await pixels(await show({ fit: 'fill' }, red));
    expect(plain(3, 3)).toEqual([255, 0, 0, 255]);
    // a mask naming no definition leaves the image unclipped
    const unknown = await pixels(await show({ fit: 'fill', maskDefId: 'acme:none' }, red));
    expect(unknown(3, 3)).toEqual([255, 0, 0, 255]);
  });

  it('FR-SHP-012: crop takes a part of the image; fit places it contain, cover or fill', async () => {
    const url = solid(40, 20, '#00ff00');
    const drawn = async (fields: object) => (await show(fields, url)).querySelector('.fx-image') as SVGElement;
    // uncropped: one image fitted to the box, its own aspect kept by the browser
    expect((await drawn({})).tagName).toBe('image');
    expect((await drawn({})).getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect((await drawn({ fit: 'cover' })).getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    expect((await drawn({ fit: 'fill' })).getAttribute('preserveAspectRatio')).toBe('none');
    // cropped: the crop, a fraction of the image in its pixels, is the viewBox
    const cropped = await drawn({ crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } });
    expect([cropped.tagName, cropped.getAttribute('viewBox')]).toEqual(['svg', '10 10 20 10']);
    // contain letterboxes the left half of a green-blue image; the cut-away blue shows in neither band (M5.15 review F1)
    const two = halves(40, 20, '#00ff00', '#0000ff');
    const contain = await pixels(await show({ crop: { x: 0, y: 0, w: 0.5, h: 1 } }, two));
    expect(contain(100, 50)).toEqual([0, 255, 0, 255]);
    expect(contain(10, 50)[3]).toBe(0);
    expect(contain(190, 50)[3]).toBe(0);
    // an asset without a recorded size keeps its aspect: a 2:1 image fills a 2:1 box (review F2)
    const sizeless = await pixels(await show({}, two, { w: undefined, h: undefined }));
    expect(sizeless(5, 5)).toEqual([0, 255, 0, 255]);
    expect(sizeless(195, 95)).toEqual([0, 0, 255, 255]);
    // ... and a crop it cannot place in pixels is not guessed: the whole image, undistorted
    const unplaced = await show({ crop: { x: 0, y: 0, w: 0.5, h: 1 } }, two, { w: undefined, h: undefined });
    expect(unplaced.querySelector('.fx-image')?.tagName).toBe('image');
    // an asset record the host has no URL for draws nothing (review F3)
    expect((await show({}, undefined)).querySelector('.fx-image')).toBeNull();
    expect((await show({ assetId: 'other' }, url)).querySelector('.fx-image')).toBeNull();
  });
});
