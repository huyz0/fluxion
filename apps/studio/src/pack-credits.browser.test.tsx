// The studio's credits dialog holds the clipboard chords (NFR-LIC-003, FR-EDT-007, M18.213): Firefox raises copy, cut and paste on the body when a
// button has the focus, so the editor's window listeners must not see them while the dialog is open (ci 41117375355).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import './i18n.js';
import { PackCreditsDialog } from './pack-credits.js';

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

const raise = (target: EventTarget, type: string) => target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

describe('the credits dialog and the clipboard (NFR-LIC-003)', () => {
  it('NFR-LIC-003: while the dialog is open a copy, cut or paste raised on the body or in the dialog does not reach the window, and does after it closes', async () => {
    const seen: string[] = [];
    const listen = (e: Event) => seen.push(e.type);
    for (const type of ['copy', 'cut', 'paste']) window.addEventListener(type, listen);
    try {
      await act(async () => root.render(<PackCreditsDialog packs={[]} onClose={() => undefined} />));
      const dialog = host.querySelector('dialog') as HTMLDialogElement;
      for (const type of ['copy', 'cut', 'paste']) {
        raise(document.body, type);
        raise(dialog, type);
      }
      expect(seen).toEqual([]);
      await act(async () => root.render(<span />));
      raise(document.body, 'cut');
      expect(seen).toEqual(['cut']);
    } finally {
      for (const type of ['copy', 'cut', 'paste']) window.removeEventListener(type, listen);
    }
  });

  it("NFR-LIC-003: Tab moves only between the dialog's controls, from anywhere in it, and a focus that lands outside goes back to Close (M18.213)", async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      await act(async () => root.render(<PackCreditsDialog packs={[]} onClose={() => undefined} />));
      const dialog = host.querySelector('dialog') as HTMLDialogElement;
      const close = host.querySelector('button') as HTMLButtonElement;
      expect(document.activeElement).toBe(close);
      const tab = (shiftKey = false) =>
        act(async () => {
          (document.activeElement ?? dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
        });
      // from the one control, and from the dialog itself (not a control), Tab and Shift+Tab land on a control of the dialog
      for (const shift of [false, true]) {
        await tab(shift);
        expect(document.activeElement).toBe(close);
      }
      dialog.tabIndex = -1;
      dialog.focus();
      await tab();
      expect(document.activeElement).toBe(close);
      // a focus outside while it is open comes back
      await act(async () => outside.focus());
      expect(document.activeElement).toBe(close);
      // closed, the page's focus is its own again
      await act(async () => root.render(<span />));
      outside.focus();
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it("NFR-LIC-003: undo and redo chords in the dialog are not the browser's, so a native document-wide undo cannot reach a field behind it (M18.213)", async () => {
    await act(async () => root.render(<PackCreditsDialog packs={[]} onClose={() => undefined} />));
    const close = host.querySelector('button') as HTMLButtonElement;
    const press = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      close.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(
      [
        { key: 'z', ctrlKey: true },
        { key: 'Z', metaKey: true, shiftKey: true },
        { key: 'y', ctrlKey: true },
      ].map(press),
    ).toEqual([true, true, true]);
    expect([{ key: 'a', ctrlKey: true }, { key: 'z' }].map(press)).toEqual([false, false]);
  });
});
