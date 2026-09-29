import { createCore, type ShapeDef } from '@fluxion/core';
import type { DocumentFile, RecordId, Style } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME, type Theme, type TokenGroup } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinViews } from './builtins.js';
import { createRenderRegistries } from './registries.js';
import { ScreenView } from './screen-view.js';
import { ShapeView } from './shape-view.js';
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

const view = { kind: 'fit', box: { w: 400, h: 400 } } as const;
/** The light theme with its primary colour replaced: the same structure, other values. */
const primary = (css: string): Theme => ({
  ...LIGHT_THEME,
  tokens: { ...LIGHT_THEME.tokens, color: { ...(LIGHT_THEME.tokens['color'] as TokenGroup), primary: { $type: 'color', $value: css } } },
});

describe('shape fills and decorations (FR-SHP-004)', () => {
  it('FR-SHP-004: a theme change restyles token-bound shapes without re-rendering views', async () => {
    const b = documentBuilder({ seed: 5130 });
    const screenId = b.screen({ size: { w: 400, h: 400 } });
    b.rect(screenId, { x: 0, y: 0, w: 200, h: 100, style: { fill: '{color.primary}' } });
    const { store } = createCore(b.build());
    let renders = 0;
    const registries = createRenderRegistries(testShapeDefs());
    registries.elementViews.register(
      'shape',
      {
        Component: (props) => {
          renders++;
          return <ShapeView {...props} />;
        },
      },
      'test',
    );
    registerBuiltinViews(registries);
    const show = (theme: Theme) =>
      act(async () => root.render(<ScreenView registries={registries} store={store} screenId={screenId} mode="present" view={view} theme={theme} />));
    await show(primary('#ff0000'));
    const outline = host.querySelector('.fx-outline') as SVGPathElement;
    expect(getComputedStyle(outline).fill).toBe('rgb(255, 0, 0)');
    const drawn = renders;
    expect(drawn).toBeGreaterThan(0);
    // the new value reaches the shape through the screen's CSS variable; the view does not run again
    await show(primary('#0000ff'));
    expect(getComputedStyle(outline).fill).toBe('rgb(0, 0, 255)');
    expect(renders).toBe(drawn);
    // a size a view may measure with, or another structure (other defaults), re-renders its views
    const blue = primary('#0000ff');
    const stroke = blue.tokens['stroke'] as TokenGroup;
    const [first] = Object.keys(stroke);
    await show({ ...blue, tokens: { ...blue.tokens, stroke: { ...stroke, [first as string]: { $type: 'dimension', $value: { value: 7, unit: 'px' } } } } });
    const resized = renders;
    expect(resized).toBeGreaterThan(drawn);
    await show({ ...primary('#0000ff'), defaults: { shape: { stroke: { width: 4 } } } });
    expect(renders).toBeGreaterThan(resized);
  });

  it('FR-SHP-004: solid, gradient, pattern, image and none fills render with decorations', async () => {
    const defs = testShapeDefs();
    const drum: ShapeDef = {
      id: 'test:drum',
      outline: { path: 'M 0 10 V {h - 10} A {w/2} 10 0 0 0 {w} {h - 10} V 10 A {w/2} 10 0 0 0 0 10 Z' },
      decorations: [{ path: 'M 0 10 A {w/2} 10 0 0 0 {w} 10' }],
      defaultSize: { w: 10, h: 10 },
    };
    defs.register(drum.id, drum, 'test');
    const registries = createRenderRegistries(defs);
    registerBuiltinViews(registries);
    const b = documentBuilder({ seed: 5131 });
    const screenId = b.screen({ size: { w: 400, h: 400 } });
    const stops = [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ];
    const fills: [string, Style['fill']][] = [
      ['solid', '#ff0000'],
      ['linear', { type: 'linear-gradient', angle: 90, stops }],
      ['radial', { type: 'radial-gradient', stops }],
      ['pattern', { type: 'image', assetId: 'dot' as RecordId, fit: 'tile' }],
      ['image', { type: 'image', assetId: 'dot' as RecordId, fit: 'contain' }],
      ['none', 'transparent'],
      ['missing', { type: 'image', assetId: 'gone' as RecordId }],
    ];
    const ids = fills.map(([, fill], k) => b.rect(screenId, { x: (k % 4) * 100, y: Math.floor(k / 4) * 100, w: 80, h: 60, style: { fill: fill as never } }));
    const drumId = b.rect(screenId, { defId: 'test:drum', x: 0, y: 200, w: 80, h: 80 });
    const file = b.build();
    const dot = { id: 'dot', type: 'asset', hash: 'a'.repeat(64), mime: 'image/png', size: 68, name: 'dot.png', w: 8, h: 6 };
    const withAsset = { ...file, records: { ...file.records, dot } } as unknown as DocumentFile;
    const { store } = createCore(withAsset);
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    await act(async () =>
      root.render(
        <ScreenView registries={registries} store={store} screenId={screenId} mode="present" view={view} assets={(id) => (id === 'dot' ? url : undefined)} />,
      ),
    );
    const fillOf = (id: RecordId) => host.querySelector<SVGPathElement>(`.fx-el[data-el-id="${id}"] .fx-outline`)?.style.fill;
    const defOf = (id: RecordId, tag: string) => host.querySelector(`.fx-el[data-el-id="${id}"] defs ${tag}`);
    const [solid, linear, radial, pattern, image, none, missing] = ids as RecordId[];
    expect(fillOf(solid as RecordId)).toBe('rgb(255, 0, 0)');
    for (const [id, tag] of [
      [linear, 'linearGradient'],
      [radial, 'radialGradient'],
      [pattern, 'pattern'],
      [image, 'pattern'],
    ] as const) {
      const def = defOf(id as RecordId, tag);
      expect(def, tag).not.toBeNull();
      expect(fillOf(id as RecordId)).toBe(`url("#${def?.id}")`);
    }
    // a pattern repeats the image at its natural size; an image fits the box
    const tile = defOf(pattern as RecordId, 'pattern');
    expect([tile?.getAttribute('width'), tile?.getAttribute('height')]).toEqual(['8', '6']);
    expect(tile?.querySelector('image')?.getAttribute('href')).toBe(url);
    expect(tile?.querySelector('image')?.getAttribute('preserveAspectRatio')).toBe('none');
    const fitted = defOf(image as RecordId, 'pattern');
    expect([fitted?.getAttribute('width'), fitted?.getAttribute('height')]).toEqual(['80', '60']);
    expect(fitted?.querySelector('image')?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    // none, and an image the host cannot draw, fill nothing
    expect(fillOf(none as RecordId)).toBe('none');
    expect(fillOf(missing as RecordId)).toBe('none');
    // decorations are drawn over the outline as unfilled strokes
    const decoration = host.querySelector<SVGPathElement>(`.fx-el[data-el-id="${drumId}"] .fx-decoration`);
    expect(decoration).not.toBeNull();
    expect(decoration?.getAttribute('d')).toMatch(/^M0 10 C/);
    expect(decoration?.style.fill).toBe('none');
    expect(getComputedStyle(decoration as SVGPathElement).strokeWidth).not.toBe('0px');
    // an asset the host has no URL for draws nothing, even with an external source: no page fetches on its own
    const pulled = { id: 'far', type: 'asset', hash: 'b'.repeat(64), mime: 'image/png', size: 1, name: 'far.png', source: 'https://example.com/far.png' };
    const b2 = documentBuilder({ seed: 5132 });
    const s2 = b2.screen({ size: { w: 400, h: 400 } });
    const farShape = b2.rect(s2, { x: 0, y: 0, w: 80, h: 60, style: { fill: { type: 'image', assetId: 'far' as RecordId } as never } });
    const lateShape = b2.rect(s2, { x: 100, y: 0, w: 80, h: 60, style: { fill: { type: 'image', assetId: 'late' as RecordId, fit: 'tile' } as never } });
    const second = b2.build();
    const store2 = createCore({ ...second, records: { ...second.records, far: pulled } } as unknown as DocumentFile).store;
    const urls = (id: RecordId) => (id === 'late' ? url : undefined);
    await act(async () => root.render(<ScreenView registries={registries} store={store2} screenId={s2} mode="present" view={view} assets={urls} />));
    expect(fillOf(farShape)).toBe('none');
    expect(host.querySelector('image[href^="https:"]')).toBeNull();
    // a URL the host has, before its asset record exists: the default tile size
    const early = host.querySelector(`.fx-el[data-el-id="${lateShape}"] defs pattern`);
    expect([early?.getAttribute('width'), early?.getAttribute('height')]).toEqual(['64', '64']);
    // the view follows its asset record: once it exists, the tile takes its natural size
    await act(async () => {
      store2.transact('add asset', (tx) =>
        tx.put({ id: 'late', type: 'asset', hash: 'c'.repeat(64), mime: 'image/png', size: 1, name: 'late.png', w: 12, h: 9 } as never),
      );
    });
    const late = host.querySelector(`.fx-el[data-el-id="${lateShape}"] defs pattern`);
    expect([late?.getAttribute('width'), late?.getAttribute('height')]).toEqual(['12', '9']);
  });
});
