import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import { createRenderRegistries, type ElementViewProps, ShapeView } from '@fluxion/render';
import { seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { CANVAS_PATH } from './chrome-css.js';
import { EditorRoot } from './editor-root.js';
import { DEFAULT_LAYOUT, LAYOUT_KEY } from './layout.js';
import { newDocument } from './new-document.js';
import { createSession, DEFAULT_CAMERA } from './session.js';
import { memorySettings } from './settings.js';

let host: HTMLElement;
let root: Root;
beforeEach(async () => {
  // a desktop viewport: both side panels beside a canvas (the default iframe is phone-sized)
  await page.viewport(1280, 800);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe('edit-mode root (FR-EDT-001)', () => {
  it('FR-EDT-001: the editor shows the first screen on a named canvas, hidden screens included', async () => {
    const core = createCore(newDocument(seededRandom(3)));
    await act(async () => root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    const canvas = host.querySelector('main[aria-label="Canvas"]');
    expect(canvas).not.toBeNull();
    const screen = canvas?.querySelector('.fx-screen') as HTMLElement;
    const box = screen.getBoundingClientRect();
    expect(box.width / box.height).toBeCloseTo(16 / 9, 2);
    // edit mode: the screen is not interactive content
    expect(screen.hasAttribute('data-interactive')).toBe(false);
    // a hidden first screen is still edited
    const b = documentBuilder({ seed: 65 });
    const hidden = b.screen({ size: { w: 800, h: 600 } });
    const doc = b.build();
    const withHidden = createCore({ ...doc, records: { ...doc.records, [hidden]: { ...(doc.records[hidden] as object), hidden: true } } } as typeof doc);
    await act(async () =>
      root.render(<EditorRoot store={withHidden.store} execute={withHidden.execute} registries={renderRegistriesFor(withHidden.registries)} />),
    );
    await act(frame);
    expect(host.querySelector('.fx-screen')?.getAttribute('data-screen-id')).toBe(hidden);
  });

  it('FR-EDT-001: the chrome surrounds the canvas, styled once, and no ancestor of the canvas is left unchecked', async () => {
    const core = createCore(newDocument(seededRandom(4)));
    const registries = renderRegistriesFor(core.registries);
    await act(async () =>
      root.render(
        <>
          <EditorRoot store={core.store} execute={core.execute} registries={registries} />
          <EditorRoot store={core.store} execute={core.execute} registries={registries} />
        </>,
      ),
    );
    expect(document.querySelectorAll('style[data-fx-chrome]').length).toBe(1);
    const editor = host.querySelector('.fx-editor') as HTMLElement;
    expect(getComputedStyle(editor).position).toBe('fixed');
    const landmarks = [...editor.querySelectorAll('.fx-chrome-toolbar, .fx-chrome-panel, .fx-chrome-canvas')].map(
      (e) => `${e.getAttribute('role') ?? e.tagName}:${e.getAttribute('aria-label') ?? ''}`,
    );
    expect(landmarks).toEqual(['banner:Toolbar', 'ASIDE:Screens, library and layers', 'MAIN:Canvas', 'ASIDE:Inspector']);
    expect([...editor.querySelectorAll('[role="separator"]')].map((s) => s.getAttribute('aria-label'))).toEqual([
      'Resize the left panel',
      'Resize the timeline',
      'Resize the inspector',
    ]);
    // every element from the editor root down to the canvas is on CANVAS_PATH, whose rules chrome-css.test.ts checks
    const path: string[] = [];
    for (let e: Element | null = editor.querySelector('main'); e && e !== host; e = e.parentElement) path.unshift(e.className);
    expect(path).toEqual(CANVAS_PATH);
    // chrome fonts stay beside the canvas: content inherits the page's, not the toolbar's
    expect(getComputedStyle(editor.querySelector('main') as HTMLElement).fontSize).toBe(getComputedStyle(host).fontSize);
  });

  it('FR-EDT-001: the layout is read from settings, written back on change, and focus mode hides every panel', async () => {
    const core = createCore(newDocument(seededRandom(5)));
    const settings = memorySettings({
      [LAYOUT_KEY]: { panels: { left: { size: 300, collapsed: false }, right: { size: 250, collapsed: true }, bottom: { size: 120, collapsed: false } } },
    });
    await act(async () =>
      root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} settings={settings} />),
    );
    const panel = (p: string) => host.querySelector(`[data-panel="${p}"]`) as HTMLElement | null;
    expect(panel('left')?.getBoundingClientRect().width).toBe(300);
    expect(panel('right')).toBeNull();
    expect(panel('bottom')?.getBoundingClientRect().height).toBe(120);
    const splitter = host.querySelector('[aria-label="Resize the left panel"]') as HTMLElement;
    expect(splitter.getAttribute('aria-controls')).toBe(panel('left')?.id);
    expect(host.querySelector('[aria-label="Resize the inspector"]')?.hasAttribute('aria-controls')).toBe(false);
    act(() => {
      splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(panel('left')?.getBoundingClientRect().width).toBe(310);
    expect(settings.get(LAYOUT_KEY)).toEqual({
      panels: { left: { size: 310, collapsed: false }, right: { size: 250, collapsed: true }, bottom: { size: 120, collapsed: false } },
      focus: false,
    });
    act(() => ([...host.querySelectorAll('[role="banner"] button')].find((b) => b.textContent === 'Focus mode') as HTMLElement).click());
    expect([panel('left'), panel('bottom'), host.querySelector('[role="separator"]')]).toEqual([null, null, null]);
    expect(host.querySelector('.fx-editor')?.getAttribute('data-focus')).toBe('true');
    expect((settings.get(LAYOUT_KEY) as { focus: boolean }).focus).toBe(true);
    // without settings, a root starts from the defaults
    await act(async () => root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} />));
    await act(async () => root.render(<EditorRoot key="fresh" store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} />));
    expect(panel('left')?.getBoundingClientRect().width).toBe(DEFAULT_LAYOUT.panels.left.size);
    expect(host.querySelector('.fx-editor')?.hasAttribute('data-focus')).toBe(false);
  });

  it('FR-EDT-001: on a phone-width viewport the open panels scroll aside and the canvas keeps its screen', async () => {
    await page.viewport(390, 844);
    const core = createCore(newDocument(seededRandom(6)));
    // a first visit on a phone: the side panels start collapsed, the canvas has the width
    await act(async () => root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    const first = host.querySelector('main[aria-label="Canvas"]') as HTMLElement;
    // (a collapsed panel keeps its 4 px splitter, to open it again)
    expect([first.getBoundingClientRect().width, host.querySelector('[data-panel="left"]'), host.querySelector('[data-panel="right"]')]).toEqual([
      382,
      null,
      null,
    ]);
    act(() => root.unmount());
    root = createRoot(host);
    // panels the user opened (a stored layout): they scroll aside
    const settings = memorySettings();
    settings.set(LAYOUT_KEY, DEFAULT_LAYOUT);
    await act(async () =>
      root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} settings={settings} />),
    );
    await act(frame);
    const canvas = host.querySelector('main[aria-label="Canvas"]') as HTMLElement;
    expect(canvas.getBoundingClientRect().width).toBe(320);
    expect(canvas.querySelector('.fx-screen')?.getBoundingClientRect().width).toBeGreaterThan(0);
    // both panels keep their sizes; the row scrolls instead
    expect((host.querySelector('[data-panel="right"]') as HTMLElement).getBoundingClientRect().width).toBe(280);
    const body = host.querySelector('.fx-chrome-body') as HTMLElement;
    expect(body.scrollWidth).toBeGreaterThan(body.clientWidth);
  });

  it('FR-EDT-003: with the select tool a click selects the element under it, and a click on nothing clears', async () => {
    const b = documentBuilder({ seed: 70 });
    const screen = b.screen();
    const rect = b.rect(screen, { x: 100, y: 100, w: 400, h: 200, defId: 'basic:rect' });
    const core = createCore(b.build());
    const registries = renderRegistriesFor(core.registries);
    core.registries.shapeDefs.register(
      'basic:rect',
      { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } },
      'test',
    );
    const session = createSession('doc');
    await act(async () => root.render(<EditorRoot store={core.store} execute={core.execute} registries={registries} session={session} />));
    await act(frame);
    const main = host.querySelector('main') as HTMLElement;
    const at = (page: { x: number; y: number }) => {
      const c = session.camera.get();
      const r = main.getBoundingClientRect();
      return { clientX: r.left + (page.x - c.x) * c.z, clientY: r.top + (page.y - c.y) * c.z };
    };
    const click = (page: { x: number; y: number }) =>
      act(() => {
        for (const type of ['pointerdown', 'pointerup'])
          main.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...at(page) }));
      });
    const said = () => host.querySelector('aside[aria-label="Inspector"] p')?.textContent;
    click({ x: 300, y: 200 });
    expect([session.selection.get(), said()]).toEqual([[rect], '1 element selected']);
    click({ x: 1500, y: 900 });
    expect([session.selection.get(), said()]).toEqual([[], 'Select an element to see its properties.']);
    // the toolbar lists the built-in tools; H switches to the hand, Esc back
    expect([...host.querySelectorAll('fieldset[aria-label="Tools"] button')].map((x) => x.textContent)).toEqual([
      'Connector',
      'Frame',
      'Freehand',
      'Hand',
      'Image',
      'Pen',
      'Select',
      'Shape',
      'Text',
    ]);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    });
    expect(session.tool.get()).toBe('hand');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(session.tool.get()).toBe('select');
  });

  it('FR-EDT-002: a fresh session camera fits the screen on open; a moved one is kept', async () => {
    const core = createCore(newDocument(seededRandom(7)));
    const registries = renderRegistriesFor(core.registries);
    const session = createSession('doc');
    await act(async () => root.render(<EditorRoot store={core.store} execute={core.execute} registries={registries} session={session} />));
    await act(frame);
    const canvas = host.querySelector('main') as HTMLElement;
    const fitted = session.camera.get();
    expect(fitted).not.toBe(DEFAULT_CAMERA);
    // 1920 wide into the canvas less 32 px each side
    expect(fitted.z).toBeCloseTo((canvas.clientWidth - 64) / 1920, 10);
    expect(host.querySelector('output')?.textContent).toBe(`${Math.round(fitted.z * 100)} %`);
    // a resized screen is fitted at its new size
    const screenId = core.store.ids().find((i) => core.store.get(i)?.type === 'screen') as never;
    act(() => {
      core.store.transact('resize', (tx) => tx.patch(screenId, { size: { w: 960, h: 1080 } }));
    });
    act(() => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Fit') as HTMLElement).click());
    expect(session.camera.get().z).toBeCloseTo(Math.min((canvas.clientWidth - 64) / 960, (canvas.clientHeight - 64) / 1080), 10);
    // deleting the open screen leaves the editor empty, and the delete succeeds
    const deleted = core.store.transact('delete', (tx) => tx.delete(screenId));
    expect(deleted.ok).toBe(true);
    await act(frame);
    expect(host.querySelector('.fx-screen')).toBeNull();
    expect(([...host.querySelectorAll('button')].find((b) => b.textContent === 'Fit') as HTMLButtonElement).disabled).toBe(true);
    act(() => root.unmount());
    root = createRoot(host);
    const moved = { x: 5, y: 6, z: 2 };
    session.camera.set(moved);
    await act(async () => root.render(<EditorRoot store={core.store} execute={core.execute} registries={registries} session={session} />));
    await act(frame);
    expect(session.camera.get()).toBe(moved);
  });

  it('FR-EDT-005: dragging one element re-renders only that element and the overlay', async () => {
    const b = documentBuilder({ seed: 71 });
    const screen = b.screen();
    const moving = b.rect(screen, { x: 100, y: 100, w: 300, h: 200 });
    const still = b.rect(screen, { x: 900, y: 100, w: 300, h: 200 });
    const core = createCore(b.build());
    core.registries.shapeDefs.register(
      'basic:rect',
      { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } },
      'test',
    );
    // every shape drawn is counted, by element
    const renders = new Map<string, number>();
    const Counting = (props: ElementViewProps) => {
      renders.set(props.element.id, (renders.get(props.element.id) ?? 0) + 1);
      return <ShapeView {...props} />;
    };
    const registries = createRenderRegistries(core.registries.shapeDefs);
    registries.elementViews.register('shape', { Component: Counting }, 'test');
    const session = createSession('doc');
    await act(async () => root.render(<EditorRoot store={core.store} execute={core.execute} registries={registries} session={session} />));
    await act(frame);
    const main = host.querySelector('main') as HTMLElement;
    const client = (x: number, y: number) => {
      const c = session.camera.get();
      const r = main.getBoundingClientRect();
      return { clientX: r.left + (x - c.x) * c.z, clientY: r.top + (y - c.y) * c.z };
    };
    const fire = (type: string, x: number, y: number) =>
      act(() => {
        main.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, ...client(x, y) }));
      });
    fire('pointerdown', 250, 200);
    await act(frame);
    // the overlay mounts with the selection
    const overlay = host.querySelector('svg.fx-chrome-overlay') as SVGSVGElement;
    const framed = () => (overlay.querySelector('polygon.fx-chrome-frame') as SVGPolygonElement).points[0]?.x ?? Number.NaN;
    const startX = framed();
    const before = { moving: renders.get(moving) ?? 0, still: renders.get(still) ?? 0 };
    for (const dx of [20, 40, 60, 80]) {
      fire('pointermove', 250 + dx, 200);
      await act(frame);
    }
    fire('pointerup', 330, 200);
    await act(frame);
    expect((core.store.get(moving) as { transform: { x: number } }).transform.x).toBeCloseTo(180, 6);
    // a translate changes only the box's place: the moved element's wrapper followed it, while neither
    // view drew again (ADR-0028 §4, 04 §5)
    expect((host.querySelector(`.fx-el[data-el-id="${moving}"]`) as HTMLElement).style.left).toBe('180px');
    expect([(renders.get(moving) ?? 0) - before.moving, (renders.get(still) ?? 0) - before.still]).toEqual([0, 0]);
    // and the overlay's frame followed it, 80 page units on the canvas
    expect(framed() - startX).toBeCloseTo(80 * session.camera.get().z, 3);
    expect(host.querySelector(`.fx-el[data-el-id="${still}"]`)).not.toBeNull();
  });
});
