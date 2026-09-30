import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import type { RecordId } from '@fluxion/schema';
import { seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import type { Camera } from './camera.js';
import { Canvas, ZoomControls } from './canvas.js';
import { CHROME_CSS } from './chrome-css.js';
import { newDocument } from './new-document.js';
import { createSession, type Session } from './session.js';
import type { ToolDispatcher } from './tools.js';

let host: HTMLElement;
let root: Root;
let session: Session;
let boxes: { w: number; h: number }[];
const area = { x: 0, y: 0, w: 1920, h: 1080 };
let css: HTMLStyleElement;
beforeEach(async () => {
  await page.viewport(1000, 700);
  // the chrome's own CSS, as the editor root injects it (the overlay lies over the canvas)
  css = document.createElement('style');
  css.textContent = CHROME_CSS;
  document.head.append(css);
  host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 600px; display: grid;';
  document.body.append(host);
  root = createRoot(host);
  session = createSession('doc');
  boxes = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  css.remove();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** A dispatcher that records what reaches it and takes what `takes` says. */
function recording(takes: (what: string) => boolean) {
  const seen: string[] = [];
  const tools: ToolDispatcher = {
    pointer: (e) => {
      seen.push(`${e.phase}:${e.button}`);
      return takes(e.phase);
    },
    key: (e) => {
      seen.push(`key:${e.key}`);
      return takes(e.key);
    },
    cancel: () => seen.push('cancel'),
    current: 'x.y',
    list: () => [],
  };
  return { seen, tools };
}

/** The document each mounted canvas draws, by its canvas element. */
const documents = new WeakMap<HTMLElement, { readonly store: ReturnType<typeof createCore>['store']; readonly screen: RecordId }>();
const storeOf = (main: HTMLElement) => documents.get(main) as { readonly store: ReturnType<typeof createCore>['store']; readonly screen: RecordId };

async function mount(camera: Camera = { x: 0, y: 0, z: 0.5 }, tools?: ToolDispatcher) {
  session.camera.set(camera);
  const core = createCore(newDocument(seededRandom(9)));
  const screenId = core.store.ids().find((id) => core.store.get(id)?.type === 'screen');
  await act(async () =>
    root.render(
      <Canvas
        store={core.store}
        registries={renderRegistriesFor(core.registries)}
        screenId={screenId}
        area={area}
        session={session}
        tools={tools}
        onBox={(b) => boxes.push(b)}
      />,
    ),
  );
  await act(frame);
  const main = host.querySelector('main') as HTMLElement;
  documents.set(main, { store: core.store, screen: screenId as RecordId });
  return main;
}

const fire = (target: EventTarget, e: Event) => {
  act(() => {
    target.dispatchEvent(e);
  });
  return e.defaultPrevented;
};
const wheel = (el: HTMLElement, init: WheelEventInit) =>
  fire(el, new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 100, clientY: 50, ...init }));
const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit, target: EventTarget = window) =>
  fire(target, new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
const pointer = (el: HTMLElement, type: string, [x, y]: readonly [number, number], init: PointerEventInit = {}) =>
  fire(el, new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, ...init }));

