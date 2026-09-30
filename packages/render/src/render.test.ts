import { evaluateOutline } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { paintCss } from './background.js';
import { CONTENT_CSS } from './content-css.js';
import { cameraTransform, fitTransform, screenArea } from './fit.js';
import { labelStyle, plainParagraphs } from './label.js';
import { BUILTIN_MARKERS, registerBuiltinMarkers } from './markers.js';
import { modePolicy } from './mode-policy.js';
import { pathData } from './path-data.js';
import { createRenderRegistries } from './registries.js';
import { elementsInOrder, screensInOrder } from './screen-order.js';
import { TEST_RECT } from './test-shapes.js';

describe('fit view (FR-SCR-001) and mode policy (04 §2.6)', () => {
  it('FR-SCR-001: a screen fits its box at the largest uniform scale, centred', () => {
    expect(fitTransform({ w: 1920, h: 1080 }, { w: 960, h: 540 })).toEqual({ scale: 0.5, x: 0, y: 0 });
    // letterboxed: a 4:3 screen in a 16:9 box keeps its ratio and is centred horizontally
    expect(fitTransform({ w: 1024, h: 768 }, { w: 1600, h: 900 })).toEqual({ scale: 900 / 768, x: (1600 - 1024 * (900 / 768)) / 2, y: 0 });
    // a degenerate area does not divide by zero
    expect(fitTransform({ w: 0, h: 10 }, { w: 100, h: 100 })).toEqual({ scale: 1, x: 50, y: 45 });
  });

  it('FR-EDT-002: a camera view draws page point p at (p - (x, y)) * z, an infinite screen included', () => {
    expect(cameraTransform({ x: 0, y: 0, w: 1920, h: 1080 }, { x: 100, y: -50, z: 2 })).toEqual({ scale: 2, x: -200, y: 100 });
    // the viewport's corner (-100, 50) is drawn where the camera puts that page point
    expect(cameraTransform({ x: -100, y: 50, w: 400, h: 300 }, { x: -120, y: 40, z: 0.5 })).toEqual({ scale: 0.5, x: 10, y: 5 });
  });

  it('FR-SCR-001: the area of a screen is its size (default 1920x1080) or an infinite screen viewport', () => {
    expect(screenArea({})).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(screenArea({ size: { w: 800, h: 600 } })).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(screenArea({ kind: 'infinite', viewport: { x: -100, y: 50, w: 400, h: 300 } })).toEqual({ x: -100, y: 50, w: 400, h: 300 });
  });

  it('only edit mounts the overlay; only present is interactive; export and thumbnails do not measure', () => {
    expect(modePolicy('edit')).toEqual({ editOverlay: true, interactive: false, measure: true, showHidden: true });
    expect(modePolicy('present')).toEqual({ editOverlay: false, interactive: true, measure: true, showHidden: false });
    expect(modePolicy('export')).toEqual({ editOverlay: false, interactive: false, measure: false, showHidden: false });
    expect(modePolicy('thumbnail')).toEqual({ editOverlay: false, interactive: false, measure: false, showHidden: false });
  });

  it('content CSS is fx-prefixed and in @layer fx.content (ADR-0010, ADR-0015)', () => {
    expect(CONTENT_CSS.startsWith('@layer fx.content {')).toBe(true);
    const selectors = [...CONTENT_CSS.matchAll(/^\.([\w-]+)/gm)].map((m) => m[1]);
    expect(selectors.length).toBeGreaterThan(3);
    expect(selectors.every((s) => s?.startsWith('fx-'))).toBe(true);
  });
});

describe('background CSS and screen order (FR-SCR-001)', () => {
  it('FR-SCR-001: each resolved paint has its background CSS', () => {
    expect(paintCss({ type: 'color', css: '#fff' })).toEqual({ backgroundColor: '#fff' });
    expect(
      paintCss({
        type: 'linear-gradient',
        angle: 45,
        stops: [
          { offset: 0, css: 'red' },
          { offset: 0.333, css: 'blue' },
        ],
      }),
    ).toEqual({
      backgroundImage: 'linear-gradient(135deg, red 0%, blue 33.3%)',
    });
    expect(
      paintCss({
        type: 'radial-gradient',
        angle: 0,
        stops: [
          { offset: 0, css: 'red' },
          { offset: 1, css: 'blue' },
        ],
      }),
    ).toEqual({
      backgroundImage: 'radial-gradient(circle, red 0%, blue 100%)',
    });
    expect(paintCss({ type: 'image', assetId: 'x"); url(evil', fit: 'cover' }).backgroundImage).not.toContain('evil');
    expect(paintCss({ type: 'none' })).toEqual({});
  });

  it('FR-DOC-010: screens sort by index, then id; hidden ones only when asked', () => {
    const records: Record<string, { type: string; index: string; hidden?: boolean }> = {
      b: { type: 'screen', index: 'a1' },
      a: { type: 'screen', index: 'a1' },
      c: { type: 'screen', index: 'a0', hidden: true },
      d: { type: 'screen', index: 'Zz' },
    };
    const view = { members: () => Object.keys(records), get: (id: string) => records[id] } as unknown as Parameters<typeof screensInOrder>[0];
    expect(screensInOrder(view, false)).toEqual(['d', 'a', 'b']);
    expect(screensInOrder(view, true)).toEqual(['d', 'c', 'a', 'b']);
  });
});

