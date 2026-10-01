import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import { seededRandom } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { EditorRoot } from './editor-root.js';
import { formatChord, KEYMAP_KEY } from './keymap-overrides.js';
import { newDocument } from './new-document.js';
import { memorySettings } from './settings.js';

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

/** A chord as the dialog shows it on this platform (Cmd on a Mac). */
const shown = (chord: string) => formatChord(chord, /Mac|iPhone|iPad/.test(navigator.platform));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const key = (k: string, o: KeyboardEventInit = {}, target: EventTarget = window) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
};

async function mount(settings = memorySettings()) {
  const core = createCore(newDocument(seededRandom(5)));
  await act(async () =>
    root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} settings={settings} />),
  );
  await act(frame);
  const dialog = () => host.querySelector('[role="dialog"]') as HTMLElement | null;
  const row = (title: string) => [...host.querySelectorAll('tbody tr')].find((r) => r.querySelector('th')?.textContent === title) as HTMLElement;
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name) as HTMLButtonElement;
  return { core, settings, dialog, row, button };
}

describe('keyboard shortcuts dialog (FR-EDT-012)', () => {
  it('FR-EDT-012: ? and the toolbar button open the dialog; every action is listed once; Esc and Close shut it', async () => {
    const { dialog, button } = await mount();
    expect(dialog()).toBeNull();
    expect(key('?', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(dialog()?.getAttribute('aria-label')).toBe('Keyboard shortcuts');
    const titles = [...host.querySelectorAll('tbody th')].map((th) => th.textContent);
    expect(titles).toContain('Undo');
    expect(titles).toContain('Select tool');
    expect(titles).toContain('Nudge left 1 px');
    expect(new Set(titles).size).toBe(titles.length);
    // the canvas's keys do not act behind it; F5 is taken (it would reload the page) but does not present
    expect(key('Delete').defaultPrevented).toBe(false);
    const f5 = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true });
    act(() => void dialog()?.dispatchEvent(f5));
    expect([f5.defaultPrevented, host.querySelector('[data-mode]')?.getAttribute('data-mode'), dialog() === null]).toEqual([true, 'edit', false]);
    const g = new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true });
    act(() => void dialog()?.dispatchEvent(g));
    expect(g.defaultPrevented).toBe(false);
    act(() => void dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(dialog()).toBeNull();
    act(() => button('Keyboard shortcuts').click());
    expect(dialog()).not.toBeNull();
    act(() => button('Close').click());
    expect(dialog()).toBeNull();
  });

  it('FR-EDT-012: Change waits for a chord (a modifier alone waits, Esc gives up), then stores it in the settings', async () => {
    const { settings, dialog, row, button } = await mount();
    key('?', { shiftKey: true });
    act(() => button('Change Undo').click());
    expect(button('Change Undo').textContent).toBe('Press the new shortcut…');
    const inDialog = (k: string, o: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
      act(() => void (document.activeElement ?? dialog())?.dispatchEvent(e));
      return e;
    };
    for (const modifier of ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']) {
      expect(inDialog(modifier).defaultPrevented).toBe(true);
      expect(button('Change Undo').textContent).toBe('Press the new shortcut…');
    }
    inDialog('Escape');
    expect([button('Change Undo').textContent, dialog() === null, settings.get(KEYMAP_KEY)]).toEqual(['Change', false, undefined]);
    act(() => button('Change Undo').click());
    inDialog('u', { ctrlKey: true });
    expect(row('Undo').querySelector('td')?.textContent).toBe(shown('mod+u'));
    expect(settings.get(KEYMAP_KEY)).toEqual({ 'history.undo': ['mod+u'] });
    expect(button('Reset Undo')).toBeDefined();
    act(() => button('Reset Undo').click());
    expect([row('Undo').querySelector('td')?.textContent, settings.get(KEYMAP_KEY), host.textContent?.includes('Reset Undo')]).toEqual([
      shown('mod+z'),
      {},
      false,
    ]);
  });

  it('FR-EDT-012: stored rebindings apply from the start: the old chord does not undo and the new one does', async () => {
    const stored = memorySettings({ [KEYMAP_KEY]: { 'history.undo': ['mod+u'] } });
    const { core, row } = await mount(stored);
    core.store.transact('edit', (tx) => tx.patch(core.store.ids().find((id) => core.store.get(id)?.type === 'screen') as never, { name: 'changed' }));
    expect(core.store.history.canUndo()).toBe(true);
    expect(key('z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(core.store.history.canUndo()).toBe(true);
    expect(key('u', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(core.store.history.canUndo()).toBe(false);
    key('?', { shiftKey: true });
    expect(row('Undo').querySelector('td')?.textContent).toBe(shown('mod+u'));
  });
});
