import { createCore, parseShapeDef, type ShapeDef } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ScreenView } from './screen-view.js';
import { testRegistries } from './test-registries.js';

const fixtures = import.meta.glob('../../../fixtures/artwork/*.json', { query: '?raw', import: 'default', eager: true });
function definition(): ShapeDef {
  const parsed = parseShapeDef(JSON.parse(fixtures['../../../fixtures/artwork/paint.shape.json'] ?? 'null'));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}
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
async function show(def: ShapeDef, copies = 1) {
  const registries = testRegistries();
  registries.shapeDefs.register(def.id, def, 'test');
  const builder = documentBuilder({ seed: 1847 });
  const screenId = builder.screen({ size: { w: 400, h: 200 } });
  for (let i = 0; i < copies; i++) builder.rect(screenId, { defId: def.id, x: 10 + i * 120, y: 10, w: 100, h: 100 });
  const core = createCore(builder.build());
  await act(async () =>
    root.render(<ScreenView registries={registries} store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 200 } }} />),
  );
  return core;
}
async function raster(svg: SVGSVGElement): Promise<CanvasRenderingContext2D> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', '100');
  copy.setAttribute('height', '100');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG image failed'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('missing canvas context');
    context.drawImage(image, 0, 0);
    return context;
  } finally {
    URL.revokeObjectURL(url);
  }
}
it('FR-LIB-004: imported paint actually draws fills, holes, gradient, clip, transforms and text', async () => {
  await show(definition());
  const svg = host.querySelector<SVGSVGElement>('.fx-artwork');
  expect(svg).not.toBeNull();
  if (!svg) throw new Error('artwork missing');
  const context = await raster(svg);
  const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
  expect(pixel(5, 5)).toEqual([255, 0, 0, 255]);
  expect(pixel(20, 20)[3]).toBe(0);
  expect(pixel(70, 20)[1]).toBeGreaterThan(20);
  expect(pixel(70, 20)[2]).toBeGreaterThan(20);
  expect(pixel(51, 1)[3]).toBe(0);
  expect(pixel(15, 55)).toEqual([0, 0, 255, 255]);
  expect(pixel(5, 55)[3]).toBe(0);
  const ink = context.getImageData(50, 55, 30, 25).data;
  expect([...ink].filter((value, i) => i % 4 === 3 && value > 0).length).toBeGreaterThan(10);
  expect((svg.querySelector('text') as SVGTextElement).getBBox().width).toBeGreaterThan(0);
});
it('NFR-SEC-001: each instance scopes all local IDs and reference URLs', async () => {
  await show(definition(), 2);
  const paintings = [...host.querySelectorAll('.fx-artwork')];
  expect(paintings).toHaveLength(2);
  const ids = paintings.flatMap((painting) => [...painting.querySelectorAll('[id]')].map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toHaveLength(4);
  for (const painting of paintings) {
    const own = new Set([...painting.querySelectorAll('[id]')].map((el) => el.id));
    for (const el of painting.querySelectorAll('*'))
      for (const value of el.getAttributeNames().map((name) => el.getAttribute(name) ?? ''))
        for (const match of value.matchAll(/url\(#([^)]*)\)/g)) expect(own.has(match[1] ?? '')).toBe(true);
  }
});
it('NFR-SEC-001: a manually registered malicious definition renders a placeholder', async () => {
  const good = definition();
  const bad = { ...good, artwork: { ...good.artwork, root: { name: 'use', attributes: { href: 'https://example.invalid/leak' }, children: [] } } } as ShapeDef;
  await show(bad);
  expect(host.querySelector('.fx-placeholder')).not.toBeNull();
  expect(host.querySelector('.fx-artwork')).toBeNull();
  expect(host.querySelector('use,script,foreignObject')).toBeNull();
  expect(performance.getEntriesByType('resource').some((entry) => entry.name.includes('example.invalid'))).toBe(false);
});
it('FR-LIB-004: mapped colors follow color-only theme changes and missing tokens keep their literal', async () => {
  const good = definition();
  if (!good.artwork) throw new Error('fixture artwork missing');
  const core = await show({ ...good, artwork: { ...good.artwork, colors: { red: '{color.primary}', blue: '{color.does-not-exist}' } } });
  const hole = host.querySelector('.fx-artwork .hole');
  expect(hole).not.toBeNull();
  await act(async () => {
    core.execute('document.setTheme', { theme: { name: 'one', tokens: { color: { primary: { $type: 'color', $value: '#00ff00' } } } } });
  });
  expect(getComputedStyle(hole as Element).fill).toBe('rgb(0, 255, 0)');
  await act(async () => {
    core.execute('document.setTheme', { theme: { name: 'two', tokens: { color: { primary: { $type: 'color', $value: '#ff00ff' } } } } });
  });
  expect(getComputedStyle(hole as Element).fill).toBe('rgb(255, 0, 255)');
  expect(getComputedStyle(host.querySelector('.fx-artwork .moved') as Element).fill).toBe('rgb(0, 0, 255)');
});

it('NFR-SEC-001: normalized whitespace IDs still resolve inside their instance', async () => {
  const good = definition();
  if (!good.artwork) throw new Error('fixture artwork missing');
  const artwork = structuredClone(good.artwork);
  const pending = [artwork.root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    const { id } = node.attributes;
    if (id) Object.assign(node.attributes, { id: `  ${id}  ` });
    for (const child of node.children) if (typeof child !== 'string') pending.push(child);
  }
  await show({ ...good, artwork });
  const svg = host.querySelector<SVGSVGElement>('.fx-artwork');
  if (!svg) throw new Error('artwork missing');
  const context = await raster(svg);
  expect(context.getImageData(70, 20, 1, 1).data[3]).toBe(255);
});
