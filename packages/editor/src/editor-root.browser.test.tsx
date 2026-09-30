import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
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
    await act(async () => root.render(<EditorRoot store={core.store} registries={renderRegistriesFor(core.registries)} />));
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
    await act(async () => root.render(<EditorRoot store={withHidden.store} registries={renderRegistriesFor(withHidden.registries)} />));
    await act(frame);
    expect(host.querySelector('.fx-screen')?.getAttribute('data-screen-id')).toBe(hidden);
  });

  it('FR-EDT-001: the chrome surrounds the canvas, styled once, and no ancestor of the canvas is left unchecked', async () => {
    const core = createCore(newDocument(seededRandom(4)));
    const registries = renderRegistriesFor(core.registries);
    await act(async () =>
      root.render(
        <>
          <EditorRoot store={core.store} registries={registries} />
          <EditorRoot store={core.store} registries={registries} />
        </>,
      ),
    );
    expect(document.querySelectorAll('style[data-fx-chrome]').length).toBe(1);
    const editor = host.querySelector('.fx-editor') as HTMLElement;
    expect(getComputedStyle(editor).position).toBe('fixed');
    const landmarks = [...editor.querySelectorAll('.fx-chrome-toolbar, .fx-chrome-panel, .fx-chrome-canvas')].map(
      (e) => `${e.tagName}:${e.getAttribute('aria-label') ?? ''}`,
    );
    expect(landmarks).toEqual(['HEADER:', 'ASIDE:Screens, library and layers', 'MAIN:Canvas', 'ASIDE:Inspector']);
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
    await act(async () => root.render(<EditorRoot store={core.store} registries={renderRegistriesFor(core.registries)} settings={settings} />));
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
    act(() => ([...host.querySelectorAll('header button')].find((b) => b.textContent === 'Focus mode') as HTMLElement).click());
    expect([panel('left'), panel('bottom'), host.querySelector('[role="separator"]')]).toEqual([null, null, null]);
    expect(host.querySelector('.fx-editor')?.getAttribute('data-focus')).toBe('true');
    expect((settings.get(LAYOUT_KEY) as { focus: boolean }).focus).toBe(true);
    // without settings, a root starts from the defaults
    await act(async () => root.render(<EditorRoot store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(async () => root.render(<EditorRoot key="fresh" store={core.store} registries={renderRegistriesFor(core.registries)} />));
    expect(panel('left')?.getBoundingClientRect().width).toBe(DEFAULT_LAYOUT.panels.left.size);
    expect(host.querySelector('.fx-editor')?.hasAttribute('data-focus')).toBe(false);
  });

  it('FR-EDT-001: on a phone-width viewport the open panels scroll aside and the canvas keeps its screen', async () => {
    await page.viewport(390, 844);
    const core = createCore(newDocument(seededRandom(6)));
    await act(async () => root.render(<EditorRoot store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    const canvas = host.querySelector('main[aria-label="Canvas"]') as HTMLElement;
    expect(canvas.getBoundingClientRect().width).toBe(320);
    expect(canvas.querySelector('.fx-screen')?.getBoundingClientRect().width).toBeGreaterThan(0);
    // both panels keep their sizes; the row scrolls instead
    expect((host.querySelector('[data-panel="right"]') as HTMLElement).getBoundingClientRect().width).toBe(280);
    const body = host.querySelector('.fx-chrome-body') as HTMLElement;
    expect(body.scrollWidth).toBeGreaterThan(body.clientWidth);
  });

  it('FR-EDT-002: a fresh session camera fits the screen on open; a moved one is kept', async () => {
    const core = createCore(newDocument(seededRandom(7)));
    const registries = renderRegistriesFor(core.registries);
    const session = createSession('doc');
    await act(async () => root.render(<EditorRoot store={core.store} registries={registries} session={session} />));
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
    await act(async () => root.render(<EditorRoot store={core.store} registries={registries} session={session} />));
    await act(frame);
    expect(session.camera.get()).toBe(moved);
  });
});
