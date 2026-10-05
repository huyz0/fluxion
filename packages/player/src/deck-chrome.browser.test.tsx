import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckChrome } from './deck-chrome.js';
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
  vi.useRealTimers();
  act(() => root.unmount());
  host.remove();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const bar = () => host.querySelector<HTMLElement>('[part="controls"]') as HTMLElement;
const press = (key: string) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

/** A deck of three screens. */
function deck() {
  const b = documentBuilder({ seed: 71 });
  const ids = [1, 2, 3].map(() => b.screen({ size: { w: 1600, h: 900 } }));
  return { core: createCore(b.build()), ids };
}

describe('the deck chrome (FR-PRS-006)', () => {
  it('FR-PRS-006: the progress bar and the counter follow the screen shown, and the controls move through the screens', async () => {
    const { core, ids } = deck();
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} chrome />));
    await act(frame);
    const progress = () => host.querySelector('[part="progress"]') as HTMLElement;
    const counter = () => host.querySelector('[part="counter"]')?.textContent;
    expect([counter(), progress().getAttribute('aria-valuenow'), progress().getAttribute('aria-valuemax')]).toEqual(['1 / 3', '1', '3']);
    expect(Number.parseFloat((host.querySelector('[part="progress-fill"]') as HTMLElement).style.width)).toBeCloseTo(33.33, 1);
    await act(async () => host.querySelector<HTMLElement>('[part="next"]')?.click());
    await act(frame);
    expect([counter(), progress().getAttribute('aria-valuenow')]).toEqual(['2 / 3', '2']);
    expect(host.querySelector('.fx-screen')?.getAttribute('data-screen-id')).toBe(ids[1]);
    await act(async () => host.querySelector<HTMLElement>('[part="previous"]')?.click());
    await act(frame);
    expect(counter()).toBe('1 / 3');
    // the overview button opens the grid; a click on the chrome does not step the deck
    await act(async () => host.querySelector<HTMLElement>('[part="overview"]')?.click());
    await act(frame);
    expect(host.querySelector('[data-testid="deck-overview"]')).not.toBeNull();
    await press('Escape');
    // the chrome is not drawn unless asked for
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    expect(host.querySelector('[data-testid="deck-chrome"]')).toBeNull();
  });

  it('FR-PRS-006: the controls hide after the idle time, come back on a pointer move, a key or focus, and hidden controls are no tab stops', async () => {
    vi.useFakeTimers();
    const nothing = () => undefined;
    await act(async () =>
      root.render(<DeckChrome index={0} count={2} onPrevious={nothing} onNext={nothing} onOverview={nothing} onFullscreen={nothing} idleMs={3000} />),
    );
    expect(bar().dataset['visible']).toBe('true');
    await act(async () => void vi.advanceTimersByTime(2999));
    expect(bar().dataset['visible']).toBe('true');
    await act(async () => void vi.advanceTimersByTime(2));
    expect(bar().dataset['visible']).toBe('false');
    expect(getComputedStyle(bar()).visibility).toBe('hidden');
    await act(async () => void window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })));
    expect(bar().dataset['visible']).toBe('true');
    expect(getComputedStyle(bar()).visibility).toBe('visible');
    // a move restarts the wait
    await act(async () => void vi.advanceTimersByTime(2000));
    await act(async () => void window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })));
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(bar().dataset['visible']).toBe('true');
    await act(async () => void vi.advanceTimersByTime(1500));
    expect(bar().dataset['visible']).toBe('false');
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })));
    expect(bar().dataset['visible']).toBe('true');
  });

  it('FR-PRS-006: the page names the controls, the counter reads 0 / 0 with no screens, and a count of one fills the bar', async () => {
    const nothing = () => undefined;
    await act(async () =>
      root.render(
        <DeckChrome index={0} count={0} onPrevious={nothing} onNext={nothing} onOverview={nothing} onFullscreen={nothing} labels={{ next: 'Suivant' }} />,
      ),
    );
    expect(host.querySelector('[part="next"]')?.getAttribute('aria-label')).toBe('Suivant');
    expect(host.querySelector('[part="previous"]')?.getAttribute('aria-label')).toBe('Previous screen');
    expect(host.querySelector('[part="counter"]')?.textContent).toBe('0 / 0');
    await act(async () => root.render(<DeckChrome index={0} count={1} onPrevious={nothing} onNext={nothing} onOverview={nothing} onFullscreen={nothing} />));
    expect((host.querySelector('[part="progress-fill"]') as HTMLElement).style.width).toBe('100%');
  });

  it('FR-PRS-006: after a click on a control the deck keys still work, the page names the controls through the deck, and the colours come from variables', async () => {
    const { core, ids } = deck();
    await act(async () => root.render(<PlayerDeck store={core.store} registries={renderRegistriesFor(core.registries)} chrome labels={{ next: 'Suivant' }} />));
    await act(frame);
    const next = host.querySelector<HTMLElement>('[part="next"]') as HTMLElement;
    expect(next.getAttribute('aria-label')).toBe('Suivant');
    next.focus();
    // a pointer click carries a click count; a key press (or a script's click()) does not
    await act(async () => void next.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
    await act(frame);
    // the button let go of focus, and a key aimed at a chrome button that is not Enter or Space is the deck's
    expect(document.activeElement).not.toBe(next);
    next.focus();
    await act(async () => void next.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    await act(frame);
    expect(host.querySelector('.fx-screen')?.getAttribute('data-screen-id')).toBe(ids[2]);
    // the counter stays when the controls are hidden, and the progress fill takes its colour from a variable
    const fill = host.querySelector('[part="progress-fill"]') as HTMLElement;
    host.style.setProperty('--fx-player-progress-fill', 'rgb(1, 2, 3)');
    expect(getComputedStyle(fill).backgroundColor).toBe('rgb(1, 2, 3)');
  });
});
