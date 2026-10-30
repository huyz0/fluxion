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
});
