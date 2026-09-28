import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentView } from './document-view.js';
import type { RenderMode } from './mode-policy.js';

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

/** A document whose screens carry `patches` (index, background, hidden…). */
function documentWith(patches: ReadonlyArray<Record<string, unknown>>): { file: DocumentFile; ids: RecordId[] } {
  const b = documentBuilder({ seed: 402 });
  const ids = patches.map(() => b.screen({ size: { w: 400, h: 200 } }));
  const file = b.build();
  const records = { ...file.records };
  ids.forEach((id, i) => {
    records[id] = { ...(records[id] as object), ...patches[i] } as never;
  });
  return { file: { ...file, records }, ids };
}

async function render(file: DocumentFile, mode: RenderMode = 'present') {
  const core = createCore(file);
  await act(async () => root.render(<DocumentView store={core.store} mode={mode} box={{ w: 400, h: 200 }} />));
  return core;
}

const backgrounds = () => [...host.querySelectorAll<HTMLElement>('.fx-background')].map((b) => getComputedStyle(b));

describe('screen backgrounds and order (FR-SCR-001)', () => {
  it('FR-SCR-001: renders each background kind', async () => {
    const { file, ids } = documentWith([
      { index: 'a0', background: '#ff0000' },
      { index: 'a1', background: '{color.primary}' },
      {
        index: 'a2',
        background: {
          type: 'linear-gradient',
          angle: 0,
          stops: [
            { offset: 0, color: '#000000' },
            { offset: 1, color: '#ffffff' },
          ],
        },
      },
      {
        index: 'a3',
        background: {
          type: 'radial-gradient',
          stops: [
            { offset: 0, color: '#ffffff' },
            { offset: 1, color: '{color.surface}' },
          ],
        },
      },
      { index: 'a4', background: { type: 'image', assetId: 'AssetAssetAsset1' } },
      { index: 'a5' },
    ]);
    await render(file);
    const [color, token, linear, radial, image, fallback] = backgrounds();
    expect(color?.backgroundColor).toBe('rgb(255, 0, 0)');
    // a token resolves through the screen's CSS variable
    expect(token?.backgroundColor).toBe('rgb(37, 99, 235)');
    expect(linear?.backgroundImage).toBe('linear-gradient(90deg, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)');
    expect(radial?.backgroundImage).toBe('radial-gradient(circle, rgb(255, 255, 255) 0%, rgb(248, 250, 252) 100%)');
    // an image is a placeholder until the asset store (M10); its id is an attribute, never CSS
    expect(image?.backgroundImage).toContain('repeating-linear-gradient');
    expect(host.querySelectorAll('.fx-background')[4]?.getAttribute('data-asset-id')).toBe('AssetAssetAsset1');
    // no background of its own: the theme's screen background
    expect(fallback?.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(ids).toHaveLength(6);
  });

  it('FR-SCR-001: screens render in fractional-index order', async () => {
    const { file, ids } = documentWith([{ index: 'a2' }, { index: 'a0' }, { index: 'a1', hidden: true }]);
    const [s2, s0, s1] = ids as [RecordId, RecordId, RecordId];
    const order = () => [...host.querySelectorAll<HTMLElement>('.fx-screen')].map((s) => s.dataset['screenId']);
    const core = await render(file);
    // hidden screens are skipped in presentation
    expect(order()).toEqual([s0, s2]);
    // the order follows a reorder command
    await act(async () => {
      core.execute('screen.reorder', { id: s0, after: s2 });
    });
    expect(order()).toEqual([s2, s0]);
    // the editor shows hidden screens too
    await render(file, 'edit');
    expect(order()).toEqual([s0, s1, s2]);
  });
});
