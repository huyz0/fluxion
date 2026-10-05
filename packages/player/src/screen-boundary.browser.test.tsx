import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerDeck } from './player-deck.js';
import { renderRegistriesFor } from './registries.js';
import { ScreenBoundary } from './screen-boundary.js';

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
const Bad = (): never => {
  throw new Error('a view that cannot read its field');
};

describe('the screen boundary (NFR-REL-002)', () => {
  it('NFR-REL-002: a child that throws is drawn as nothing, the error is passed on, and a sibling is untouched', async () => {
    const seen = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () =>
      root.render(
        <>
          <ScreenBoundary onError={seen}>
            <Bad />
          </ScreenBoundary>
          <p>still here</p>
        </>,
      ),
    );
    expect(host.textContent).toBe('still here');
    expect(seen).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('NFR-REL-002: a screen whose element cannot be drawn is drawn as nothing, and the keys still reach the next screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = documentBuilder({ seed: 72 });
    const [first, second] = [b.screen({ size: { w: 1600, h: 900 } }), b.screen({ size: { w: 1600, h: 900 } })];
    b.rect(second, { x: 10, y: 10, w: 100, h: 50 });
    const doc = b.build();
    const records = {
      ...doc.records,
      bad: { id: 'bad', type: 'element', kind: 'rect', screenId: first, index: 'a0', transform: null, style: 5, text: 7 },
    };
    const core = createCore({ ...doc, records } as unknown as typeof doc, { validate: false });
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    expect(host.querySelector('[data-testid="player-deck"]')).not.toBeNull();
    expect(host.querySelector(`[data-screen-id="${first}"]`)).toBeNull();
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    await act(frame);
    expect(host.querySelector('.fx-screen')?.getAttribute('data-screen-id')).toBe(second);
    vi.restoreAllMocks();
  });
});
