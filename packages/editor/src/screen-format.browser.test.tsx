import { createCore } from '@fluxion/core';
import { ScreenView } from '@fluxion/render';
import { SCREEN_PRESETS } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

describe('screen formats (FR-SCR-003)', () => {
  it('FR-SCR-003: each screen preset renders at its aspect ratio within 0.5 px', async () => {
    for (const preset of SCREEN_PRESETS) {
      const b = documentBuilder({ seed: 401 });
      const screenId = b.screen({ size: preset.size });
      const { store } = createCore(b.build());
      // fitted into a box 400 px high: the screen is as wide as its ratio says
      await act(async () => root.render(<ScreenView store={store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 1000, h: 400 } }} />));
      const drawn = (host.querySelector('.fx-screen') as HTMLElement).getBoundingClientRect();
      expect(drawn.height, preset.id).toBeCloseTo(400, 1);
      expect(Math.abs(drawn.width - (400 * preset.size.w) / preset.size.h), `${preset.id} is ${drawn.width} px wide`).toBeLessThanOrEqual(0.5);
    }
  });

  it('FR-SCR-003: an infinite screen presents through its viewport', async () => {
    const b = documentBuilder({ seed: 402 });
    const screenId = b.screen({ kind: 'infinite', viewport: { x: 200, y: 100, w: 800, h: 450 } });
    const inside = b.rect(screenId, { x: 200, y: 100, w: 100, h: 50 });
    const outside = b.rect(screenId, { x: 0, y: 0, w: 100, h: 50 });
    const { store } = createCore(b.build());
    // the viewport (800 x 450) fitted into 400 x 225: half scale, its corner at the screen's corner
    await act(async () => root.render(<ScreenView store={store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 225 } }} />));
    const screen = (host.querySelector('.fx-screen') as HTMLElement).getBoundingClientRect();
    expect([screen.width, screen.height]).toEqual([400, 225]);
    const at = (id: string) => (host.querySelector(`.fx-el[data-el-id="${id}"]`) as HTMLElement).getBoundingClientRect();
    expect([at(inside).left - screen.left, at(inside).top - screen.top, at(inside).width]).toEqual([0, 0, 50]);
    // what lies left of and above the viewport is outside it: before the corner
    expect([at(outside).left - screen.left, at(outside).top - screen.top]).toEqual([-100, -50]);
  });
});
