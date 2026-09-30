import { createCore } from '@fluxion/core';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImagePicker } from './image-picker.js';
import { Overlay } from './overlay.js';
import { createSession, type Session } from './session.js';

let host: HTMLElement;
let root: Root;
let session: Session;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  session = createSession('doc');
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(withAsset: boolean) {
  const b = documentBuilder({ seed: 173 });
  const screen = b.screen();
  const core = createCore(b.build());
  if (withAsset)
    core.store.transact('asset', (tx) =>
      tx.put({ id: 'AssetAssetAsset1', type: 'asset', hash: 'a'.repeat(64), mime: 'image/png', size: 1, name: 'logo.png' } as unknown as AnyRecord),
    );
  let n = 0;
  const newId = () => `pickpickpickp${String(++n).padStart(3, '0')}` as RecordId;
  await act(async () => root.render(<ImagePicker store={core.store} session={session} execute={core.execute} screenId={screen} newId={newId} />));
  const added = () =>
    core.store
      .ids()
      .filter((id) => id.startsWith('pickpick'))
      .map((id) => core.store.get(id) as AnyRecord & { kind: string });
  return { core, added };
}

const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;

describe('image picker (FR-EDT-003)', () => {
  it('FR-EDT-003: the picker opens for the image tool`s box and adds the image picked there, in one undo step', async () => {
    const { core, added } = await mount(true);
    expect(dialog()).toBeNull();
    act(() => session.imagePick.set({ x: 5, y: 6, w: 240, h: 160 }));
    expect(dialog()?.getAttribute('aria-label')).toBe('Choose an image');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['logo.png', 'Image placeholder', 'Cancel']);
    // the first choice has the focus, for the keyboard
    expect(document.activeElement).toBe(button('logo.png'));
    const depth = core.store.history.undoDepth;
    act(() => button('logo.png').click());
    expect(added()).toEqual([expect.objectContaining({ kind: 'image', assetId: 'AssetAssetAsset1', transform: { x: 5, y: 6, w: 240, h: 160 } })]);
    expect([dialog(), session.imagePick.get(), session.selection.get()]).toEqual([null, undefined, [added()[0]?.id]]);
    expect(core.store.history.undoDepth).toBe(depth + 1);
  });

  it('FR-EDT-003: without images it says so and offers the placeholder; Esc and Cancel add nothing', async () => {
    const { added } = await mount(false);
    act(() => session.imagePick.set({ x: 0, y: 0, w: 240, h: 160 }));
    expect(host.querySelector('p')?.textContent).toBe('This document holds no images yet.');
    expect(document.activeElement).toBe(button('Image placeholder'));
    act(() => dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })));
    expect(dialog()).not.toBeNull();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => dialog()?.dispatchEvent(esc));
    expect([dialog(), esc.defaultPrevented, added()]).toEqual([null, true, []]);
    // keys stay in the dialog: they never reach the window (the canvas's shortcuts and undo)
    act(() => session.imagePick.set({ x: 0, y: 0, w: 240, h: 160 }));
    const seen: string[] = [];
    const onWindow = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener('keydown', onWindow);
    const press = (k: string, shiftKey = false) => {
      const e = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true });
      act(() => (document.activeElement as HTMLElement).dispatchEvent(e));
      return e.defaultPrevented;
    };
    // Tab cycles through the buttons: from the last to the first, and shift+Tab back
    act(() => button('Cancel').focus());
    expect(press('Tab')).toBe(true);
    expect(document.activeElement).toBe(button('Image placeholder'));
    expect(press('Tab', true)).toBe(true);
    expect(document.activeElement).toBe(button('Cancel'));
    // inside the cycle, Tab is the browser's own; other keys are not taken, only kept in
    act(() => button('Image placeholder').focus());
    expect([press('Tab'), press('r')]).toEqual([false, false]);
    window.removeEventListener('keydown', onWindow);
    expect(seen).toEqual([]);
    act(() => button('Cancel').click());
    expect([dialog(), added()]).toEqual([null, []]);
    act(() => session.imagePick.set({ x: 0, y: 0, w: 240, h: 160 }));
    act(() => button('Image placeholder').click());
    expect(added()).toEqual([expect.objectContaining({ kind: 'shape', defId: 'basic:image-frame' })]);
  });

  it('FR-EDT-003: the overlay draws the creation draft, sketch and laser through the camera', async () => {
    const core = createCore(documentBuilder({ seed: 174 }).build());
    session.camera.set({ x: 10, y: 0, z: 2 });
    await act(async () => root.render(<Overlay store={core.store} session={session} box={{ w: 400, h: 300 }} />));
    expect(host.querySelector('.fx-chrome-draft')).toBeNull();
    act(() => session.draft.set({ x: 20, y: 5, w: 30, h: 10 }));
    const draft = host.querySelector('rect.fx-chrome-draft');
    expect(['x', 'y', 'width', 'height'].map((a) => draft?.getAttribute(a))).toEqual(['20', '10', '60', '20']);
    // and a tool's sketch line
    expect(host.querySelector('.fx-chrome-sketch')).toBeNull();
    act(() =>
      session.sketch.set([
        { x: 10, y: 0 },
        { x: 30, y: 5 },
      ]),
    );
    expect(host.querySelector('polyline.fx-chrome-sketch')?.getAttribute('points')).toBe('0,0 40,10');
    // and the laser's trail, fading from its oldest point to its newest
    act(() =>
      session.laser.set([
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    );
    const dots = [...host.querySelectorAll('circle.fx-chrome-laser')];
    expect(dots.map((d) => [d.getAttribute('cx'), d.getAttribute('opacity')])).toEqual([
      ['0', '0.5'],
      ['20', '1'],
    ]);
  });
});
