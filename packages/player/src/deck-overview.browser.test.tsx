import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlayerDeck } from './player-deck.js';
import { renderRegistriesFor } from './registries.js';

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

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
/** The id of the screen the deck shows now. */
const shown = () => host.querySelector('.fx-screen')?.getAttribute('data-screen-id');
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

/** A document of three visible screens and one hidden one, in order. */
function deck() {
  const b = documentBuilder({ seed: 65 });
  const a = b.screen({ name: 'a', size: { w: 1600, h: 900 } });
  const hidden = b.screen({ name: 'hidden', size: { w: 800, h: 450 } });
  const c = b.screen({ name: 'c', size: { w: 1600, h: 900 } });
  const d = b.screen({ name: 'd', size: { w: 1600, h: 900 } });
  for (const s of [a, c, d]) b.rect(s, { x: 10, y: 10, w: 100, h: 50 });
  const doc = b.build();
  const records = { ...doc.records, [hidden]: { ...(doc.records[hidden] as object), hidden: true } };
  return { core: createCore({ ...doc, records } as typeof doc), ids: [a, c, d] };
}

describe('the deck of the one-file player', () => {
  describe('the overview grid (FR-PRS-002)', () => {
    const thumbs = () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="deck-overview"] button')];
    const open = async () => {
      const { core, ids } = deck();
      await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
      await act(frame);
      await press('o');
      await act(frame);
      return ids;
    };

    it('FR-PRS-002: O opens the grid with a thumbnail per visible screen in order, the current one marked, and O closes it', async () => {
      const ids = await open();
      expect(thumbs().map((t) => t.dataset['screenId'])).toEqual(ids);
      expect(thumbs().map((t) => t.getAttribute('aria-label'))).toEqual(['Screen 1: a', 'Screen 2: c', 'Screen 3: d']);
      expect(thumbs().map((t) => t.getAttribute('aria-current'))).toEqual(['true', null, null]);
      // each thumbnail draws its screen
      expect(host.querySelectorAll('[data-testid="deck-overview"] .fx-screen')).toHaveLength(3);
      await press('O');
      await act(frame);
      expect(host.querySelector('[data-testid="deck-overview"]')).toBeNull();
    });

    it('FR-PRS-002: a click on a thumbnail goes to that screen and closes the grid, and does not step the deck', async () => {
      const ids = await open();
      await act(async () => void thumbs()[2]?.click());
      await act(frame);
      expect(host.querySelector('[data-testid="deck-overview"]')).toBeNull();
      expect(shown()).toBe(ids[2]);
    });

    it('FR-PRS-002: Escape closes the grid on the screen it was opened on, and the deck stays still while the grid is open', async () => {
      const ids = await open();
      await press('ArrowRight');
      await press('Enter');
      await act(frame);
      expect(shown()).toBe(ids[0]);
      await press('Escape');
      await act(frame);
      expect(host.querySelector('[data-testid="deck-overview"]')).toBeNull();
      expect(shown()).toBe(ids[0]);
    });

    it('FR-PRS-002: Escape closes the grid even with a screen number half typed, and the number is dropped', async () => {
      const { core, ids } = deck();
      await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
      await act(frame);
      await press('2');
      await press('o');
      await act(frame);
      await press('Escape');
      await act(frame);
      expect(host.querySelector('[data-testid="deck-overview"]')).toBeNull();
      // the typed 2 was dropped: Enter steps one screen, it does not go to screen 2 by number
      await press('Enter');
      await act(frame);
      expect(shown()).toBe(ids[1]);
    });

    it('FR-PRS-002: focus goes to the current thumbnail, the arrow keys move it, Escape in the grid closes it and focus returns', async () => {
      const { core, ids } = deck();
      await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
      await act(frame);
      const outside = Object.assign(document.createElement('button'), { textContent: 'outside' });
      document.body.append(outside);
      outside.focus();
      await press('ArrowRight');
      await act(frame);
      await press('o');
      await act(frame);
      expect(document.activeElement).toBe(thumbs()[1]);
      const key = (to: Element, k: string) => act(async () => void to.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
      await key(thumbs()[1] as Element, 'ArrowRight');
      expect(document.activeElement).toBe(thumbs()[2]);
      await key(thumbs()[2] as Element, 'ArrowRight');
      expect(document.activeElement).toBe(thumbs()[2]);
      await key(thumbs()[2] as Element, 'Home');
      expect(document.activeElement).toBe(thumbs()[0]);
      // Tab goes round the thumbnails and never out of the grid
      await key(thumbs()[0] as Element, 'Tab');
      expect(document.activeElement).toBe(thumbs()[1]);
      await key(thumbs()[1] as Element, 'Tab');
      expect(document.activeElement).toBe(thumbs()[2]);
      await key(thumbs()[2] as Element, 'Tab');
      expect(document.activeElement).toBe(thumbs()[0]);
      await act(async () => void thumbs()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(thumbs()[2]);
      await key(thumbs()[2] as Element, 'Home');
      await key(thumbs()[0] as Element, 'Escape');
      await act(frame);
      expect(host.querySelector('[data-testid="deck-overview"]')).toBeNull();
      expect(shown()).toBe(ids[1]);
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });
  });
});
