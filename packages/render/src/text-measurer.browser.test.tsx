import { createCore, fitShapeText, TEXT_FIT_DEFAULTS } from '@fluxion/core';
import type { DocumentFile, RecordId, RichTextDoc, TextFit } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME, resolveStyle } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenView } from './screen-view.js';
import { testRegistries } from './test-registries.js';
import { TEST_RECT } from './test-shapes.js';
import { browserMeasurer, concreteFont, createCanvasMeasurer, registerFontMetrics } from './text-measurer.js';

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

const WORDS = 'Fluxion lays out shape text in the region of its definition with the measurer the view is given';
const doc = (paragraphs: readonly string[]): RichTextDoc =>
  ({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }) as RichTextDoc;

/** One shape of `size` holding `paragraphs` with `textFit`, on a 600x600 screen at scale 1. */
async function show(size: { w: number; h: number }, paragraphs: readonly string[], textFit: TextFit, font: { size: number }) {
  const b = documentBuilder({ seed: 5140 });
  const screenId = b.screen({ size: { w: 600, h: 600 } });
  const id = b.rect(screenId, { x: 20, y: 20, ...size, style: { font: { size: font.size } } });
  const file = b.build();
  const record = { ...(file.records[id] as object), text: doc(paragraphs), textFit };
  const { store } = createCore({ ...file, records: { ...file.records, [id]: record } } as DocumentFile);
  const measurer = createCanvasMeasurer();
  await measurer.ready();
  const render = () =>
    act(async () =>
      root.render(
        <ScreenView
          registries={registries}
          store={store}
          screenId={screenId}
          mode="present"
          view={{ kind: 'fit', box: { w: 600, h: 600 } }}
          measurer={measurer}
        />,
      ),
    );
  await render();
  return { store, id: id as RecordId, measurer, render };
}

/** The height of the laid-out text: from the first paragraph's top to the last one's bottom. */
function textHeight(id: RecordId): number {
  const ps = [...host.querySelectorAll(`.fx-el[data-el-id="${id}"] .fx-label p`)];
  const [first, last] = [ps[0]?.getBoundingClientRect(), ps.at(-1)?.getBoundingClientRect()];
  return (last?.bottom ?? 0) - (first?.top ?? 0);
}

describe('shape text in its region (FR-SHP-006, ADR-0018)', () => {
  it('FR-SHP-006: grow-shape height equals the measured text within 1 px', async () => {
    const paragraphs = [WORDS, 'a second paragraph'];
    const { store, id, measurer, render } = await show({ w: 180, h: 30 }, paragraphs, { mode: 'grow' }, { size: 16 });
    // what the command editing the text computes (ADR-0018 item 4): the measured height, written to the record
    const element = store.get(id) as { transform: { w: number; h: number }; style?: object };
    const font = concreteFont(resolveStyle(element.style as never, 'shape', LIGHT_THEME).style.font, LIGHT_THEME);
    const fitted = fitShapeText({ def: TEST_RECT, size: element.transform, paragraphs, font, fit: { mode: 'grow' } }, measurer);
    const height = fitted.ok ? fitted.value.height : 0;
    expect(height).toBeGreaterThan(30);
    await act(async () => {
      store.transact('grow', (tx) => tx.patch(id, { transform: { ...element.transform, h: height } }));
    });
    await render();
    const box = host.querySelector(`.fx-el[data-el-id="${id}"]`)?.getBoundingClientRect();
    // (layout rounds to 1/64 px)
    expect(Math.abs((box?.height ?? 0) - height)).toBeLessThan(0.02);
    // the browser lays the text out in the same lines the measurer counted
    expect(Math.abs(textHeight(id) + 2 * TEXT_FIT_DEFAULTS.padding - height)).toBeLessThanOrEqual(1);
  });

  it('FR-SHP-006: shrink keeps the bounds and the font at or above its minimum', async () => {
    const size = { w: 160, h: 70 };
    const { id } = await show(size, [WORDS], { mode: 'shrink', minSize: 9 }, { size: 24 });
    const el = host.querySelector(`.fx-el[data-el-id="${id}"]`) as HTMLElement;
    const label = el.querySelector('.fx-label') as HTMLElement;
    // the shape keeps its box; the text falls below its styled size, not below the minimum, and fits
    expect([el.getBoundingClientRect().width, el.getBoundingClientRect().height]).toEqual([160, 70]);
    const shrunk = Number.parseFloat(getComputedStyle(label).fontSize);
    expect(shrunk).toBeLessThan(24);
    expect(shrunk).toBeGreaterThanOrEqual(9);
    expect(textHeight(id)).toBeLessThanOrEqual(70 - 2 * TEXT_FIT_DEFAULTS.padding + 1);
    // text that cannot fit stops at the minimum
    const flood = await show(size, [`${WORDS} ${WORDS} ${WORDS} ${WORDS}`], { mode: 'shrink', minSize: 9 }, { size: 24 });
    const floodLabel = host.querySelector(`.fx-el[data-el-id="${flood.id}"] .fx-label`) as HTMLElement;
    expect(Number.parseFloat(getComputedStyle(floodLabel).fontSize)).toBe(9);
    expect(getComputedStyle(floodLabel).overflow).toBe('visible');
    // clip cuts what does not fit at the region; visible (the default) lets it run over
    await show(size, [`${WORDS} ${WORDS} ${WORDS} ${WORDS}`], { mode: 'shrink', minSize: 9, overflow: 'clip' }, { size: 24 });
    expect(getComputedStyle(host.querySelector('.fx-label') as HTMLElement).overflow).toBe('hidden');
  });
});