describe('canvas camera input (FR-EDT-002)', () => {
  it('FR-EDT-002: the canvas draws its screen through the session camera and reports its size', async () => {
    const main = await mount({ x: -200, y: -100, z: 0.25 });
    expect(boxes.at(-1)).toEqual({ w: 800, h: 600 });
    const screen = main.querySelector('.fx-screen') as HTMLElement;
    const r = screen.getBoundingClientRect();
    expect([r.left, r.top, r.width, r.height]).toEqual([50, 25, 480, 270]);
    act(() => session.camera.set({ x: 0, y: 0, z: 1 }));
    expect(screen.getBoundingClientRect().width).toBe(1920);
  });

  it('FR-EDT-002: a wheel pans and ctrl + wheel zooms about the pointer, never scrolling the page', async () => {
    const main = await mount();
    expect(wheel(main, { deltaX: 20, deltaY: 40 })).toBe(true);
    expect(session.camera.get()).toEqual({ x: 40, y: 80, z: 0.5 });
    wheel(main, { deltaY: -100, ctrlKey: true });
    // the page point under (100, 50) stays: (100 / 0.5 + 40, 50 / 0.5 + 80) = (240, 180)
    const c = session.camera.get();
    expect([c.z, 100 / c.z + c.x, 50 / c.z + c.y]).toEqual([1, 240, 180]);
    wheel(main, { deltaY: 100, metaKey: true });
    expect(session.camera.get().z).toBe(0.5);
  });

  it('FR-EDT-002: a Safari trackpad pinch zooms about the pinch point from the zoom it started at', async () => {
    const main = await mount({ x: 0, y: 0, z: 0.5 });
    const gesture = (type: string, scale: number) =>
      Object.assign(new UIEvent(type, { bubbles: true, cancelable: true }), { scale, clientX: 100, clientY: 50 });
    expect(fire(main, gesture('gesturestart', 1))).toBe(true);
    expect(fire(main, gesture('gesturechange', 2))).toBe(true);
    fire(main, gesture('gesturechange', 3));
    const c = session.camera.get();
    // the scale is from the start, not compounded; the page point (200, 100) stays under (100, 50)
    expect([c.z, 100 / c.z + c.x, 50 / c.z + c.y]).toEqual([1.5, 200, 100]);
  });

  it('FR-EDT-002: middle-drag and space-drag pan; a plain primary drag does not', async () => {
    const main = await mount();
    pointer(main, 'pointerdown', [10, 10]);
    pointer(main, 'pointermove', [60, 10]);
    await act(frame);
    expect(session.camera.get()).toEqual({ x: 0, y: 0, z: 0.5 });
    pointer(main, 'pointerup', [60, 10]);
    expect(pointer(main, 'pointerdown', [10, 10], { button: 1 })).toBe(true);
    pointer(main, 'pointermove', [30, 20]);
    pointer(main, 'pointermove', [40, 20]);
    // moves wait for the frame, which pans once to the latest point
    expect(session.camera.get()).toEqual({ x: 0, y: 0, z: 0.5 });
    await act(frame);
    expect(session.camera.get()).toEqual({ x: -60, y: -20, z: 0.5 });
    // another pointer neither moves nor ends the pan
    pointer(main, 'pointermove', [500, 500], { pointerId: 3 });
    pointer(main, 'pointerup', [500, 500], { pointerId: 3 });
    pointer(main, 'pointermove', [50, 20]);
    await act(frame);
    expect(session.camera.get()).toEqual({ x: -80, y: -20, z: 0.5 });
    pointer(main, 'pointercancel', [50, 20]);
    pointer(main, 'pointermove', [90, 20]);
    await act(frame);
    expect(session.camera.get().x).toBe(-80);
    expect(key('keydown', { key: ' ' })).toBe(true);
    pointer(main, 'pointerdown', [0, 0]);
    pointer(main, 'pointermove', [0, 30]);
    // the up delivers the waiting move first
    pointer(main, 'pointerup', [0, 30]);
    expect(session.camera.get()).toEqual({ x: -80, y: -80, z: 0.5 });
    key('keyup', { key: ' ' });
    pointer(main, 'pointerdown', [0, 0]);
    pointer(main, 'pointermove', [0, 30]);
    await act(frame);
    expect(session.camera.get().y).toBe(-80);
    expect(document.activeElement).toBe(main);
  });

  it('FR-EDT-002: space in a text field or on a button keeps its own meaning; blur releases space', async () => {
    const main = await mount();
    const input = document.createElement('input');
    const button = document.createElement('button');
    document.body.append(input, button);
    try {
      expect(key('keydown', { key: ' ' }, input)).toBe(false);
      pointer(main, 'pointerdown', [0, 0]);
      pointer(main, 'pointermove', [0, 30]);
      pointer(main, 'pointerup', [0, 30]);
      expect(session.camera.get().y).toBe(0);
      // on a button, space still presses it, and still holds the pan
      expect(key('keydown', { key: ' ' }, button)).toBe(false);
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      pointer(main, 'pointerdown', [0, 0]);
      pointer(main, 'pointermove', [0, 30]);
      await act(frame);
      expect(session.camera.get().y).toBe(0);
      pointer(main, 'pointerup', [0, 30]);
      key('keydown', { key: ' ' }, button);
      key('keyup', { key: 'a' });
      pointer(main, 'pointerdown', [0, 0]);
      pointer(main, 'pointermove', [0, 30]);
      await act(frame);
      expect(session.camera.get().y).toBe(-60);
    } finally {
      input.remove();
      button.remove();
    }
  });

  it('FR-EDT-003: presses and keys go to the tools, but for panning; a press a tool takes is not the browser`s', async () => {
    const { seen, tools } = recording((what) => what === 'down' || what === 'h');
    const main = await mount({ x: 0, y: 0, z: 1 }, tools);
    expect(pointer(main, 'pointerdown', [10, 10])).toBe(true);
    pointer(main, 'pointermove', [20, 10]);
    await act(frame);
    expect(pointer(main, 'pointerup', [20, 10])).toBe(false);
    // the middle button pans instead, and never reaches the tool
    pointer(main, 'pointerdown', [10, 10], { button: 1 });
    pointer(main, 'pointerup', [10, 10], { button: 1 });
    expect(seen).toEqual(['down:0', 'move:0', 'up:0']);
    expect(key('keydown', { key: 'h' })).toBe(true);
    expect(key('keydown', { key: 'q' })).toBe(false);
    // a camera shortcut is the camera's
    key('keydown', { key: '=', ctrlKey: true });
    // a key another handler took (a tab list's or splitter's arrows) is not the canvas's
    const taker = document.createElement('div');
    taker.addEventListener('keydown', (e) => e.preventDefault());
    document.body.append(taker);
    key('keydown', { key: 'ArrowRight' }, taker);
    taker.remove();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(seen.slice(3)).toEqual(['key:h', 'key:q', 'cancel']);
    // a press no tool takes stays the browser's
    const loose = recording(() => false);
    const other = await mount({ x: 0, y: 0, z: 1 }, loose.tools);
    expect(pointer(other, 'pointerdown', [10, 10])).toBe(false);
  });

  it('FR-EDT-004: the overlay lies over the canvas; a pointer leaving the canvas hovers nothing', async () => {
    const main = await mount();
    const overlay = main.querySelector('svg.fx-chrome-overlay') as SVGSVGElement;
    expect([getComputedStyle(overlay).position, getComputedStyle(overlay).pointerEvents]).toEqual(['absolute', 'none']);
    act(() => session.hover.set('x' as never));
    // React's leave comes from the pointer going out to something outside
    fire(main, new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body, pointerId: 1 }));
    expect(session.hover.get()).toBeUndefined();
  });

  it('FR-EDT-006: ctrl/cmd + Z undoes; with shift, or ctrl/cmd + Y, redoes; with alt it is neither', async () => {
    const main = await mount({ x: 0, y: 0, z: 1 });
    const doc = storeOf(main);
    const name = () => (doc.store.get(doc.screen) as { name?: string }).name;
    doc.store.transact('name', (tx) => tx.patch(doc.screen, { name: 'one' }));
    expect(key('keydown', { key: 'z', ctrlKey: true })).toBe(true);
    expect(name()).toBe('Screen 1');
    expect(key('keydown', { key: 'Z', metaKey: true, shiftKey: true })).toBe(true);
    expect(name()).toBe('one');
    key('keydown', { key: 'z', ctrlKey: true });
    expect(key('keydown', { key: 'y', ctrlKey: true })).toBe(true);
    expect(name()).toBe('one');
    expect([key('keydown', { key: 'z', ctrlKey: true, altKey: true }), key('keydown', { key: 'x', ctrlKey: true }), key('keydown', { key: 'z' })]).toEqual([
      false,
      false,
      false,
    ]);
    expect(name()).toBe('one');
  });

  it('FR-EDT-006: undo first cancels the gesture under way', async () => {
    const { seen, tools } = recording(() => false);
    const main = await mount({ x: 0, y: 0, z: 1 }, tools);
    expect(storeOf(main).store.history.canUndo()).toBe(false);
    key('keydown', { key: 'z', ctrlKey: true });
    expect(seen).toEqual(['cancel']);
  });

  it('FR-EDT-002: zoom shortcuts act on the window unless typed into a field', async () => {
    await mount({ x: 0, y: 0, z: 1 });
    expect(key('keydown', { key: '=', ctrlKey: true })).toBe(true);
    expect(session.camera.get().z).toBe(2);
    key('keydown', { key: '-', metaKey: true });
    key('keydown', { key: '-', ctrlKey: true });
    expect(session.camera.get().z).toBe(0.5);
    key('keydown', { key: ')', code: 'Digit0', shiftKey: true });
    expect(session.camera.get().z).toBe(1);
    key('keydown', { key: '!', code: 'Digit1', shiftKey: true });
    expect(session.camera.get().z).toBeCloseTo(736 / 1920, 10);
    // nothing selected: shift + 2 has nothing to fit and is left to the tools
    expect(key('keydown', { key: '@', code: 'Digit2', shiftKey: true })).toBe(false);
    expect(key('keydown', { key: 'a' })).toBe(false);
    const input = document.createElement('textarea');
    document.body.append(input);
    expect(key('keydown', { key: '=', ctrlKey: true }, input)).toBe(false);
    input.remove();
    expect(session.camera.get().z).toBeCloseTo(736 / 1920, 10);
  });

  it('FR-EDT-002: without a screen or a size, the canvas draws nothing and ignores the shortcuts', async () => {
    const core = createCore(newDocument(seededRandom(9)));
    await act(async () =>
      root.render(
        <Canvas
          store={core.store}
          registries={renderRegistriesFor(core.registries)}
          screenId={undefined}
          area={undefined}
          session={session}
          onBox={() => {}}
        />,
      ),
    );
    await act(frame);
    expect(host.querySelector('.fx-screen')).toBeNull();
    expect(key('keydown', { key: '=', ctrlKey: true })).toBe(false);
    expect(session.camera.get().z).toBe(1);
  });
});

