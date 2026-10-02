import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import { seededRandom } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { EDITOR_COMMANDS, type EditorCommand } from './editor-commands.js';
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

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const key = (k: string, o: KeyboardEventInit = {}, target: EventTarget = window) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
};
/** Ctrl (Cmd on a Mac) and `k`. */
const mod = (k: string, o: KeyboardEventInit = {}) => key(k, { ...(mac ? { metaKey: true } : { ctrlKey: true }), ...o });

async function mount(options: { settings?: ReturnType<typeof memorySettings>; commands?: readonly EditorCommand[] } = {}) {
  const core = createCore(newDocument(seededRandom(5)));
  await act(async () =>
    root.render(
      <EditorRoot
        store={core.store}
        execute={core.execute}
        registries={renderRegistriesFor(core.registries)}
        settings={options.settings ?? memorySettings()}
        {...(options.commands === undefined ? {} : { commands: options.commands })}
      />,
    ),
  );
  await act(frame);
  const palette = () => host.querySelector('[role="dialog"][aria-label="Command palette"]') as HTMLElement | null;
  const input = () => host.querySelector('input[role="combobox"]') as HTMLInputElement;
  const options_ = () => [...host.querySelectorAll('[role="option"]')] as HTMLElement[];
  const titles = () => options_().map((o) => o.querySelector('span')?.textContent);
  const type = (text: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input(), text);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const inPalette = (k: string) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    act(() => void input().dispatchEvent(e));
    return e;
  };
  return { core, palette, input, options: options_, titles, type, inPalette };
}

describe('command palette (FR-EDT-011, FR-EDT-012)', () => {
  it('FR-EDT-011: every registered command appears', async () => {
    const flip: EditorCommand = { id: 'plugin.flip', title: 'Flip the selection', run: () => true };
    const { palette, titles } = await mount({ commands: [flip] });
    expect(palette()).toBeNull();
    // Ctrl/Cmd+K opens it, and the key is taken
    expect(mod('k').defaultPrevented).toBe(true);
    expect(palette()).not.toBeNull();
    const shown = new Set(titles());
    // each registered editor command (the built-ins and the plugin's) is reachable: by its title, or by what its bindings call it
    for (const c of [...EDITOR_COMMANDS, flip]) {
      const named = c.title === 'Use a tool' ? 'Select tool' : c.title === 'Nudge the selection' ? 'Nudge left 1 px' : c.title;
      expect(shown.has(named), c.id).toBe(true);
    }
    expect(shown.has('Flip the selection')).toBe(true);
  });

  it('FR-EDT-011: typing narrows the list, Enter runs the highlighted command and closes, Esc closes, keys stay in it', async () => {
    let flipped = 0;
    const flip: EditorCommand = {
      id: 'plugin.flip',
      title: 'Flip the selection',
      run: () => {
        flipped += 1;
        return true;
      },
    };
    const { core, palette, input, titles, options, type, inPalette } = await mount({ commands: [flip] });
    core.store.transact('edit', (tx) => tx.patch(core.store.ids().find((id) => core.store.get(id)?.type === 'screen') as never, { name: 'changed' }));
    mod('k');
    expect(document.activeElement).toBe(input());
    // the canvas's keys do not act behind it
    expect(key('Delete', {}, input()).defaultPrevented).toBe(false);
    type('flp');
    expect(titles()).toEqual(['Flip the selection']);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    type('zzzz');
    expect(titles()).toEqual([]);
    expect(host.textContent).toContain('No command matches');
    expect(inPalette('Enter').defaultPrevented).toBe(false);
    type('flip');
    inPalette('Enter');
    expect([flipped, palette()]).toEqual([1, null]);
    // arrows move the highlight and wrap; Enter on the second runs that one (undo of the change above)
    mod('k');
    type('do');
    expect(titles().includes('Undo')).toBe(true);
    type('undo');
    expect(titles()[0]).toBe('Undo');
    inPalette('ArrowDown');
    inPalette('ArrowUp');
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(core.store.history.canUndo()).toBe(true);
    inPalette('Enter');
    expect([core.store.history.canUndo(), palette()]).toEqual([false, null]);
    // a click runs a command too; Esc closes without running
    mod('k');
    type('flip');
    act(() => options()[0]?.click());
    expect([flipped, palette()]).toEqual([2, null]);
    mod('k');
    expect(inPalette('Escape').defaultPrevented).toBe(true);
    expect(palette()).toBeNull();
    // the shortcuts dialog opens from the palette
    mod('k');
    type('keyboard');
    inPalette('Enter');
    expect(host.querySelector('[aria-label="Keyboard shortcuts"][role="dialog"]')).not.toBeNull();
  });

  it('FR-EDT-012: an entry shows its shortcut as the keymap has it now', async () => {
    const settings = memorySettings({ [KEYMAP_KEY]: { 'history.undo': ['mod+u'] } });
    const { options, type } = await mount({ settings });
    mod('k');
    type('undo');
    const undo = options().find((o) => o.querySelector('span')?.textContent === 'Undo');
    expect(undo?.querySelector('kbd')?.textContent).toBe(formatChord('mod+u', mac));
  });

  it('FR-EDT-012: the toolbar Undo and Redo show the keys their commands have now', async () => {
    const find = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;
    const hint = (name: string) => [find(name).title, find(name).getAttribute('aria-keyshortcuts')];
    // as bound by default
    await mount();
    expect(hint('Undo')).toEqual([`Undo (${formatChord('mod+z', mac)})`, mac ? 'Meta+Z' : 'Control+Z']);
    expect(find('Redo').title).toBe(`Redo (${['mod+shift+z', 'mod+y', 'mod+shift+y'].map((c) => formatChord(c, mac)).join(', ')})`);
    act(() => root.unmount());
    root = createRoot(host);
    // after a rebinding; a command with no key has none
    const settings = memorySettings({ [KEYMAP_KEY]: { 'history.undo': ['mod+u'], 'history.redo': [] } });
    await mount({ settings });
    expect(hint('Undo')).toEqual([`Undo (${formatChord('mod+u', mac)})`, mac ? 'Meta+U' : 'Control+U']);
    expect(hint('Redo')).toEqual(['Redo', null]);
  });
});
