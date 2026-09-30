import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import { seededRandom } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import type { Camera } from './camera.js';
import { Canvas, ZoomControls } from './canvas.js';
import { newDocument } from './new-document.js';
import { createSession, type Session } from './session.js';
import type { ToolDispatcher } from './tools.js';

let host: HTMLElement;
let root: Root;
let session: Session;
let boxes: { w: number; h: number }[];
const area = { x: 0, y: 0, w: 1920, h: 1080 };
beforeEach(async () => {
  await page.viewport(1000, 700);
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
  return host.querySelector('main') as HTMLElement;
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
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(seen.slice(3)).toEqual(['key:h', 'key:q', 'cancel']);
    // a press no tool takes stays the browser's
    const loose = recording(() => false);
    const other = await mount({ x: 0, y: 0, z: 1 }, loose.tools);
    expect(pointer(other, 'pointerdown', [10, 10])).toBe(false);
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

  it('FR-EDT-002: the controls show the zoom and step, fit and reset it; each end disables its button', async () => {
    session.camera.set({ x: 0, y: 0, z: 0.5 });
    await act(async () => root.render(<ZoomControls session={session} box={{ w: 800, h: 600 }} area={area} />));
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
    expect(buttons().map((b) => b.disabled)).toEqual([false, true, false, false]);
    act(() => session.camera.set({ x: 0, y: 0, z: 0.05 }));
    expect([value(), ...buttons().map((b) => b.disabled)]).toEqual(['5 %', true, false, false, false]);
    await act(async () => root.render(<ZoomControls session={session} box={{ w: 800, h: 600 }} area={undefined} />));
    click('Fit');
    expect(buttons()[2]?.disabled).toBe(true);
    expect(value()).toBe('5 %');
  });
});
