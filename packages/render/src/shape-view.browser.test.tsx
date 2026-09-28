import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder, type RectOptions } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { ScreenView } from './screen-view.js';

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

/** One 800x600 screen holding one rect, shown at scale 1. */
async function showRect(options: RectOptions, patch: (el: Record<string, unknown>) => Record<string, unknown> = (el) => el) {
  const b = documentBuilder({ seed: 414 });
  const screenId = b.screen({ size: { w: 800, h: 600 } });
  const id = b.rect(screenId, options);
  const file = b.build();
  const records = { ...file.records, [id]: patch({ ...(file.records[id] as object) }) } as DocumentFile['records'];
  const core = createCore({ ...file, records });
  await act(async () => root.render(<ScreenView store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 800, h: 600 } }} />));
  const screen = host.querySelector('.fx-screen')?.getBoundingClientRect() as DOMRect;
  const el = host.querySelector<HTMLElement>(`.fx-el[data-el-id="${id}"]`);
  return { id: id as RecordId, el, screen, core };
}

/** A rect's box relative to the screen's top-left corner. */
const relative = (r: DOMRect | undefined, screen: DOMRect) => ({
  x: (r?.left ?? 0) - screen.left,
  y: (r?.top ?? 0) - screen.top,
  w: r?.width ?? 0,
  h: r?.height ?? 0,
});

