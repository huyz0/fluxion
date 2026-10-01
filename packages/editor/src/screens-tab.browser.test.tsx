import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { EditorRoot } from './editor-root.js';
import { createSession, DEFAULT_CAMERA } from './session.js';

let host: HTMLElement;
let root: Root;
beforeEach(async () => {
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

async function mount() {
  const b = documentBuilder({ seed: 76 });
  const first = b.screen({ size: { w: 1000, h: 500 } });
  const rect = b.rect(first, { x: 100, y: 100, w: 200, h: 100 });
  const second = b.screen({ size: { w: 800, h: 800 }, name: 'Pricing' });
  const core = createCore(b.build());
  const session = createSession('doc');
  await act(async () =>
    root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} session={session} />),
  );
  await act(frame);
  const shown = () => host.querySelector('main .fx-screen')?.getAttribute('data-screen-id');
  const rows = () => [...host.querySelectorAll('ul[aria-label="Screens"] button')] as HTMLButtonElement[];
  return { core, session, first, second, rect, shown, rows };
}

describe('Screens tab (FR-EDT-006)', () => {
  it('FR-EDT-006: the Screens tab lists the screens and a click shows one', async () => {
    const { core, session, first, second, rect, shown, rows } = await mount();
    // the screens in order, a nameless one by position; the shown one pressed
    expect(rows().map((r) => [r.textContent, r.getAttribute('aria-pressed')])).toEqual([
      ['Screen 1', 'true'],
      ['Pricing', 'false'],
    ]);
    expect(shown()).toBe(first);
    const zoomOnFirst = session.camera.get().z;
    // a click shows the other: the canvas, the pressed row, an empty selection and a camera fitted to its size
    act(() => session.selection.set([rect]));
    act(() => rows()[1]?.click());
    await act(frame);
    expect([shown(), session.screen.get(), session.selection.get()]).toEqual([second, second, []]);
    expect(rows().map((r) => r.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(session.camera.get()).not.toBe(DEFAULT_CAMERA);
    expect(session.camera.get().z).not.toBe(zoomOnFirst);
    // back to the first
    act(() => rows()[0]?.click());
    await act(frame);
    expect(shown()).toBe(first);
    // deleting the shown screen falls back to the first; a new screen appears in the list
    act(() => rows()[1]?.click());
    await act(frame);
    act(() => void core.store.transact('delete screen', (tx) => tx.delete(second as RecordId)));
    await act(frame);
    // session.screen follows the fallback, so a screen that comes back (an undo) does not pull the canvas away again
    expect([shown(), rows().length, session.screen.get()]).toEqual([first, 1, first]);
  });
});
