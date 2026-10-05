import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DebugOverlay, isOverlayChord, Measured } from './debug-overlay.js';
import { DebugStats } from './debug-stats.js';

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

const overlay = () => host.querySelector('[data-testid="debug-overlay"]');
const press = (init: KeyboardEventInit) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true, ...init }));
  });
const frames = (n: number) =>
  act(async () => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
  });

describe('the debug overlay (NFR-OBS-001)', () => {
  it('NFR-OBS-001: the overlay toggles from its shortcut', async () => {
    const stats = new DebugStats();
    stats.count('renders: edit body');
    stats.time('route', 1.5);
    await act(async () => root.render(<DebugOverlay stats={stats} />));
    expect(overlay()).toBeNull();
    // other chords are not the overlay's
    await press({ ctrlKey: true });
    await press({ shiftKey: true });
    await press({ ctrlKey: true, shiftKey: true, altKey: true });
    await press({ ctrlKey: true, shiftKey: true, key: 'e' });
    expect(overlay()).toBeNull();
    // Ctrl+Shift+D (and Cmd+Shift+D) turn it on and off
    await press({ ctrlKey: true, shiftKey: true, key: 'D' });
    expect(overlay()?.getAttribute('aria-label')).toBe('Debug overlay');
    await frames(25);
    expect(overlay()?.textContent).toMatch(/FPS \d+/);
    expect(overlay()?.textContent).toContain('renders: edit body: 1');
    expect(overlay()?.textContent).toContain('route: 1.50 ms mean');
    await press({ metaKey: true, shiftKey: true });
    expect(overlay()).toBeNull();
    expect(isOverlayChord(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it('NFR-OBS-001: Measured counts the renders of what it holds and the overlay shows them', async () => {
    await act(async () => root.render(<Measured>body</Measured>));
    await press({ ctrlKey: true, shiftKey: true });
    await frames(25);
    expect(overlay()?.textContent).toMatch(/renders: edit body: [1-9]/);
  });
});