describe('shape view (FR-SHP-001)', () => {
  it('FR-SHP-001: rendered bounds equal the transform', async () => {
    const { el, screen } = await showRect({ x: 120, y: 80, w: 240, h: 90, label: 'Hello' });
    const outline = el?.querySelector('path.fx-outline');
    expect(outline?.getAttribute('d')).toBe('M0 0 L240 0 L240 90 L0 90 Z');
    for (const r of [el?.getBoundingClientRect(), el?.querySelector('svg')?.getBoundingClientRect()]) {
      const box = relative(r, screen);
      expect(Math.abs(box.x - 120)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(box.y - 80)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(box.w - 240)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(box.h - 90)).toBeLessThanOrEqual(0.5);
    }
    // fill and stroke come from the theme's shape defaults, through the screen's CSS variables
    const style = getComputedStyle(outline as Element);
    expect(style.fill).toBe('rgb(248, 250, 252)');
    expect(style.strokeWidth).toBe('2px');
    // the label: centred, in the body font
    const label = el?.querySelector<HTMLElement>('.fx-label');
    expect(label?.textContent).toBe('Hello');
    const font = getComputedStyle(label as HTMLElement);
    expect(font.textAlign).toBe('center');
    expect(font.justifyContent).toBe('center');
    expect(font.fontFamily).toContain('Inter');
  });

  it('FR-SHP-001: rotation is about the center', async () => {
    const { el, screen } = await showRect({ x: 200, y: 100, w: 200, h: 100, rot: 30 });
    const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    // the wrapper and the drawn outline itself (M4.14 review F3)
    for (const r of [el?.getBoundingClientRect(), el?.querySelector('path.fx-outline')?.getBoundingClientRect()]) {
      const box = relative(r, screen);
      // the centre stays where the unrotated box has it
      expect(Math.abs(box.x + box.w / 2 - 300)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(box.y + box.h / 2 - 150)).toBeLessThanOrEqual(0.5);
      // and the bounds are those of the rotated box
      expect(Math.abs(box.w - (200 * c + 100 * s))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(box.h - (200 * s + 100 * c))).toBeLessThanOrEqual(0.5);
    }
  });

  it('FR-SHP-001: literal, token and gradient fills; dashed strokes; an unknown definition is a placeholder', async () => {
    const literal = await showRect({ style: { fill: '#ff0000', stroke: { color: '{color.primary}', width: 3, dash: [4, 2] } } });
    const outline = getComputedStyle(literal.el?.querySelector('path.fx-outline') as Element);
    expect(outline.fill).toBe('rgb(255, 0, 0)');
    expect(outline.stroke).toBe('rgb(37, 99, 235)');
    expect(outline.strokeDasharray.replaceAll('px', '')).toBe('4, 2');
    const gradient = await showRect({
      style: {
        fill: {
          type: 'linear-gradient',
          angle: 90,
          stops: [
            { offset: 0, color: '#000000' },
            { offset: 1, color: '#ffffff' },
          ],
        },
      },
    });
    const grad = gradient.el?.querySelector('linearGradient');
    // the id is unique per mounted view, and the outline paints with it
    expect(grad?.id).toMatch(/^fx-fill-[\w-]+$/);
    expect(getComputedStyle(gradient.el?.querySelector('path.fx-outline') as Element).fill).toContain(`#${grad?.id}`);
    expect([grad?.getAttribute('x1'), grad?.getAttribute('y1'), grad?.getAttribute('y2')].map(Number).map((v) => Math.round(v * 1000) / 1000)).toEqual([
      80, 0, 80,
    ]);
    const unknown = await showRect({ defId: 'acme:star' });
    expect(unknown.el?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Unsupported element: shape');
    expect(unknown.core.store.get(unknown.id)).toMatchObject({ defId: 'acme:star' });
  });

  it('FR-SHP-001: one record drawn twice on a page gets a gradient id per view', async () => {
    const b = documentBuilder({ seed: 415 });
    const screenId = b.screen({ size: { w: 200, h: 100 } });
    b.rect(screenId, {
      style: {
        fill: {
          type: 'radial-gradient',
          stops: [
            { offset: 0, color: '#000000' },
            { offset: 1, color: '#ffffff' },
          ],
        },
      },
    });
    const { store } = createCore(b.build());
    const view = { kind: 'fit', box: { w: 200, h: 100 } } as const;
    await act(async () =>
      root.render(
        <>
          <ScreenView store={store} screenId={screenId} mode="thumbnail" view={view} />
          <ScreenView store={store} screenId={screenId} mode="present" view={view} />
        </>,
      ),
    );
    const ids = [...host.querySelectorAll('radialGradient')].map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('FR-SHP-001: a gradient fill matches the background gradient of the same paint', async () => {
    const linear = {
      type: 'linear-gradient',
      angle: 45,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    const radial = {
      type: 'radial-gradient',
      stops: [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#2563eb' },
      ],
    };
    /** The pixels of a 400x100 screen showing `paint` as its background, or as the fill of a shape covering it. */
    const pixels = async (paint: object, on: 'background' | 'shape') => {
      const b = documentBuilder({ seed: 430 });
      const screenId = b.screen({ size: { w: 400, h: 100 } });
      if (on === 'shape') b.rect(screenId, { x: 0, y: 0, w: 400, h: 100, style: { fill: paint as never, stroke: { color: '#000000', width: 0 } } });
      const file = b.build();
      const records = on === 'background' ? { ...file.records, [screenId]: { ...(file.records[screenId] as object), background: paint } } : file.records;
      const { store } = createCore({ ...file, records } as DocumentFile);
      await act(async () => root.render(<ScreenView store={store} screenId={screenId} mode="export" view={{ kind: 'fit', box: { w: 400, h: 100 } }} />));
      const png = await page.screenshot({ element: host.querySelector('.fx-screen') as HTMLElement, save: false });
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [img.width, img.height];
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const scale = img.width / 400;
      // a grid of interior samples, clear of the edges
      return [10, 50, 90].flatMap((y) =>
        [10, 60, 130, 200, 270, 340, 390].map((x) => [...ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data]),
      );
    };
    for (const paint of [linear, radial]) {
      const [background, shape] = [await pixels(paint, 'background'), await pixels(paint, 'shape')];
      const worst = Math.max(...shape.flatMap((rgba, i) => rgba.slice(0, 3).map((c, k) => Math.abs(c - (background[i]?.[k] ?? -99)))));
      expect(worst).toBeLessThanOrEqual(2);
    }
  });
});
