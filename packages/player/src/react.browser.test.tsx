import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineFluxionPlayer, type FluxOpener, type PlayerPosition } from './element.js';
import { FluxionPlayer } from './react.js';
import { renderRegistriesFor } from './registries.js';

const opener = (): FluxOpener => {
  const b = documentBuilder({ seed: 75 });
  b.screen({ size: { w: 1600, h: 900 } });
  b.screen({ size: { w: 1600, h: 900 } });
  b.screen({ size: { w: 1600, h: 900 } });
  const doc = b.build();
  return async (bytes) => {
    if (new TextDecoder().decode(bytes) !== 'ok') return { ok: false, message: 'this file cannot be opened' };
    const core = createCore(doc, { validate: false });
    return { ok: true, value: { store: core.store, registries: renderRegistriesFor(core.registries), release: () => {} } };
  };
};
const ok = new TextEncoder().encode('ok');

let root: Root | undefined;
let host: HTMLElement;
beforeAll(() => defineFluxionPlayer(opener(), 'fluxion-player'));
afterEach(() => {
  root?.unmount();
  host?.remove();
});
const mount = (props: Parameters<typeof FluxionPlayer>[0]) => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const draw = (p: typeof props) => root?.render(createElement(FluxionPlayer, { style: { height: 360 }, ...p }));
  draw(props);
  return draw;
};
const shown = () => host.querySelector('fluxion-player')?.shadowRoot?.querySelector('.fx-screen')?.getAttribute('data-screen-id');

describe('the FluxionPlayer React component (FR-PRS-009)', () => {
  it('FR-PRS-009: a changed position prop goes to the screen', async () => {
    const loaded = vi.fn();
    const draw = mount({ bytes: ok, position: 1, onLoad: loaded });
    await vi.waitFor(() => expect(loaded).toHaveBeenCalledWith(3));
    const first = shown();
    expect(first).toBeTruthy();
    draw({ bytes: ok, position: 3, onLoad: loaded });
    await vi.waitFor(() => expect(shown()).not.toBe(first));
    const third = shown();
    draw({ bytes: ok, position: 1, onLoad: loaded });
    await vi.waitFor(() => expect(shown()).toBe(first));
    expect(third).not.toBe(first);
  });

  it('FR-PRS-009: a move calls onPosition, and a file that cannot be opened calls onError', async () => {
    const moved: PlayerPosition[] = [];
    mount({ bytes: ok, onPosition: (p) => moved.push(p) });
    await vi.waitFor(() => expect(moved.length).toBeGreaterThan(0));
    const el = host.querySelector('fluxion-player') as HTMLElement & { next(): void };
    el.next();
    await vi.waitFor(() => expect(moved.at(-1)?.index).toBe(1));
    root?.unmount();
    host.remove();
    const failed = vi.fn();
    mount({ bytes: new TextEncoder().encode('no'), onError: failed });
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith('this file cannot be opened'));
  });
});