describe('the page measurer (M5.14 review)', () => {
  it('FR-SHP-006: views measuring with the page measurer measure again when fonts finish loading', async () => {
    const b = documentBuilder({ seed: 5141 });
    const screenId = b.screen({ size: { w: 400, h: 400 } });
    const id = b.rect(screenId, { x: 0, y: 0, w: 120, h: 40 });
    const file = b.build();
    const record = { ...(file.records[id] as object), text: doc([WORDS]), textFit: { mode: 'shrink' } };
    const { store } = createCore({ ...file, records: { ...file.records, [id]: record } } as DocumentFile);
    // no measurer prop: the page's shared canvas measurer, which measures through the canvas
    const measureText = vi.spyOn(CanvasRenderingContext2D.prototype, 'measureText');
    await act(async () =>
      root.render(<ScreenView registries={registries} store={store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 400 } }} />),
    );
    const before = measureText.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    // fonts finish loading: the cache empties and the view measures again
    await act(async () => {
      document.fonts.dispatchEvent(new Event('loadingdone'));
      await new Promise((settle) => setTimeout(settle, 0));
    });
    expect(measureText.mock.calls.length).toBeGreaterThan(before);
    measureText.mockRestore();
  });

  it('measures in the resolved font style, with its values rather than its variables', () => {
    const font = concreteFont(
      { family: 'var(--fx-font-body)', size: 'var(--fx-font-size-md)', weight: '600', lineHeight: '1.5', style: 'italic' },
      LIGHT_THEME,
    );
    expect(font.style).toBe('italic');
    expect(font.weight).toBe(600);
    expect(font.lineHeight).toBe(1.5);
    expect(font.size).toBeGreaterThan(0);
    expect(font.family).not.toContain('var(');
    expect(concreteFont({ family: 'serif', size: 'x', weight: 'bold', lineHeight: '', style: '' }, LIGHT_THEME)).toEqual({
      family: 'serif',
      size: 16,
      weight: 400,
      lineHeight: 1.2,
      style: 'normal',
    });
  });

  it('FR-THM-008: the shared measurer uses recorded metrics for a font that has them, replaces a face registered again, and leaves other fonts to the canvas', () => {
    const face = (a: number) => ({
      family: 'FxMetricsTest',
      weight: 400,
      style: 'normal' as const,
      unitsPerEm: 1000,
      advances: { a },
      defaultAdvance: a,
      pairs: {},
      triples: {},
    });
    const measurer = browserMeasurer();
    const font = { family: '"FxMetricsTest", serif', size: 10 };
    registerFontMetrics([face(500)]);
    expect(measurer?.measure('aaaa', font).width).toBeCloseTo(20, 5);
    // the same face again: its record is replaced, not added to
    registerFontMetrics([face(600)]);
    expect(measurer?.measure('aaaa', font).width).toBeCloseTo(24, 5);
    // a font without recorded metrics is measured as the canvas does
    const other = { family: 'serif', size: 16 };
    expect(measurer?.measure('Hello', other).width).toBe(createCanvasMeasurer().measure('Hello', other).width);
  });

  it('FR-THM-008: the release a registration returns takes out those records and no others, leaving the canvas to measure that font again', () => {
    const face = (family: string, a: number) => ({
      family,
      weight: 400,
      style: 'normal' as const,
      unitsPerEm: 1000,
      advances: { a },
      defaultAdvance: a,
      pairs: {},
      triples: {},
    });
    const measurer = browserMeasurer();
    const [one, two] = [
      { family: '"FxReleaseOne", serif', size: 10 },
      { family: '"FxReleaseTwo", serif', size: 10 },
    ];
    const releaseOne = registerFontMetrics([face('FxReleaseOne', 500)]);
    const releaseTwo = registerFontMetrics([face('FxReleaseTwo', 700)]);
    expect(measurer?.measure('aaaa', one).width).toBeCloseTo(20, 5);
    expect(measurer?.measure('aaaa', two).width).toBeCloseTo(28, 5);
    releaseOne();
    // the first file's record is gone (measured by the canvas again), the second's stays
    expect(measurer?.measure('aaaa', one).width).toBe(createCanvasMeasurer().measure('aaaa', one).width);
    expect(measurer?.measure('aaaa', two).width).toBeCloseTo(28, 5);
    releaseTwo();
    // a release of a record that a later registration replaced does not take the newer one out
    const early = registerFontMetrics([face('FxReleaseOne', 500)]);
    registerFontMetrics([face('FxReleaseOne', 600)]);
    early();
    expect(measurer?.measure('aaaa', one).width).toBeCloseTo(24, 5);
  });

  it("FR-THM-008: releasing a registration gives back the record it replaced, and two documents with the same face do not take each other's out", () => {
    const face = (a: number) => ({
      family: 'FxLayerProbe',
      weight: 400,
      style: 'normal' as const,
      unitsPerEm: 1000,
      advances: {},
      defaultAdvance: a,
      pairs: {},
      triples: {},
    });
    const measurer = browserMeasurer();
    const font = { family: '"FxLayerProbe", serif', size: 10 };
    const bundled = registerFontMetrics([face(500)]);
    const first = registerFontMetrics([face(600)]);
    const second = registerFontMetrics([face(700)]);
    expect(measurer?.measure('aaaa', font).width).toBeCloseTo(28, 5);
    // the first document closes first: the second's record still stands
    first();
    expect(measurer?.measure('aaaa', font).width).toBeCloseTo(28, 5);
    // the second closes: the bundled record is back
    second();
    expect(measurer?.measure('aaaa', font).width).toBeCloseTo(20, 5);
    bundled();
    // a release twice does nothing more
    bundled();
    expect(measurer?.measure('aaaa', font).width).not.toBeCloseTo(20, 1);
  });
});
