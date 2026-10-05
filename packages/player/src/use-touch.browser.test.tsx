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
  host.style.cssText = 'position:relative;width:400px;height:300px';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const stage = () => host.querySelector('[data-testid="player-deck"]') as HTMLElement;
const index = () => stage().getAttribute('data-screen-index');
const zoom = () => Number(stage().getAttribute('data-zoom'));

/** A touch pointer event of finger `id` at (x, y) on the stage. */
const finger = (type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, x: number, y: number) =>
  act(async () => {
    stage().dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  });
const swipe = async (from: number, to: number) => {
  await finger('pointerdown', 1, from, 150);
  await finger('pointermove', 1, (from + to) / 2, 150);
  await finger('pointermove', 1, to, 150);
  await finger('pointerup', 1, to, 150);
};

async function open() {
  const b = documentBuilder({ seed: 76 });
  const ids = [1, 2, 3].map(() => b.screen({ size: { w: 1600, h: 900 } }));
  for (const s of ids) b.rect(s, { x: 10, y: 10, w: 100, h: 50 });
  const core = createCore(b.build());
  await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} layout="container" />));
  await act(frame);
}

describe('touch on the deck (FR-RSP-001)', () => {
  it('FR-RSP-001: a swipe left goes to the next screen, a swipe right back, and a pinch zooms within bounds until a new screen starts at fit', async () => {
    await open();
    expect(index()).toBe('0');
    await swipe(300, 100);
    expect(index()).toBe('1');
    await swipe(100, 300);
    expect(index()).toBe('0');
    // a pinch: two fingers spread
    await finger('pointerdown', 1, 150, 150);
    await finger('pointerdown', 2, 250, 150);
    await finger('pointermove', 2, 600, 150);
    await finger('pointermove', 1, -200, 150);
    expect(zoom()).toBe(4);
    expect(stage().style.touchAction).toBe('none');
    const view = host.querySelector('[data-testid="deck-view"]') as HTMLElement;
    expect(view.style.transform).toMatch(/^translate\(.+\) scale\(4\)$/);
    await finger('pointerup', 1, -200, 150);
    await finger('pointerup', 2, 600, 150);
    // zoomed in, a swipe does not move the deck
    await swipe(300, 100);
    expect(index()).toBe('0');
    // a double tap fits it again, and the click the browser makes of the second tap is no step forward
    for (const _ of [1, 2]) {
      await finger('pointerdown', 1, 200, 150);
      await finger('pointerup', 1, 200, 150);
    }
    expect(zoom()).toBe(1);
    await act(async () => stage().click());
    expect(index()).toBe('0');
    expect(stage().style.touchAction).toBe('pan-y');
  });

  it('FR-RSP-001: a tap steps forward at fit and not while zoomed; a mouse pointer is not a touch; a resize keeps the screen and starts at fit', async () => {
    await open();
    await act(async () => stage().click());
    expect(index()).toBe('1');
    await act(async () => {
      stage().dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 9, clientX: 300, clientY: 150, bubbles: true }));
      stage().dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', pointerId: 9, clientX: 100, clientY: 150, bubbles: true }));
    });
    expect(index()).toBe('1');
    await finger('pointerdown', 1, 150, 150);
    await finger('pointerdown', 2, 250, 150);
    await finger('pointermove', 2, 400, 150);
    await finger('pointerup', 1, 150, 150);
    await finger('pointerup', 2, 400, 150);
    expect(zoom()).toBeGreaterThan(1);
    await act(async () => stage().click());
    expect(index()).toBe('1');
    // the stage changes size (a rotation): same screen, back to fit
    host.style.width = '300px';
    host.style.height = '400px';
    await act(frame);
    await act(frame);
    expect(index()).toBe('1');
    expect(zoom()).toBe(1);
  });
});
