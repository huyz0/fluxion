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

describe('the deck of the one-file player (FR-FIL-002)', () => {
  it('FR-FIL-002: the deck shows the first visible screen, and the arrow keys move through the visible screens, stopping at the ends', async () => {
    const { core, ids } = deck();
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    expect(shown()).toBe(ids[0]);
    await press('ArrowRight');
    await act(frame);
    expect(shown()).toBe(ids[1]);
    await press('ArrowDown');
    await act(frame);
    expect(shown()).toBe(ids[2]);
    await press('ArrowRight');
    await act(frame);
    expect(shown()).toBe(ids[2]);
    await press('ArrowLeft');
    await act(frame);
    expect(shown()).toBe(ids[1]);
    await press('Home');
    await act(frame);
    expect(shown()).toBe(ids[0]);
    await press('PageUp');
    await act(frame);
    expect(shown()).toBe(ids[0]);
    await press('End');
    await act(frame);
    expect(shown()).toBe(ids[2]);
    await press(' ');
    await press('Backspace');
    await act(frame);
    expect(shown()).toBe(ids[1]);
  });

  it('FR-FIL-002: other keys and keys with a modifier do not move the deck, and a handled key is not left to the page', async () => {
    const { core, ids } = deck();
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    await press('a');
    await press('ArrowRight', { ctrlKey: true });
    await press('ArrowRight', { metaKey: true });
    await press('ArrowRight', { altKey: true });
    await act(frame);
    expect(shown()).toBe(ids[0]);
    const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(handled);
    });
    expect(handled.defaultPrevented).toBe(true);
    const ignored = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(ignored);
    });
    expect(ignored.defaultPrevented).toBe(false);
  });

  it('FR-FIL-002: keys belong to a focused link, button or field, to a handler that already took them, and are not repeated', async () => {
    const { core, ids } = deck();
    // registered before the deck's own listener, so it runs first for a key sent to the window
    const preventOnce = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') e.preventDefault();
    };
    window.addEventListener('keydown', preventOnce);
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    const field = document.createElement('input');
    const link = document.createElement('a');
    const button = document.createElement('button');
    host.append(field, link, button);
    for (const el of [field, link, button]) {
      await act(async () => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      });
    }
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, repeat: true }));
    });
    await act(frame);
    expect(shown()).toBe(ids[0]);
    // a key some other handler already took is left alone
    await press('ArrowDown');
    await act(frame);
    expect(shown()).toBe(ids[0]);
    window.removeEventListener('keydown', preventOnce);
    // the page itself (not a field) still moves the deck
    await press('ArrowRight');
    await act(frame);
    expect(shown()).toBe(ids[1]);
  });

  it('FR-FIL-002: a document without screens shows nothing and its keys do nothing', async () => {
    const { core } = deck();
    const empty = createCore({
      ...core.store.toDocument(),
      records: Object.fromEntries(Object.entries(core.store.toDocument().records).filter(([, r]) => r.type === 'document')),
    });
    await act(async () => root.render(<PlayerDeck store={empty.store} registries={renderRegistriesFor(empty.registries)} />));
    await press('ArrowRight');
    await press('End');
    expect(host.querySelector('.fx-screen')).toBeNull();
    expect(host.querySelector('[data-testid="player-deck"]')?.getAttribute('data-screen-index')).toBe('0');
  });

  it('FR-FIL-002: the deck stops listening when it is unmounted', async () => {
    const { core } = deck();
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(async () => root.render(null));
    const after = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(after);
    });
    expect(after.defaultPrevented).toBe(false);
  });

  it('FR-PRS-001: the bars around a screen take the background colour given, black by default', async () => {
    const { core } = deck();
    const registries = renderRegistriesFor(core.registries);
    await act(async () => root.render(<PlayerDeck store={core.store} registries={registries} />));
    const stage = () => host.querySelector<HTMLElement>('[data-testid="player-deck"]');
    expect(stage()?.style.background).toMatch(/rgb\(0, 0, 0\)|#000/);
    await act(async () => root.render(<PlayerDeck store={core.store} registries={registries} background="#102030" />));
    expect(stage()?.style.background).toMatch(/rgb\(16, 32, 48\)|#102030/);
  });

  it('FR-PRS-001: the F key puts the deck in full screen, and is a handled key; a modifier or a focused field leaves it alone', async () => {
    const { core } = deck();
    const requested: Element[] = [];
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'requestFullscreen');
    Element.prototype.requestFullscreen = function (this: Element) {
      requested.push(this);
      return Promise.resolve();
    };
    try {
      await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
      const event = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
      await act(async () => void window.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(requested.map((e) => e.getAttribute('data-testid'))).toEqual(['player-deck']);
      await press('f', { ctrlKey: true });
      expect(requested).toHaveLength(1);
    } finally {
      if (original === undefined) Reflect.deleteProperty(Element.prototype, 'requestFullscreen');
      else Object.defineProperty(Element.prototype, 'requestFullscreen', original);
    }
  });

  it('FR-PRS-002: a click on the stage steps forward, and one on a link or a button does not', async () => {
    const { core, ids } = deck();
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    const stage = host.querySelector<HTMLElement>('[data-testid="player-deck"]') as HTMLElement;
    await act(async () => void stage.click());
    await act(frame);
    expect(shown()).toBe(ids[1]);
    const button = Object.assign(document.createElement('button'), { textContent: 'x' });
    stage.append(button);
    await act(async () => void button.click());
    await act(frame);
    expect(shown()).toBe(ids[1]);
  });

  it('FR-PRS-002: a screen number plus Enter goes to that screen, a number past the last is ignored, Backspace erases a digit, and Enter alone steps', async () => {
    const { core, ids } = deck();
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    // three visible screens (the hidden one has no number)
    await press('3');
    await press('Enter');
    await act(frame);
    expect(shown()).toBe(ids[2]);
    await press('9');
    await press('Enter');
    await act(frame);
    expect(shown()).toBe(ids[2]);
    await press('2');
    await press('5');
    await press('Backspace');
    await press('Enter');
    await act(frame);
    expect(shown()).toBe(ids[1]);
    await press('Enter');
    await act(frame);
    expect(shown()).toBe(ids[2]);
  });

  it('FR-PRS-003: a screen with build groups takes a press for each before the next screen, and the elements a group hides are not drawn', async () => {
    const b = documentBuilder({ seed: 66 });
    const [first, second] = [b.screen({ size: { w: 1600, h: 900 } }), b.screen({ size: { w: 1600, h: 900 } })];
    const [a, c] = [b.rect(first, { x: 10, y: 10, w: 100, h: 50 }), b.rect(first, { x: 200, y: 10, w: 100, h: 50 })];
    b.rect(second, { x: 10, y: 10, w: 100, h: 50 });
    const doc = b.build();
    const step = (id: string, index: string, effect: string, target: string) => ({
      id,
      type: 'step',
      timelineId: 'tl',
      index,
      trigger: { kind: 'onClick' },
      animations: [{ id: `${id}a`, effect, targets: [target] }],
    });
    const records = {
      ...doc.records,
      tl: { id: 'tl', type: 'timeline', screenId: first, name: 'main', index: 'a0' },
      s1: step('s1', 'a1', 'appear', c),
      s2: step('s2', 'a2', 'disappear', a),
    };
    const core = createCore({ ...doc, records } as unknown as typeof doc, { validate: false });
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    const drawn = () => [...host.querySelectorAll<HTMLElement>('.fx-el')].map((e) => e.dataset['elId']);
    // before any click: the element that appears is absent
    expect(shown()).toBe(first);
    expect(drawn()).toEqual([a]);
    await press('ArrowRight');
    await act(frame);
    expect(shown()).toBe(first);
    expect(drawn()).toEqual([a, c]);
    await press('ArrowRight');
    await act(frame);
    expect(shown()).toBe(first);
    expect(drawn()).toEqual([c]);
    await press('ArrowRight');
    await act(frame);
    expect(shown()).toBe(second);
    // back takes the groups back, the previous screen first shown complete
    await press('ArrowLeft');
    await act(frame);
    expect(shown()).toBe(first);
    expect(drawn()).toEqual([c]);
    await press('ArrowLeft');
    await act(frame);
    expect(drawn()).toEqual([a, c]);
  });
});
