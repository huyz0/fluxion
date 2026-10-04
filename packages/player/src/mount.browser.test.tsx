import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { mountPlayer } from './mount.js';
import { renderRegistriesFor } from './registries.js';

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe('mounting the one-file player (FR-FIL-002)', () => {
  it('FR-FIL-002: mountPlayer draws the deck into an element and unmount removes it', async () => {
    const b = documentBuilder({ seed: 67 });
    const first = b.screen({ name: 'a', size: { w: 1600, h: 900 } });
    b.rect(first, { x: 10, y: 10, w: 100, h: 50 });
    const core = createCore(b.build());
    const ids = [first];
    const target = document.createElement('div');
    document.body.append(target);
    const mounted = await act(async () => mountPlayer(target, core.store, renderRegistriesFor(core.registries)));
    await act(frame);
    expect(target.querySelector('.fx-screen')?.getAttribute('data-screen-id')).toBe(ids[0]);
    await act(async () => mounted.unmount());
    expect(target.querySelector('.fx-screen')).toBeNull();
    target.remove();
  });
});
