import { CORE_PATH_ID, createCore } from '@fluxion/core';
import type { DocumentFile, PathData, RecordId, ShapeElement, Style } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistries } from './builtins.js';
import { ScreenView } from './screen-view.js';
import { TEST_RECT } from './test-shapes.js';

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

/** A square ring in a 10 × 10 box: both squares wind alike, so nonzero fills the hole and evenodd leaves it open. */
const ring = (fillRule?: 'nonzero' | 'evenodd'): PathData => ({
  d: 'M 0 0 L 10 0 L 10 10 L 0 10 Z M 3 3 L 7 3 L 7 7 L 3 7 Z',
  w: 10,
  h: 10,
  ...(fillRule === undefined ? {} : { fillRule }),
});
const solid: Style = { fill: '#0000ff', stroke: { width: 0 } };

/** A 100 × 100 shape of `defId` owning `path`, drawn by a host's registries (core's own shapes and the basic rectangle); its svg. */
async function show(defId: `${string}:${string}`, path: PathData, style: Style = solid) {
  const b = documentBuilder({ seed: 5341 });
  const screenId = b.screen({ size: { w: 400, h: 400 } });
  const id = b.rect(screenId, { x: 100, y: 100, w: 100, h: 100, defId, style });
  const file = b.build();
  const records = { ...file.records, [id]: { ...(file.records[id] as ShapeElement), path } };
  const core = createCore({ ...file, records } as DocumentFile);
  core.registries.shapeDefs.register(TEST_RECT.id, TEST_RECT, 'test');
  const registries = builtinRegistries(core.registries.shapeDefs);
  await act(async () =>
    root.render(<ScreenView registries={registries} store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 400 } }} />),
  );
  return host.querySelector(`.fx-el[data-el-id="${id as RecordId}"] > svg`) as SVGSVGElement;
}

/** The alpha at (x, y) of `svg` rasterized at its own 100 × 100 size. */
async function alpha(svg: SVGSVGElement): Promise<(x: number, y: number) => number> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', '100');
  copy.setAttribute('height', '100');
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [100, 100];
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0);
  return (x, y) => g.getImageData(x, y, 1, 1).data[3] as number;
}

describe('the path shape (ADR-0053, M19.41)', () => {
  it('FR-SHP-010: draws its own path scaled from w × h to its box, every subpath, under evenodd a hole', async () => {
    const svg = await show(CORE_PATH_ID, ring('evenodd'));
    expect(svg.querySelector('.fx-outline')?.getAttribute('d')).toContain('M30 30');
    const at = await alpha(svg);
    // the ring (scaled 10×) is filled, its hole is not
    expect([at(10, 10), at(90, 50), at(50, 50), at(35, 65)]).toEqual([255, 255, 0, 0]);
  });

  it('FR-SHP-011: fills nonzero by default, so the same ring has no hole', async () => {
    const at = await alpha(await show(CORE_PATH_ID, ring()));
    expect([at(10, 10), at(50, 50)]).toEqual([255, 255]);
  });

  it('FR-SHP-010: an inside stroke is clipped by the same rule: it is drawn inside the ring, not inside its hole', async () => {
    const at = await alpha(await show(CORE_PATH_ID, ring('evenodd'), { fill: 'transparent', stroke: { color: '#ff0000', width: 4, align: 'inside' } }));
    // just outside the hole's edge (x = 30) lies inside the ring; just inside it lies in the hole
    expect([at(28, 50), at(32, 50), at(2, 50)]).toEqual([255, 0, 255]);
  });

  it('FR-SHP-010: a path on another definition is ignored: the rectangle is drawn whole (ADR-0054)', async () => {
    const at = await alpha(await show(TEST_RECT.id as `${string}:${string}`, ring('evenodd')));
    expect([at(10, 10), at(50, 50)]).toEqual([255, 255]);
  });
});