describe('zoom controls (FR-EDT-002)', () => {
  const buttons = () => [...host.querySelectorAll('button')] as HTMLButtonElement[];
  const value = () => host.querySelector('output')?.textContent;
  const click = (name: string) =>
    act(() =>
      buttons()
        .find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)
        ?.click(),
    );

  const store = createCore(newDocument(seededRandom(9))).store;

  it('FR-EDT-002: the controls show the zoom and step, fit and reset it; each end disables its button', async () => {
    session.camera.set({ x: 0, y: 0, z: 0.5 });
    await act(async () => root.render(<ZoomControls store={store} session={session} box={{ w: 800, h: 600 }} area={area} />));
    expect(host.querySelector('fieldset')?.getAttribute('aria-label')).toBe('Zoom');
    expect(value()).toBe('50 %');
    click('Zoom in');
    expect([value(), session.camera.get().x, session.camera.get().y]).toEqual(['100 %', 400, 300]);
    click('Zoom out');
    click('Zoom out');
    expect(value()).toBe('25 %');
    click('Fit');
    expect(value()).toBe('38 %');
    click('100 %');
    expect(value()).toBe('100 %');
    act(() => session.camera.set({ x: 0, y: 0, z: 32 }));
    // nothing selected: zoom to selection (the fourth) is disabled too
    expect(buttons().map((b) => b.disabled)).toEqual([false, true, false, true, false]);
    act(() => session.camera.set({ x: 0, y: 0, z: 0.05 }));
    expect([value(), ...buttons().map((b) => b.disabled)]).toEqual(['5 %', true, false, false, true, false]);
    await act(async () => root.render(<ZoomControls store={store} session={session} box={{ w: 800, h: 600 }} area={undefined} />));
    click('Fit');
    expect(buttons()[2]?.disabled).toBe(true);
    expect(value()).toBe('5 %');
  });

  it('FR-EDT-002: zoom to selection fits the selected elements` bounds in the canvas', async () => {
    const b = documentBuilder({ seed: 121 });
    const screen = b.screen();
    const one = b.rect(screen, { x: 100, y: 100, w: 200, h: 100 });
    const two = b.rect(screen, { x: 400, y: 300, w: 100, h: 100 });
    const doc = createCore(b.build()).store;
    session.camera.set({ x: 0, y: 0, z: 1 });
    await act(async () => root.render(<ZoomControls store={doc} session={session} box={{ w: 800, h: 600 }} area={area} />));
    act(() => session.selection.set([one, two]));
    expect(buttons()[3]?.disabled).toBe(false);
    click('Zoom to selection');
    // bounds (100, 100)-(500, 400): 400 wide in 736 px of room, 300 high in 536; the height is tighter
    const z = 536 / 300;
    expect(session.camera.get()).toEqual({ x: 300 - 400 / z, y: 250 - 300 / z, z });
    // a selection of nothing placed (a connector, the screen) has nothing to fit: the control is disabled
    act(() => session.selection.set([screen]));
    expect(buttons()[3]?.disabled).toBe(true);
    click('Zoom to selection');
    expect(session.camera.get().z).toBe(z);
    // and follows the selection's elements: one moved still fits, one deleted no more
    act(() => session.selection.set([one]));
    expect(buttons()[3]?.disabled).toBe(false);
    act(() => void doc.transact('gone', (tx) => tx.delete(one)));
    expect(buttons()[3]?.disabled).toBe(true);
  });
});