describe('element order (FR-DOC-010)', () => {
  it('FR-DOC-010: a parent’s visible elements sort by index, then id; the screen root excludes nested ones', () => {
    const records: Record<string, { type: string; index: string; parentId?: string; hidden?: boolean }> = {
      b: { type: 'element', index: 'a1' },
      a: { type: 'element', index: 'a1' },
      g: { type: 'element', index: 'a0' },
      n: { type: 'element', index: 'Zz', parentId: 'g' },
      h: { type: 'element', index: 'a2', hidden: true },
    };
    const members = (index: string, key: string) =>
      index === 'byScreen' ? Object.keys(records) : Object.keys(records).filter((id) => records[id]?.parentId === key);
    const view = { members, get: (id: string) => records[id] } as unknown as Parameters<typeof elementsInOrder>[0];
    expect(elementsInOrder(view, 's' as never)).toEqual(['g', 'a', 'b']);
    expect(elementsInOrder(view, 's' as never, 'g' as never)).toEqual(['n']);
  });
});

describe('render registries (FR-EXT-001)', () => {
  it('FR-EXT-001: element views register by kind; a kind held by another source is refused', () => {
    const { elementViews } = createRenderRegistries();
    expect(elementViews.name).toBe('elementViews');
    const view = { Component: () => null };
    expect(elementViews.register('acme:gauge', view, 'acme').ok).toBe(true);
    expect(elementViews.get('acme:gauge')).toBe(view);
    expect(elementViews.register('acme:gauge', view, 'other').ok).toBe(false);
    // each call is a fresh set: nothing leaks between hosts
    expect(createRenderRegistries().elementViews.list()).toEqual([]);
  });
});

describe('shape outlines and labels (FR-SHP-001)', () => {
  it('FR-SHP-001: basic:rect is its box; path data is rounded to 1/1000 px', () => {
    const rect = evaluateOutline(TEST_RECT, { w: 40, h: 20 });
    expect(rect.ok ? pathData(rect.value.commands) : rect.error).toBe('M0 0 L40 0 L40 20 L0 20 Z');
    expect(
      pathData([
        { kind: 'M', to: { x: 1 / 3, y: -0.0001 } },
        { kind: 'Q', control: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
        { kind: 'C', control1: { x: 5, y: 6 }, control2: { x: 7, y: 8 }, to: { x: 9, y: 10 } },
        { kind: 'Z' },
      ]),
    ).toBe('M0.333 0 Q1 2 3 4 C5 6 7 8 9 10 Z');
    const named = createRenderRegistries();
    expect([named.shapeDefs.name, named.routers.name, named.markers.name]).toEqual(['shapeDefs', 'routers', 'markers']);
  });

  it('FR-CON-003: the built-in markers: their shapes, where the line stops, and core as their source', () => {
    expect(BUILTIN_MARKERS.map((m) => [m.id, m.path, m.inset, m.filled])).toEqual([
      ['arrow', 'M0 0 L10 5 L0 10 L3 5 Z', 7, true],
      ['triangle', 'M0 0 L10 5 L0 10 Z', 10, true],
      ['diamond', 'M0 5 L5 0 L10 5 L5 10 Z', 10, true],
      ['circle', 'M0 5 A5 5 0 1 1 10 5 A5 5 0 1 1 0 5 Z', 10, true],
      ['bar', 'M8 0 L10 0 L10 10 L8 10 Z', 2, true],
    ]);
    const markers = createRenderRegistries().markers;
    registerBuiltinMarkers(markers);
    expect(BUILTIN_MARKERS.map((m) => markers.source(m.id))).toEqual(BUILTIN_MARKERS.map(() => 'core'));
  });

  it('FR-SHP-001: a label is drawn with its resolved font, aligned vertically by flex', () => {
    const font = { family: 'F', size: '12px', weight: '700', style: 'italic', lineHeight: '1.5', color: 'red', align: 'center', verticalAlign: 'top' };
    expect(labelStyle(font as never, '0.5')).toEqual({
      fontFamily: 'F',
      fontSize: '12px',
      fontWeight: '700',
      fontStyle: 'italic',
      lineHeight: '1.5',
      color: 'red',
      textAlign: 'center',
      justifyContent: 'flex-start',
      opacity: '0.5',
    });
    const justify = (verticalAlign: string) => labelStyle({ ...font, verticalAlign } as never, '1').justifyContent;
    expect(['middle', 'bottom', 'nope'].map(justify)).toEqual(['center', 'flex-end', 'center']);
  });

  it('FR-SHP-001: a label is the plain text of each paragraph', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
          ],
        },
        { type: 'paragraph' },
      ],
    };
    expect(plainParagraphs(doc)).toEqual(['Hello world', '']);
    expect(plainParagraphs(undefined)).toEqual([]);
  });
});
