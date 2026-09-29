import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlayerRoot } from './player-root.js';
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

describe('present-mode root (FR-EDT-001)', () => {
  it('FR-EDT-001: the player root presents the first visible screen, fitted into the window', async () => {
    const b = documentBuilder({ seed: 64 });
    const hidden = b.screen({ name: 'hidden', size: { w: 400, h: 400 } });
    const shown = b.screen({ name: 'shown', size: { w: 1600, h: 900 } });
    b.rect(shown, { x: 10, y: 10, w: 100, h: 50 });
    const doc = b.build();
    const records = { ...doc.records, [hidden]: { ...(doc.records[hidden] as object), hidden: true } };
    const core = createCore({ ...doc, records } as typeof doc);
    await act(async () => root.render(<PlayerRoot store={core.store} registries={renderRegistriesFor(core.registries)} />));
    await act(frame);
    const screens = host.querySelectorAll('.fx-screen');
    expect([...screens].map((s) => s.getAttribute('data-screen-id'))).toEqual([shown]);
    // fitted: the 16:9 screen is as wide as the window
    expect((screens[0] as HTMLElement).getBoundingClientRect().width).toBeCloseTo(window.innerWidth, 0);
    // a document without screens presents nothing
    const empty = createCore({ ...doc, records: Object.fromEntries(Object.entries(doc.records).filter(([, r]) => r.type === 'document')) } as typeof doc);
    await act(async () => root.render(<PlayerRoot store={empty.store} registries={renderRegistriesFor(empty.registries)} />));
    expect(host.querySelector('.fx-screen')).toBeNull();
    expect(host.querySelector('[data-testid="player-root"]')).not.toBeNull();
  });
});
